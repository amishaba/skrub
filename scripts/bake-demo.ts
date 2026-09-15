/**
 * Bake the demo scan. Runs skrub's analyze() — the same function the CLI,
 * the TUI, and the PR comment use — on test/fixtures/sample-pr, with the
 * standing sample PR's real diff as the scope, and writes the
 * result to web/scan.json. Nothing here is hand-written: every hunk, line
 * number, and count on the demo page comes out of this run.
 *
 * Deterministic on purpose (fixed id and timestamp), so CI can re-run it and
 * fail if the shipped scan no longer matches the code.
 *
 *   npm run demo:bake
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { loadConfig } from "../src/config.ts";
import { analyze } from "../src/scan/analyze.ts";
import { scanSummary, type Scan } from "../src/scan/summary.ts";
import { type DiffScope, parseUnifiedDiff } from "../src/git/diff.ts";

const root = path.resolve(fileURLToPath(import.meta.url), "../..");

/** The standing sample PR the fixture mirrors. */
export const SAMPLE_PR = {
  url: "https://github.com/amishaba/skrub-sample/pull/1",
  base: "eaa8c462258ac02ca72c2af7b3392cb36a4a3797",
  head: "fc91653804b2d5b19fe953841c5b2881df58e5a4",
  committedAt: "2026-10-05T21:40:09.000Z",
  files: [
    "src/cli.ts",
    "src/export/csv.ts",
    "src/export/csvName.ts",
    "src/export/draft-export.ts",
    "src/export/index.ts",
    "src/export/json.ts",
    "src/lib/format.ts",
    "src/report.ts",
  ],
} as const;

export const FIXTURE_DIR = path.join(root, "test/fixtures/sample-pr");
export const SCAN_JSON = path.join(root, "web/scan.json");

/** The PR's real diff, so the scan knows which lines the agent added. */
export function prDiff(): DiffScope {
  return parseUnifiedDiff(readFileSync(path.join(FIXTURE_DIR, "pr.diff"), "utf8"));
}

export interface PrLine {
  file: string;
  line: number;
  text: string;
}

/** Every line the PR added, file by file in the PR's order: what the agent wrote. */
export function prLines(): PrLine[] {
  const diff = prDiff();
  return SAMPLE_PR.files.flatMap((file) => {
    const text = readFileSync(path.join(FIXTURE_DIR, file), "utf8").replace(/\n$/, "").split("\n");
    const ranges = diff.added.get(file);
    const wrote = (n: number) => ranges === "all" || !!ranges?.some(([a, b]) => n >= a && n <= b);
    return text.flatMap((t, i) => (wrote(i + 1) ? [{ file, line: i + 1, text: t }] : []));
  });
}

export interface DemoScan extends Scan {
  source: typeof SAMPLE_PR;
}

export async function bakeDemo(): Promise<DemoScan> {
  const config = await loadConfig(FIXTURE_DIR);
  const diff = prDiff();
  const { hunks } = await analyze(FIXTURE_DIR, config, { changed: diff.files, diff, llm: false });
  const summary = scanSummary(
    "sample-pr",
    "test/fixtures/sample-pr",
    SAMPLE_PR.base,
    false,
    hunks,
    null,
    SAMPLE_PR.committedAt,
  );
  return { summary, hunks, source: SAMPLE_PR };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const demo = await bakeDemo();
  writeFileSync(SCAN_JSON, JSON.stringify(demo, null, 2) + "\n");
  console.log(`wrote web/scan.json  ${demo.summary.hunks} hunks  ${demo.summary.lines} lines`);
}
