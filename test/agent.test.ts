import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { loadConfig } from "../src/config.ts";
import { diffScope, parseUnifiedDiff } from "../src/git/diff.ts";
import { analyze } from "../src/scan/analyze.ts";
import { inDiff } from "../src/scan/scope.ts";
import { addStopHook, gitignoreSkrubDir } from "../src/agent/install.ts";
import { runHint, selfCommand } from "../src/agent/self.ts";
import { hunk, project } from "./helpers.ts";

const BIN = path.resolve(import.meta.dirname, "../bin/skrub.mjs");

/** A project committed as the base, then `after` written on top, uncommitted (what an agent leaves). */
function repo(before: Record<string, string>, after: Record<string, string | null>): string {
  const dir = project(before);
  const git = (...args: string[]) => execFileSync("git", args, { cwd: dir, stdio: "pipe" });
  git("init", "-q");
  git("-c", "user.email=t@t", "-c", "user.name=t", "add", "-A");
  git("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "base");
  for (const [rel, text] of Object.entries(after)) {
    if (text == null) execFileSync("rm", [path.join(dir, rel)]);
    else writeFileSync(path.join(dir, rel), text);
  }
  return dir;
}

function skrub(dir: string, args: string[], stdin?: string): string {
  return execFileSync("node", [BIN, ...args], { cwd: dir, input: stdin, encoding: "utf8", env: { ...process.env, GEMINI_API_KEY: "" } });
}

test("a unified diff becomes added line ranges per file, new files whole, and the removed text", () => {
  const scope = parseUnifiedDiff(
    [
      "diff --git a/src/a.ts b/src/a.ts",
      "--- a/src/a.ts",
      "+++ b/src/a.ts",
      "@@ -3,0 +4,2 @@",
      "+one",
      "+two",
      "@@ -9 +11 @@",
      "-import { gone } from './x';",
      "+changed",
      "@@ -20,3 +22,0 @@",
      "-a",
      "diff --git a/src/new.ts b/src/new.ts",
      "new file mode 100644",
      "--- /dev/null",
      "+++ b/src/new.ts",
      "@@ -0,0 +1,3 @@",
      "diff --git a/src/old.ts b/src/old.ts",
      "deleted file mode 100644",
      "--- a/src/old.ts",
      "+++ /dev/null",
      "@@ -1 +0,0 @@",
      "-export const legacy = 1;",
    ].join("\n"),
  );
  assert.deepEqual(scope.files, ["src/a.ts", "src/new.ts"]);
  assert.deepEqual(scope.added.get("src/a.ts"), [
    [4, 5],
    [11, 11],
  ]);
  assert.equal(scope.added.get("src/new.ts"), "all");
  assert.match(scope.removed, /import \{ gone \}/);
  assert.match(scope.removed, /legacy/);
});

test("in a diff, skrub keeps what the diff wrote and what it orphaned, and leaves old code alone", () => {
  const diff = { files: ["src/a.ts"], added: new Map([["src/a.ts", [[10, 12]] as [number, number][]]]), removed: "import { oldHelper } from './b';" };
  const kept = inDiff(
    [
      hunk({ id: "touches", file: "src/a.ts", startLine: 12, endLine: 14 }),
      hunk({ id: "untouched", file: "src/a.ts", startLine: 1, endLine: 3 }),
      hunk({ id: "orphan", file: "src/b.ts", startLine: 5, endLine: 7, symbols: ["oldHelper"] }),
      hunk({ id: "prefix-only", file: "src/b.ts", startLine: 9, endLine: 9, symbols: ["old"] }),
      hunk({ id: "glue", kind: "glue", safe: false, file: "src/b.ts", startLine: 20, endLine: 22, symbols: ["oldHelper"] }),
    ],
    diff,
  );
  assert.deepEqual(
    kept.map((h) => h.id),
    ["touches", "orphan"],
  );
  assert.match(kept[1]!.reason, /This diff removed its last reference\.$/);
  assert.equal(inDiff(kept, diff)[1]!.reason, kept[1]!.reason, "scoping twice does not repeat the note");
});

test("untracked files count as wholly added, so an agent's new files are scanned", async () => {
  const dir = repo({ "src/index.ts": "export const a = 1;\n" }, { "src/fresh.ts": "export const b = 2;\n" });
  const scope = await diffScope(dir, "HEAD");
  assert.equal(scope?.added.get("src/fresh.ts"), "all");
});

test("a new function that renames an existing helper's parameters is a dup, and names the original", async () => {
  const sortBy =
    "export function sortBy(items: { values: Record<string, string> }[], field: string) {\n" +
    "  return [...items].sort((a, b) => String(a.values[field] ?? \"\").localeCompare(String(b.values[field] ?? \"\")));\n" +
    "}\n";
  const dir = repo(
    {
      "src/index.ts": 'import { sortBy } from "./sort.ts";\nexport const main = () => sortBy([], "k");\n',
      "src/sort.ts": sortBy,
    },
    {
      "src/index.ts":
        'import { sortBy } from "./sort.ts";\nimport { sortRows } from "./rows.ts";\nexport const main = () => [sortBy([], "k"), sortRows([], "k")];\n',
      "src/rows.ts": sortBy.replace("sortBy", "sortRows").replaceAll("items", "rows").replaceAll("field", "key"),
    },
  );
  const scope = await diffScope(dir, "HEAD");
  const { hunks } = await analyze(dir, await loadConfig(dir), { changed: scope!.files, diff: scope, llm: false });
  const dups = hunks.filter((h) => h.kind === "dup");
  assert.equal(dups.length, 1);
  assert.equal(dups[0]!.file, "src/rows.ts");
  assert.equal(dups[0]!.reason, "Same as sortBy in src/sort.ts:1. Use that one instead.");
});

test("a comment that paraphrases the next lines is flagged; one that says why is kept", async () => {
  const dir = project({
    "src/index.ts":
      'import { writeFile } from "node:fs/promises";\n' +
      "export async function save(report: { title: string }, csv: string) {\n" +
      "  // Write the CSV file next to the report.\n" +
      "  await writeFile(`${report.title}.csv`, csv);\n" +
      "  // Write the file twice: the first write is dropped on network drives.\n" +
      "  await writeFile(`${report.title}.csv`, csv);\n" +
      "  // Only the title, since the body can hold customer data.\n" +
      "  return report.title;\n" +
      "}\n",
  });
  const { hunks } = await analyze(dir, await loadConfig(dir), { changed: null, llm: false });
  const flagged = hunks.filter((h) => h.kind === "claudeism").map((h) => h.text.trim());
  assert.deepEqual(flagged, ["// Write the CSV file next to the report."]);
});

test("init adds one Stop hook, keeps every other setting, and updates in place when run again", async () => {
  const dir = project({
    ".claude/settings.json": JSON.stringify({
      permissions: { allow: ["Bash(npm test)"] },
      hooks: { Stop: [{ hooks: [{ type: "command", command: "say done" }] }] },
    }),
  });
  const file = path.join(dir, ".claude/settings.json");
  await addStopHook(file, "npx --yes @amishaba/skrub hook");
  await addStopHook(file, "node /x/bin/skrub.mjs hook");
  const settings = JSON.parse(readFileSync(file, "utf8"));
  assert.deepEqual(settings.permissions, { allow: ["Bash(npm test)"] });
  assert.deepEqual(
    settings.hooks.Stop.flatMap((g: { hooks: { command: string }[] }) => g.hooks.map((h) => h.command)),
    ["say done", "node /x/bin/skrub.mjs hook"],
  );
});

test("fix deletes the agent's dead code until none is left, and leaves the old dead code it didn't write", () => {
  const dir = repo(
    {
      "src/index.ts": 'import { a } from "./lib.ts";\nexport const main = () => a();\n',
      "src/lib.ts": "export function a() {\n  return 1;\n}\nexport function oldDead() {\n  return 0;\n}\n",
    },
    {
      "src/index.ts": 'import { a } from "./lib.ts";\nimport { b } from "./extra.ts";\nexport const main = () => a();\n',
      "src/extra.ts": "export function b() {\n  return 2;\n}\n",
    },
  );
  const out = skrub(dir, ["fix"]);
  assert.match(out, /applied in your uncommitted changes \(--whole-repo for everything\): 2 deletions · /);
  assert.equal(readFileSync(path.join(dir, "src/index.ts"), "utf8"), 'import { a } from "./lib.ts";\nexport const main = () => a();\n');
  // the import went first; that left extra.ts with no importer, and the next pass took the file
  assert.equal(existsSync(path.join(dir, "src/extra.ts")), false);
  assert.match(readFileSync(path.join(dir, "src/lib.ts"), "utf8"), /oldDead/);
});

test("fix says what it scanned, and --whole-repo looks past the uncommitted changes", () => {
  const dir = repo(
    { "src/index.ts": "export const main = () => 1;\n", "src/lib.ts": "export function oldDead() {\n  return 0;\n}\n" },
    { "README.md": "notes\n" },
  );
  assert.match(skrub(dir, ["fix", "--dry-run"]), /^skrub fix {2}nothing safe to delete in your uncommitted changes \(--whole-repo for everything\)$/m);
  assert.match(skrub(dir, ["fix", "--dry-run", "--whole-repo"]), /^skrub fix {2}would apply in the whole repo: 1 deletion · /m);
});

test("the Stop hook blocks once with the list, then lets the agent finish if nothing changed", () => {
  const dir = repo(
    { "src/index.ts": 'import { one } from "./lib.ts";\nexport const main = () => one();\n', "src/lib.ts": "export const one = () => 1;\n" },
    { "src/lib.ts": "export const one = () => 1;\nexport const leftover = 2;\n" },
  );
  const input = JSON.stringify({ session_id: "s", cwd: dir, hook_event_name: "Stop" });
  const first = JSON.parse(skrub(dir, ["hook"], input));
  assert.equal(first.decision, "block");
  assert.match(first.reason, /src\/lib\.ts:2 {2}unused_export · safe {2}Exported leftover is never referenced\./);
  assert.equal(skrub(dir, ["hook"], input), "");
  assert.equal(skrub(dir, ["hook"], JSON.stringify({ session_id: "other", cwd: dir })) !== "", true);
});

test("the Stop hook never blocks on a clean tree", () => {
  const dir = repo({ "src/index.ts": "export const main = () => 1;\n" }, {});
  assert.equal(skrub(dir, ["hook"], JSON.stringify({ session_id: "s", cwd: dir })), "");
});

test("a source file git calls binary (a raw NUL in a string) is still diffed by line", async () => {
  const dir = repo(
    { "src/index.ts": 'export const key = (s: string[]) => s.join("\0");\n' },
    { "src/index.ts": 'export const key = (s: string[]) => s.join("\0");\nexport const added = 1;\n' },
  );
  const scope = await diffScope(dir, "HEAD");
  assert.deepEqual(scope?.added.get("src/index.ts"), [[2, 2]]);
});

test("hooks and messages name skrub the way it was run, never a bare npx skrub outside the project", () => {
  const proj = path.join(tmpdir(), "proj");
  const npx = path.join(tmpdir(), ".npm", "_npx", "abc", "node_modules", "@amishaba", "skrub", "bin", "skrub.mjs");
  const local = path.join(proj, "node_modules", "@amishaba", "skrub", "bin", "skrub.mjs");
  const global = path.join(tmpdir(), "lib", "node_modules", "@amishaba", "skrub", "bin", "skrub.mjs");
  assert.equal(selfCommand(proj, npx), "npx --yes @amishaba/skrub");
  assert.equal(runHint(proj, npx), "npx @amishaba/skrub");
  assert.equal(selfCommand(proj, local), "npx skrub");
  assert.equal(selfCommand(proj, global), `node ${JSON.stringify(global)}`);
  assert.equal(runHint(proj, global), "skrub");
});

test("a repo with no commits yet is scanned whole, by hand and by the Stop hook, instead of failing on HEAD", async () => {
  const dir = project({
    "src/index.ts": 'import { a } from "./lib.ts";\nexport const main = () => a();\n',
    "src/lib.ts": "export function a() {\n  return 1;\n}\nexport function dead() {\n  return 2;\n}\n",
  });
  execFileSync("git", ["init", "-q"], { cwd: dir });
  const check = spawnSync("node", [BIN, "check", "--no-llm"], { cwd: dir, encoding: "utf8" });
  assert.equal(check.status, 1, "check exits 1 when something is safe to delete");
  assert.match(check.stdout, /Exported dead is never referenced/);
  const out = skrub(dir, ["hook"], JSON.stringify({ session_id: "s", cwd: dir }));
  assert.equal(JSON.parse(out).decision, "block");
});

test("init leaves .gitignore alone when git already ignores .skrub/ some other way", async () => {
  const dir = project({ "src/index.ts": "export const x = 1;\n" });
  execFileSync("git", ["init", "-q"], { cwd: dir });
  writeFileSync(path.join(dir, ".git/info/exclude"), ".skrub/\n");
  assert.equal(await gitignoreSkrubDir(dir), false);
  assert.equal(existsSync(path.join(dir, ".gitignore")), false);
  rmSync(path.join(dir, ".git/info/exclude"));
  assert.equal(await gitignoreSkrubDir(dir), true);
  assert.equal(readFileSync(path.join(dir, ".gitignore"), "utf8"), ".skrub/\n");
});
