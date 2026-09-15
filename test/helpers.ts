import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { scanSummary, type Scan, type ScanSummary } from "../src/scan/summary.ts";
import type { Hunk } from "../src/hunk.ts";

/** A delete hunk with sensible defaults; override what the scenario cares about. */
export function hunk(over: Partial<Hunk> = {}): Hunk {
  const startLine = over.startLine ?? 1;
  const endLine = over.endLine ?? startLine;
  const kind = over.kind ?? "unused_export";
  const file = over.file ?? "src/a.ts";
  return {
    id: `${kind}-${file}-${startLine}`,
    file,
    startLine,
    endLine,
    kind,
    confidence: 0.85,
    reason: "Exported thing is never referenced.",
    text: "export const thing = 1;\n",
    safe: true,
    action: "delete",
    ...over,
  };
}

/** A comment-only hunk (naming), never deleted. */
export function note(over: Partial<Hunk> = {}): Hunk {
  return hunk({
    kind: "naming",
    action: "comment",
    safe: false,
    confidence: 0.55,
    reason: "Exported name 'data' doesn't say what this is.",
    ...over,
  });
}

export function scan(hunks: Hunk[], over: Partial<ScanSummary> = {}): Scan {
  const summary = {
    ...scanSummary("scan-test", "/repo", null, false, hunks, null, "2026-01-01T00:00:00.000Z"),
    ...over,
  };
  return { summary, hunks };
}

/** Write a throwaway project: { "src/a.ts": "..." } → absolute dir. */
export function project(files: Record<string, string>, opts: { tsconfig?: boolean; main?: string } = {}): string {
  const dir = mkdtempSync(path.join(tmpdir(), "skrub-test-"));
  const all: Record<string, string> = {
    "package.json": JSON.stringify({ name: "t", private: true, type: "module", main: opts.main ?? "src/index.ts" }),
    ...(opts.tsconfig === false
      ? {}
      : {
          "tsconfig.json": JSON.stringify({
            compilerOptions: {
              target: "ES2022",
              module: "NodeNext",
              moduleResolution: "NodeNext",
              strict: true,
              noEmit: true,
              allowImportingTsExtensions: true,
            },
            include: ["src"],
          }),
        }),
    ...files,
  };
  for (const [rel, text] of Object.entries(all)) {
    const abs = path.join(dir, rel);
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, text);
  }
  return dir;
}
