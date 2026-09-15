import http from "node:http";
import path from "node:path";
import { promises as fs } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Decision, Decisions } from "../hunk.ts";
import { readJson } from "../lib/fs.ts";
import { latestScanId, listScanIds, readDecisions, readScan, resolveScanDir, writeDecisions } from "../store/scans.ts";
import { runHint } from "../agent/self.ts";

const DEMO_HTML = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../web/index.html");
const REVIEW_HTML = path.join(path.dirname(fileURLToPath(import.meta.url)), "./review.html");
/** Files in web/ the pages ask for by name. */
const WEB_FILES: Record<string, string> = {
  "/favicon.svg": "image/svg+xml",
  "/favicon-32.png": "image/png",
  "/apple-touch-icon.png": "image/png",
  "/og.png": "image/png",
};

/** Serve the review page and its API on 127.0.0.1, from `port` up if it's taken. Resolves with the port. */
export function startReviewServer(cwd: string, port: number): Promise<number> {
  const server = http.createServer((req, res) => {
    respond(req, res, cwd).catch((err) => send(res, 500, "text/plain", String(err?.message ?? err)));
  });
  return listen(server, port);
}

export async function respond(req: http.IncomingMessage, res: http.ServerResponse, cwd: string): Promise<void> {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");

  if (url.pathname === "/" && !url.search) {
    try {
      const html = await fs.readFile(DEMO_HTML, "utf8");
      return send(res, 200, "text/html; charset=utf-8", html);
    } catch { /* Older source-only installs still open the real review. */ }
  }

  if (url.pathname === "/sample" || url.pathname === "/sample.html") {
    return send(res, 200, "text/html; charset=utf-8", await fs.readFile(path.join(path.dirname(DEMO_HTML), "sample.html")));
  }

  const type = WEB_FILES[url.pathname];
  if (type) {
    return send(res, 200, type, await fs.readFile(path.join(path.dirname(DEMO_HTML), url.pathname.slice(1))));
  }

  if (url.pathname === "/scan.json") {
    return send(res, 200, "application/json", await fs.readFile(path.join(path.dirname(DEMO_HTML), "scan.json")));
  }

  if (url.pathname === "/" || url.pathname === "/review") {
    return send(res, 200, "text/html; charset=utf-8", (await fs.readFile(REVIEW_HTML, "utf8")).replaceAll("__SKRUB__", runHint()));
  }

  if (url.pathname === "/api/scans") {
    const ids = await listScanIds(cwd);
    const latest = await latestScanId(cwd);
    const scans = [];
    for (const id of ids) {
      try {
        const s = await readScan(cwd, id);
        scans.push(s.summary);
      } catch {
        scans.push({ id });
      }
    }
    return send(res, 200, "application/json", JSON.stringify({ latest, scans }));
  }

  if (url.pathname === "/api/scan") {
    const id = await knownScanId(cwd, url.searchParams.get("id"));
    if (!id) return send(res, 400, "application/json", JSON.stringify({ error: "unknown scan" }));
    const scan = await readScan(cwd, id);
    const decisions = await readDecisions(cwd, id);
    return send(res, 200, "application/json", JSON.stringify({ ...scan, decisions }));
  }

  if (url.pathname === "/api/decision" && req.method === "POST") {
    const body = await readBody(req);
    let parsed: { id?: string; hunkId?: string; decision?: Decision };
    try {
      parsed = JSON.parse(body) as { id?: string; hunkId?: string; decision?: Decision };
    } catch {
      return send(res, 400, "application/json", JSON.stringify({ error: "invalid json" }));
    }
    const id = await knownScanId(cwd, parsed.id ?? null);
    if (!id || !parsed.hunkId || (parsed.decision !== "accept" && parsed.decision !== "skip")) {
      return send(res, 400, "application/json", JSON.stringify({ error: "bad decision" }));
    }
    const decisions: Decisions = await readDecisions(cwd, id);
    decisions[parsed.hunkId] = parsed.decision;
    await writeDecisions(cwd, id, decisions);
    return send(res, 200, "application/json", JSON.stringify({ ok: true, decisions }));
  }

  send(res, 404, "text/plain", "not found");
}

async function knownScanId(cwd: string, id: string | null): Promise<string | null> {
  if (!id || !/^scan-[\w.-]+$/.test(id)) return null;
  try {
    await readJson(path.join(await resolveScanDir(cwd, id), "findings.json"));
    return id;
  } catch {
    return null;
  }
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function send(res: http.ServerResponse, status: number, type: string, body: string | Buffer): void {
  res.writeHead(status, { "content-type": type, "cache-control": "no-store" });
  res.end(body);
}

function listen(server: http.Server, port: number, attempts = 10): Promise<number> {
  return new Promise((resolve, reject) => {
    const tryPort = (p: number, left: number) => {
      server.once("error", (err: NodeJS.ErrnoException) => {
        if (err.code === "EADDRINUSE" && left > 0) tryPort(p + 1, left - 1);
        else reject(err);
      });
      server.listen(p, "127.0.0.1", () => resolve(p));
    };
    tryPort(port, attempts);
  });
}
