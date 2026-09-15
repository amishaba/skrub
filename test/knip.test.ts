import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { loadConfig } from "../src/config.ts";
import { analyze } from "../src/scan/analyze.ts";
import { fix } from "../src/patch/fix.ts";
import { project } from "./helpers.ts";

const TSCONFIG = (extra: Record<string, unknown> = {}) =>
  JSON.stringify({
    compilerOptions: { target: "ES2022", module: "NodeNext", moduleResolution: "NodeNext", strict: true, noEmit: true, allowImportingTsExtensions: true, ...extra },
    include: ["src"],
  });

/** A committed repo, so fix and scans see a clean tree. */
function repo(files: Record<string, string>): string {
  const dir = project(files);
  const git = (...args: string[]) => execFileSync("git", args, { cwd: dir, stdio: "pipe" });
  git("init", "-q");
  git("add", "-A");
  git("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "init");
  return dir;
}

async function findings(dir: string) {
  const { hunks } = await analyze(dir, { ...(await loadConfig(dir)), maxHunks: 100 }, { changed: null, llm: false });
  return hunks;
}

const tsc = (dir: string) => execFileSync(process.execPath, [path.resolve(import.meta.dirname, "../node_modules/typescript/bin/tsc"), "-p", dir], { encoding: "utf8" });

test("a name in an export list comes out of the list, and its unused declaration goes with it", async () => {
  const dir = repo({
    "src/index.ts": 'import { A } from "./ui.ts";\nconsole.log(A());\n',
    "src/ui.ts": "function A() {\n  return 1;\n}\nfunction B() {\n  return 2;\n}\nexport { A, B };\n",
  });
  const result = await fix(dir, {});
  assert.equal(result.reverted.length, 0);
  assert.equal(readFileSync(path.join(dir, "src/ui.ts"), "utf8"), "function A() {\n  return 1;\n}\nexport { A };\n");
  tsc(dir);
});

test("what only a lazy import(), a side-effect import, or an html entry reaches is never called unused", async () => {
  const dir = repo({
    "package.json": JSON.stringify({ name: "t", private: true, type: "module", main: "src/index.ts", devDependencies: { vite: "^6.0.0" } }),
    "index.html": '<script type="module" src="/src/main.ts"></script>\n',
    "src/main.ts": 'import "./polyfill.ts";\nconst page = () => import("./page.ts");\nconsole.log(page);\n',
    "src/polyfill.ts": "(globalThis as Record<string, unknown>).ready = true;\n",
    "src/page.ts": "export default function Page() {\n  return 1;\n}\n",
    "src/index.ts": "export const version = 1;\n",
  });
  const files = (await findings(dir)).filter((h) => h.kind === "unused_file" || h.kind === "unused_export").map((h) => h.file);
  assert.deepEqual(files, []);
});

test("a scan doesn't fail when the working tree deletes a tracked file", async () => {
  const dir = repo({
    "src/index.ts": 'import { a } from "./a.ts";\nconsole.log(a);\n',
    "src/a.ts": "export const a = 1;\n",
    "src/gone.ts": "export const gone = 1;\n",
  });
  rmSync(path.join(dir, "src/gone.ts"));
  await assert.doesNotReject(findings(dir));
});

test("fix typechecks after deleting and puts back a file its edits broke", async () => {
  // Deleting the unused type leaves its schema unused, and noUnusedLocals makes that an error.
  const dir = repo({
    "tsconfig.json": TSCONFIG({ noUnusedLocals: true }),
    "src/index.ts": 'import { parse } from "./types.ts";\nconsole.log(parse("x"));\n',
    "src/types.ts":
      "const schema = { kind: \"grade\" as const };\n" +
      "export type Grade = typeof schema;\n" +
      "export function parse(s: string) {\n  return s.length;\n}\n",
  });
  const before = readFileSync(path.join(dir, "src/types.ts"), "utf8");
  const result = await fix(dir, {});
  assert.ok(result.verified, "a check ran");
  assert.deepEqual(result.reverted.map((h) => h.file), ["src/types.ts"]);
  assert.match(result.errors.join("\n"), /src\/types\.ts: TS6133/);
  assert.equal(readFileSync(path.join(dir, "src/types.ts"), "utf8"), before);
  tsc(dir);
});

test("--no-verify deletes without the check", async () => {
  const dir = repo({
    "src/index.ts": "console.log(1);\n",
    "src/dead.ts": "export const dead = 1;\n",
  });
  const result = await fix(dir, { verify: false });
  assert.equal(result.verified, null);
  assert.ok(!existsSync(path.join(dir, "src/dead.ts")));
});

test("a comment-looking line inside a template string is text, not a comment", async () => {
  const dir = repo({
    "src/index.ts": "export const help = `usage:\n// this function prints the help\n  run it`;\n",
  });
  const comments = (await findings(dir)).filter((h) => h.kind === "claudeism");
  assert.deepEqual(comments, []);
});

test("entries take globs: a route file a framework loads by path is never deleted", async () => {
  const dir = repo({
    "skrub.config.ts": 'export default { entries: ["src/app/**/route.ts"] };\n',
    "src/index.ts": "console.log(1);\n",
    "src/app/api/users/route.ts": "export function GET() {\n  return 1;\n}\n",
  });
  const flagged = (await findings(dir)).filter((h) => h.file === "src/app/api/users/route.ts" && h.action !== "comment");
  assert.deepEqual(flagged, []);
});

test("only the edit the errors point at goes back; the rest of that file's edits stay", async () => {
  const dir = repo({
    "tsconfig.json": TSCONFIG({ noUnusedLocals: true }),
    "src/index.ts": 'import { parse } from "./types.ts";\nconsole.log(parse("x"));\n',
    "src/types.ts":
      "const schema = { kind: \"grade\" as const };\n" +
      "export type Grade = typeof schema;\n" +
      "export function parse(s: string) {\n  return s.length;\n}\n" +
      "export function unused() {\n  return 1;\n}\n",
  });
  const result = await fix(dir, {});
  assert.deepEqual(result.reverted.map((h) => h.symbols?.[0]), ["Grade"]);
  assert.deepEqual(result.done.map((h) => h.symbols?.[0]), ["unused"]);
  const text = readFileSync(path.join(dir, "src/types.ts"), "utf8");
  assert.match(text, /export type Grade/);
  assert.doesNotMatch(text, /function unused/);
  tsc(dir);

  // The next run remembers it broke the check and leaves it alone.
  execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qam", "fix"], { cwd: dir });
  const again = await fix(dir, {});
  assert.deepEqual(again.done, []);
  assert.deepEqual(again.reverted.map((h) => h.symbols?.[0]), ["Grade"]);
});

test("a tool's config file, and what a script listed in entries imports, are never called unused", async () => {
  const dir = repo({
    "skrub.config.ts": 'export default { include: ["*.ts"], entries: ["send-sms.ts"] };\n',
    "vite.config.ts": "export default {};\n",
    "send-sms.ts": 'import { db } from "./db.ts";\nconsole.log(db);\n',
    "db.ts": "export const db = 1;\n",
  });
  const files = (await findings(dir)).filter((h) => h.kind === "unused_file").map((h) => h.file);
  assert.deepEqual(files, []);
});

test("a Vite-style tsconfig that only references others is checked through them", async () => {
  const dir = repo({
    "tsconfig.json": JSON.stringify({ files: [], references: [{ path: "./tsconfig.app.json" }] }),
    "tsconfig.app.json": TSCONFIG({ noUnusedLocals: true }),
    "src/index.ts": 'import { parse } from "./types.ts";\nconsole.log(parse("x"));\n',
    "src/types.ts": "const schema = { kind: 1 };\nexport type Grade = typeof schema;\nexport function parse(s: string) {\n  return s.length;\n}\n",
  });
  const result = await fix(dir, {});
  assert.equal(result.verified, "tsc -p tsconfig.app.json");
  assert.deepEqual(result.reverted.map((h) => h.symbols?.[0]), ["Grade"]);
});

test("a package entry pointing at build output counts its source file as the entry", async () => {
  const dir = repo({
    "package.json": JSON.stringify({ name: "lib", type: "module", exports: "./dist/index.js", types: "./dist/index.d.ts" }),
    "src/index.ts": 'export type { Options } from "./options.ts";\nexport function make() {\n  return 1;\n}\n',
    "src/options.ts": "export interface Options {\n  retries: number;\n}\n",
  });
  const flagged = (await findings(dir)).filter((h) => h.action !== "comment").map((h) => `${h.kind} ${h.file}`);
  assert.deepEqual(flagged, []);
});

test("a name alone on its line leaves no blank line in the export list", async () => {
  const dir = repo({
    "src/index.ts": 'import { a } from "./lib.ts";\nconsole.log(a);\n',
    "src/lib.ts": "const a = 1;\nconst b = 2;\nconsole.log(b);\nexport {\n  a,\n  b,\n};\n",
  });
  await fix(dir, {});
  assert.equal(readFileSync(path.join(dir, "src/lib.ts"), "utf8"), "const a = 1;\nconst b = 2;\nconsole.log(b);\nexport {\n  a,\n};\n");
});

test("a value its file only reads in types (a schema behind typeof) keeps its export", async () => {
  const dir = repo({
    "src/index.ts": 'import type { Snapshot } from "./types.ts";\nconst s: Snapshot = { n: 1 };\nconsole.log(s);\n',
    "src/types.ts": "export const SnapshotSchema = { n: 1 };\nexport type Snapshot = typeof SnapshotSchema;\n",
  });
  const flagged = (await findings(dir)).filter((h) => h.symbols?.includes("SnapshotSchema"));
  assert.deepEqual(flagged, []);
});

test("a file a package.json script runs by path is an entry", async () => {
  const dir = repo({
    "package.json": JSON.stringify({ name: "t", private: true, type: "module", main: "src/index.ts", scripts: { "build:web": "esbuild src/web/app.ts --bundle --outdir=public" } }),
    "src/index.ts": "console.log(1);\n",
    "src/web/app.ts": "console.log('web');\n",
  });
  const files = (await findings(dir)).filter((h) => h.kind === "unused_file").map((h) => h.file);
  assert.deepEqual(files, []);
});

test("the stop hook lists at most ten findings in all, however many sections it has", async () => {
  const { stopHookReason } = await import("../src/agent/hook.ts");
  const dir = repo({ "src/index.ts": "console.log(1);\n" });
  const many = Array.from({ length: 14 }, (_, i) => `export const unused${i} = ${i};\n`).join("");
  writeFileSync(path.join(dir, "src/index.ts"), 'import "./extra.ts";\nconsole.log(1);\n');
  writeFileSync(path.join(dir, "src/extra.ts"), many + "console.log(0);\n");
  const reason = (await stopHookReason(dir, "s1")) ?? "";
  const listed = reason.split("\n").filter((l) => /^src\//.test(l));
  assert.equal(listed.length, 10);
  assert.match(reason, /…and 4 more/);
});
