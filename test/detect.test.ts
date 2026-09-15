import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { FIXTURE_DIR, SAMPLE_PR, SCAN_JSON, bakeDemo, prLines, type DemoScan } from "../scripts/bake-demo.ts";
import { loadConfig } from "../src/config.ts";
import { sliceLines } from "../src/lib/lines.ts";
import { lineCount, isApplicable, removesLines } from "../src/hunk.ts";
import { analyze } from "../src/scan/analyze.ts";
import { project } from "./helpers.ts";

const shipped = JSON.parse(readFileSync(SCAN_JSON, "utf8")) as DemoScan;

test("golden: the shipped demo scan is exactly what analyze() produces on the sample-pr fixture today", async () => {
  const fresh = await bakeDemo();
  assert.deepEqual(fresh, shipped);
});

test("golden: every stat in the shipped summary recomputes from its hunks", () => {
  const { summary, hunks } = shipped;
  assert.equal(summary.hunks, hunks.length);
  assert.equal(summary.lines, lineCount(hunks.filter(removesLines)));
  const byKind: Record<string, number> = {};
  for (const h of hunks) byKind[h.kind] = (byKind[h.kind] ?? 0) + 1;
  assert.deepEqual(summary.byKind, byKind);
  assert.equal(summary.against, SAMPLE_PR.base);
});

test("golden: every hunk's text is the real slice of the fixture file it points at", () => {
  for (const h of shipped.hunks) {
    const text = readFileSync(path.join(FIXTURE_DIR, h.file), "utf8");
    assert.equal(h.text, sliceLines(text, h.startLine, h.endLine), `${h.file}:${h.startLine}-${h.endLine}`);
    assert.ok(SAMPLE_PR.files.includes(h.file as (typeof SAMPLE_PR.files)[number]), `${h.file} is in the diff`);
  }
});

test("golden: the story numbers — what the README says skrub found on the sample PR", () => {
  const { hunks } = shipped;
  const deletions = hunks.filter(removesLines);
  assert.equal(prLines().length, 99, "lines the agent added");
  assert.equal(SAMPLE_PR.files.length, 8);
  assert.equal(hunks.length, 22);
  assert.equal(deletions.length, 16);
  assert.equal(lineCount(deletions), 44);
  assert.equal(hunks.filter((h) => isApplicable(h) && !removesLines(h)).length, 1, "one export to drop");
  assert.deepEqual(shipped.summary.byKind, {
    unused_import: 2,
    unused_file: 2,
    claudeism: 5,
    unused_export: 4,
    needless_export: 1,
    glue: 2,
    dup: 1,
    convention: 2,
    fold: 1,
    reuse: 2,
  });
  assert.equal(hunks.find((h) => h.kind === "dup")!.reason, "Same as sortBy in src/report.ts:17. Use that one instead.");
  assert.equal(hunks.find((h) => h.kind === "fold")!.reason, "Only src/cli.ts uses this file. Keep it in src/cli.ts until a second file needs it.");
  assert.deepEqual(hunks.filter((h) => h.kind === "reuse").map((h) => h.reason).sort(), [
    "85% the same as columnTotals in src/report-totals.ts:3. Reuse or extend that one instead of keeping a second version.",
    "fetchReport in src/load-report.ts:20 already calls GET /api/reports/:param. Call it instead of fetching here.",
  ]);
  // safe (compiler-backed) hunks are ranked ahead of every heuristic
  const firstUnsafe = hunks.findIndex((h) => !h.safe);
  assert.ok(hunks.slice(0, firstUnsafe).every((h) => h.safe));
  assert.ok(hunks.slice(firstUnsafe).every((h) => !h.safe));
});

test("whole-file hunks end on the last content line, never one past it", () => {
  const wc = (rel: string) => Number(execFileSync("wc", ["-l", path.join(FIXTURE_DIR, rel)]).toString().trim().split(/\s+/)[0]);
  const draft = shipped.hunks.find((h) => h.kind === "unused_file" && h.file === "src/export/draft-export.ts")!;
  assert.equal(draft.endLine, wc("src/export/draft-export.ts"));
  const barrel = shipped.hunks.find((h) => h.kind === "glue" && h.file === "src/export/index.ts")!;
  assert.equal(barrel.endLine, wc("src/export/index.ts"));
});

test("a file reached only through import() or require() is live; a true orphan is not", async () => {
  const dir = project({
    "src/index.ts": 'export async function main() {\n  const m = await import("./lazy.ts");\n  const c = require("./cjs.ts");\n  return [m, c];\n}\n',
    "src/lazy.ts": "export const lazy = 1;\n",
    "src/cjs.ts": "export const cjs = 1;\n",
    "src/orphan.ts": "export const orphan = 1;\n",
  });
  const { hunks } = await analyze(dir, await loadConfig(dir), { changed: null, llm: false });
  const files = hunks.filter((h) => h.kind === "unused_file").map((h) => h.file);
  assert.deepEqual(files, ["src/orphan.ts"]);
});

