import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { ts } from "ts-morph";
import { exists } from "../lib/fs.ts";

/** One typecheck: whether it passed, and its errors without line numbers (deleting lines moves them). */
export interface Check {
  ok: boolean;
  errors: string[];
}

/**
 * What runs to check a fix: the repo's `typecheck` script; else tsc on
 * tsconfig.json, or on each project it references when it only lists others
 * (a Vite-style root). Null when there's nothing to run.
 */
export async function verifyCommands(cwd: string, verify: string | false | undefined): Promise<string[][] | null> {
  if (verify === false) return null;
  if (typeof verify === "string") return [["sh", "-c", verify]];
  const pkg = path.join(cwd, "package.json");
  if (await exists(pkg)) {
    try {
      const scripts = (JSON.parse(await fs.readFile(pkg, "utf8")) as { scripts?: Record<string, string> }).scripts;
      if (scripts?.typecheck) return [["npm", "run", "--silent", "typecheck"]];
    } catch {
      // An unreadable package.json has no script to run; fall back to tsc.
    }
  }
  const root = path.join(cwd, "tsconfig.json");
  if (!(await exists(root))) return null;
  const tsc = await tscPath(cwd);
  return (await projects(cwd, root)).map((p) => [process.execPath, tsc, "--noEmit", "-p", p, "--pretty", "false"]);
}

/** tsconfig.json itself, or the projects it references when it has no files of its own. */
async function projects(cwd: string, root: string): Promise<string[]> {
  const { config } = ts.readConfigFile(root, ts.sys.readFile) as { config?: { files?: unknown[]; include?: unknown[]; references?: { path: string }[] } };
  const refs = config?.references ?? [];
  const ownsNothing = Array.isArray(config?.files) && config.files.length === 0 && !config?.include;
  if (!refs.length || !ownsNothing) return ["tsconfig.json"];
  const out: string[] = [];
  for (const ref of refs) {
    let p = path.resolve(cwd, ref.path);
    if (!p.endsWith(".json")) p = path.join(p, "tsconfig.json");
    if (await exists(p)) out.push(path.relative(cwd, p));
  }
  return out.length ? out : ["tsconfig.json"];
}

export async function runCheck(cwd: string, cmds: string[][]): Promise<Check> {
  let ok = true;
  const errors: string[] = [];
  for (const cmd of cmds) {
    const { out, code } = await run(cmd, cwd);
    if (code !== 0) ok = false;
    for (const line of out.split("\n")) {
      const m = /^(.+?)\(\d+,\d+\): error (TS\d+: .*)$/.exec(line.trim());
      if (m) errors.push(`${m[1]!.split(path.sep).join("/")}: ${m[2]}`);
    }
  }
  return { ok, errors };
}

/**
 * Errors the fix introduced: those in `after` beyond what `before` already
 * had. A check that newly fails with no tsc-style errors to point at counts
 * as broken everywhere.
 */
export function introduced(before: Check, after: Check): { broken: boolean; errors: string[] } {
  const seen = new Map<string, number>();
  for (const e of before.errors) seen.set(e, (seen.get(e) ?? 0) + 1);
  const errors: string[] = [];
  for (const e of after.errors) {
    const n = seen.get(e) ?? 0;
    if (n > 0) seen.set(e, n - 1);
    else errors.push(e);
  }
  return { broken: errors.length > 0 || (before.ok && !after.ok), errors };
}

/** The file an error line names (repo-relative, as tsc prints it). */
export function errorFile(error: string): string {
  return error.slice(0, error.indexOf(": TS"));
}

/** Names an error quotes: `'GradeSchema' is declared but its value is never read.` → GradeSchema. */
export function errorNames(error: string): string[] {
  return [...error.matchAll(/'([A-Za-z_$][\w$]*)'/g)].map((m) => m[1]!);
}

/** The repo's own TypeScript, so the check matches its version; skrub's otherwise. */
async function tscPath(cwd: string): Promise<string> {
  const local = path.join(cwd, "node_modules", "typescript", "bin", "tsc");
  if (await exists(local)) return local;
  return path.join(path.dirname(createRequire(import.meta.url).resolve("typescript")), "..", "bin", "tsc");
}

function run(cmd: string[], cwd: string): Promise<{ out: string; code: number | null }> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd[0]!, cmd.slice(1), { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    child.on("error", reject);
    child.on("close", (code) => resolve({ out, code }));
  });
}
