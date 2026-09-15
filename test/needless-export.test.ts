import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { loadConfig } from "../src/config.ts";
import { applyHunksToText } from "../src/patch/patch.ts";
import { headline, noteMarkdown } from "../src/report/report.ts";
import { lineCount, tokenCount } from "../src/hunk.ts";
import { analyze } from "../src/scan/analyze.ts";
import { hunk, project } from "./helpers.ts";

const BIN = path.resolve(import.meta.dirname, "../bin/skrub.mjs");

const TSCONFIG = (extra: Record<string, unknown> = {}) =>
  JSON.stringify({
    compilerOptions: { target: "ES2022", module: "NodeNext", moduleResolution: "NodeNext", strict: true, noEmit: true, allowImportingTsExtensions: true, ...extra },
    include: ["src", "test"],
  });

const LIB =
  "export const RATE = 2;\n" + // used here and nowhere else
  "export async function load(id: string) {\n  return fetchIt(id) * RATE;\n}\n" + // used by index
  "export function fetchIt(id: string) {\n  return id.length;\n}\n" + // used here only
  "export function orphan() {\n  return 0;\n}\n" + // used nowhere
  "export const a = 1, b = a + 1;\n" + // two declarations in one statement
  "function helper() {\n  return b + testOnly();\n}\n" +
  "export function testOnly() {\n  return 3;\n}\n" + // used here and by a test
  "export interface Shape {\n  n: number;\n}\n" + // a type an exported signature names: knip keeps it exported
  "export function area(s: Shape) {\n  return s.n + helper();\n}\n" +
  "const local = 5;\n" +
  "export { local };\n" + // an export list: left alone
  "export default function main() {\n  return local;\n}\n"; // default: left alone

function libProject(extra: Record<string, unknown> = {}) {
  return project({
    "tsconfig.json": TSCONFIG(extra),
    "src/index.ts": 'import main, { load, area, local } from "./lib.ts";\nexport async function run() {\n  return [await load("x"), area({ n: 1 }), main(), local];\n}\n',
    "src/lib.ts": LIB,
    "test/lib.test.ts": 'import { testOnly } from "../src/lib.ts";\ntestOnly();\n',
  });
}

async function findings(dir: string) {
  const { hunks } = await analyze(dir, { ...(await loadConfig(dir)), maxHunks: 100 }, { changed: null, llm: false });
  return hunks.filter((h) => h.file === "src/lib.ts" && (h.kind === "needless_export" || h.kind === "unused_export"));
}

test("an export only its own file uses gets its `export` dropped; one nothing uses is deleted", async () => {
  const found = await findings(libProject());
  const byName = Object.fromEntries(found.map((h) => [h.symbols![0], h]));
  assert.deepEqual(Object.keys(byName).sort(), ["RATE", "fetchIt", "orphan"]);
  assert.equal(byName.orphan!.kind, "unused_export");
  assert.equal(byName.RATE!.kind, "needless_export");
  assert.equal(byName.RATE!.replacement, "const RATE = 2;\n");
  assert.equal(byName.fetchIt!.replacement, "function fetchIt(id: string) {\n");
  assert.ok(found.every((h) => h.safe));
});

test("a library that emits declarations keeps its types exported; values still lose theirs", async () => {
  const found = await findings(libProject({ declaration: true, noEmit: false, emitDeclarationOnly: true }));
  const names = found.filter((h) => h.kind === "needless_export").map((h) => h.symbols![0]).sort();
  assert.deepEqual(names, ["RATE", "fetchIt"]);
});

test("an edit rewrites its line in place and counts as no deleted lines", () => {
  const edit = hunk({ kind: "needless_export", startLine: 2, endLine: 2, text: "export const RATE = 2;\n", replacement: "const RATE = 2;\n" });
  assert.equal(applyHunksToText("a\nexport const RATE = 2;\nb\n", [edit]), "a\nconst RATE = 2;\nb\n");
  assert.equal(lineCount([edit]), 0);
  assert.equal(tokenCount([edit]), 2);
  assert.equal(headline([hunk(), edit, { ...edit, id: "e2", startLine: 9 }]), "1 deletion · 1 line · ~6 tokens · 2 exports to drop");
  assert.equal(noteMarkdown(edit).split("\n").slice(-3).join("\n"), "```suggestion\nconst RATE = 2;\n```");
});

test("fix applies the edits, and the project still has every name it uses", async () => {
  const dir = libProject();
  const git = (...args: string[]) => execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", ...args], { cwd: dir, stdio: "pipe" });
  git("init", "-q");
  git("add", "-A");
  git("commit", "-qm", "base");
  const added = "export function twice(n: number) {\n  return n * 2;\n}\nconsole.log(twice(RATE));\n";
  writeFileSync(path.join(dir, "src/lib.ts"), `${LIB}${added}export const later = RATE + 1;\n`);
  execFileSync("node", [BIN, "fix", "--no-llm"], { cwd: dir, stdio: "pipe", env: { ...process.env, GEMINI_API_KEY: "" } });
  const after = readFileSync(path.join(dir, "src/lib.ts"), "utf8");
  // the diff's own leftovers go: `later` (used nowhere) is deleted, `twice` (used only here) loses `export`;
  // RATE, fetchIt, and Shape have the same problem but the diff didn't write them, so they stay
  assert.equal(after, `${LIB}${added.replace("export function twice", "function twice")}`);
  const tsc = createRequire(import.meta.url).resolve("typescript/bin/tsc");
  execFileSync(process.execPath, [tsc, "-p", dir], { stdio: "pipe" });
});

test("an export imported by another app in the repo (outside the tsconfig) is neither unused nor needless", async () => {
  const dir = project({
    "tsconfig.json": TSCONFIG(),
    "src/index.ts": 'import { shared } from "./types.ts";\nexport function run() {\n  return shared();\n}\n',
    "src/types.ts":
      "export interface Finding {\n  n: number;\n}\n" +
      "export function shared(): Finding {\n  return { n: 1 };\n}\n" +
      "export const onlyWeb = 1;\n",
    "web/tsconfig.json": JSON.stringify({ compilerOptions: { jsx: "react-jsx", allowImportingTsExtensions: true, noEmit: true }, include: ["src"] }),
    "web/src/App.tsx": 'import { onlyWeb, type Finding } from "../../src/types.ts";\nexport const f: Finding = { n: onlyWeb };\n',
  });
  execFileSync("git", ["init", "-q"], { cwd: dir });
  const { hunks } = await analyze(dir, await loadConfig(dir), { changed: null, llm: false });
  assert.deepEqual(hunks.filter((h) => h.file === "src/types.ts").map((h) => h.kind), []);
});