test("a file reached only by URL (fork, new Worker, import.meta.resolve) is live; a true orphan is not", async () => {
  const dir = project({
    "src/index.ts":
      "export function start(run: (target: URL | string) => void) {\n" +
      '  run(new URL("./worker.ts", import.meta.url));\n' +
      '  run(new URL("./pool.js", import.meta.url));\n' +
      '  run(import.meta.resolve("./task.ts"));\n' +
      '  run(new URL("./elsewhere.ts", "https://example.com/"));\n' +
      "}\n",
    "src/worker.ts": 'console.log("worker");\n',
    "src/pool.ts": 'console.log("pool");\n',
    "src/task.ts": 'console.log("task");\n',
    "src/elsewhere.ts": 'console.log("elsewhere");\n',
  });
  const { hunks } = await analyze(dir, await loadConfig(dir), { changed: null, llm: false });
  const files = hunks.filter((h) => h.kind === "unused_file").map((h) => h.file);
  assert.deepEqual(files, ["src/elsewhere.ts"]);
});

test("a method on a value or a type guard is not glue; a function that only forwards is", async () => {
  const dir = project({
    "src/index.ts":
      'import { Registry, isKnown, isTyped, lookup, shout } from "./registry.ts";\n' +
      "export function main() {\n" +
      '  return [new Registry().get("a"), lookup("a"), isKnown("a"), isTyped("a"), shout("a")];\n' +
      "}\n",
    "src/registry.ts":
      'import * as text from "./text.ts";\n' +
      "const table = new Map<string, number>();\n" +
      'const KNOWN = ["a", "b"] as const;\n' +
      "type Known = (typeof KNOWN)[number];\n" +
      "function find(id: string) {\n" +
      "  return table.get(id) ?? 0;\n" +
      "}\n" +
      "function known(id: string) {\n" +
      "  return (KNOWN as readonly string[]).includes(id);\n" +
      "}\n" +
      "export function lookup(id: string) {\n" +
      "  return find(id);\n" +
      "}\n" +
      "export function isKnown(id: string) {\n" +
      "  return (KNOWN as readonly string[]).includes(id);\n" +
      "}\n" +
      "export function isTyped(id: string): id is Known {\n" +
      "  return known(id);\n" +
      "}\n" +
      "export function shout(s: string) {\n" +
      "  return text.upper(s);\n" +
      "}\n" +
      "export class Registry {\n" +
      "  private items = new Map<string, number>();\n" +
      "  get(id: string) {\n" +
      "    return this.items.get(id);\n" +
      "  }\n" +
      "}\n",
    "src/text.ts": "export function upper(s: string) {\n  return s.toUpperCase();\n}\n",
  });
  const { hunks } = await analyze(dir, await loadConfig(dir), { changed: null, llm: false });
  const glue = hunks.filter((h) => h.kind === "glue").map((h) => h.reason);
  assert.deepEqual(glue, ["lookup only forwards to another function.", "shout only forwards to another function."]);
});

test("an import is unused when its own file never reads it, even if other files use the symbol", async () => {
  const dir = project({
    "src/index.ts":
      'import { fmt } from "./fmt.ts";\n' +
      'import { csv } from "./csv.ts";\n' +
      "export function main() {\n" +
      "  return [fmt(1), csv()];\n" +
      "}\n",
    "src/csv.ts":
      'import { fmt } from "./fmt.ts";\n' +
      'import { fmt as f } from "./fmt.ts";\n' +
      'import { fmt as g } from "./fmt.ts";\n' +
      "export function csv() {\n" +
      "  return g(2);\n" +
      "}\n",
    "src/fmt.ts": "export function fmt(n: number) {\n  return String(n);\n}\n",
    "src/reexport.ts": 'import { fmt } from "./fmt.ts";\nexport { fmt };\n',
    "src/shorthand.ts": 'import { fmt } from "./fmt.ts";\nexport const api = { fmt };\n',
  });
  const { hunks } = await analyze(dir, await loadConfig(dir), { changed: null, llm: false });
  const imports = hunks.filter((h) => h.kind === "unused_import").map((h) => `${h.file}:${h.startLine}`);
  assert.deepEqual(imports.sort(), ["src/csv.ts:1", "src/csv.ts:2"]);
});

test("a barrel that re-exports with export * scans; the dead export is reported where it is declared", async () => {
  const dir = project({
    "src/index.ts":
      'import { used } from "./lib/index.ts";\n' +
      "export function main() {\n" +
      "  return used();\n" +
      "}\n",
    "src/lib/index.ts": 'export * from "./impl.ts";\n',
    "src/lib/impl.ts":
      "export function used() {\n  return 1;\n}\n" +
      "export function dead() {\n  return 2;\n}\n",
  });
  const { hunks } = await analyze(dir, await loadConfig(dir), { changed: null, llm: false });
  const exports = hunks.filter((h) => h.kind === "unused_export").map((h) => `${h.file}:${h.startLine}-${h.endLine}`);
  assert.deepEqual(exports, ["src/lib/impl.ts:4-6"]);
});

test("what an entry re-exports with export * is public, through further export *; a barrel off the entry's path is not", async () => {
  const dir = project({
    "src/index.ts": 'export * from "./lib/index.ts";\n',
    "src/lib/index.ts": 'export * from "./impl.ts";\n',
    "src/lib/impl.ts": "export function a() {\n  return 1;\n}\nexport function b() {\n  return 2;\n}\n",
  });
  const { hunks } = await analyze(dir, await loadConfig(dir), { changed: null, llm: false });
  assert.deepEqual(hunks.filter((h) => h.kind === "unused_export" || h.kind === "needless_export"), []);
});

test("entries are never reported as unused, and their exports are not dead", async () => {
  const dir = project({ "src/index.ts": "export function main() {\n  return 1;\n}\n" });
  const { hunks } = await analyze(dir, await loadConfig(dir), { changed: null, llm: false });
  assert.deepEqual(hunks, []);
});
