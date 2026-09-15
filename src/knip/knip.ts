import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

/** What knip found unused, by repo-relative path. */
export interface KnipResult {
  files: Set<string>;
  /** Exports and types no other file imports. `pos` is the offset of the name knip saw. */
  exports: Map<string, KnipExport[]>;
}

export interface KnipExport {
  name: string;
  pos: number;
}

interface KnipIssue {
  file: string;
  files?: { name: string }[];
  exports?: KnipExport[];
  types?: KnipExport[];
}

/**
 * Run knip on the repo for unused files, exports and types. knip knows where
 * an app starts (its plugins read Vite's index.html, Next's routes, package.json
 * exports, test runners), so skrub doesn't guess. Throws with knip's own message.
 */
export async function runKnip(cwd: string): Promise<KnipResult> {
  const args = [knipBin(), "--reporter", "json", "--no-progress", "--no-exit-code", "--include", "files,exports,types"];
  const { stdout, stderr, code } = await run(process.execPath, args, cwd);
  // knip still reports when a config fails to load, but without the entries that config names; don't act on that.
  const errors = stderr.split("\n").filter((l) => l.startsWith("ERROR:")).map((l) => l.replace(/^ERROR:\s*/, ""));
  if (errors.length) throw new Error(`knip: ${errors.join("; ")}`);
  let report: { issues?: KnipIssue[] };
  try {
    report = JSON.parse(stdout) as { issues?: KnipIssue[] };
  } catch {
    const tail = (stderr || stdout).trim().split("\n").slice(-6).join("\n");
    throw new Error(`knip failed${code ? ` (exit ${code})` : ""}: ${tail || "no output"}`);
  }
  const files = new Set<string>();
  const exports = new Map<string, KnipExport[]>();
  for (const issue of report.issues ?? []) {
    const rel = issue.file.split(path.sep).join("/");
    for (const f of issue.files ?? []) files.add(f.name.split(path.sep).join("/"));
    const unused = [...(issue.exports ?? []), ...(issue.types ?? [])];
    if (unused.length) exports.set(rel, unused.map(({ name, pos }) => ({ name, pos })));
  }
  return { files, exports };
}

/** knip's CLI from skrub's own dependencies; its package.json isn't exported, so walk up from its entry. */
function knipBin(): string {
  let dir = path.dirname(createRequire(import.meta.url).resolve("knip"));
  while (!existsSync(path.join(dir, "package.json")) || path.basename(dir) !== "knip") {
    const up = path.dirname(dir);
    if (up === dir) throw new Error("knip is not installed");
    dir = up;
  }
  return path.join(dir, "bin", "knip.js");
}

function run(cmd: string, args: string[], cwd: string): Promise<{ stdout: string; stderr: string; code: number | null }> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", reject);
    child.on("close", (code) => resolve({ stdout, stderr, code }));
  });
}
