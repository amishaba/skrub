import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { loadConfig } from "../src/config.ts";
import { loadProgram } from "../src/program/program.ts";
import { caseOf, mine, parseConventions, renderConventions, rulesFrom } from "../src/conventions/conventions.ts";
import { establish } from "../src/conventions/establish.ts";
import { diffScope } from "../src/git/diff.ts";
import { analyze } from "../src/scan/analyze.ts";
import { project } from "./helpers.ts";

/** Six kebab-case modules with named, declared exports and `.ts` imports, tests in test/. */
function house(extra: Record<string, string> = {}): Record<string, string> {
  const files: Record<string, string> = {
    "src/index.ts": 'import { one } from "./mod-one.ts";\nexport function main() {\n  return one();\n}\n',
  };
  const names = ["one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
  for (const [i, n] of names.entries()) {
    const next = names[i + 1];
    files[`src/mod-${n}.ts`] = next
      ? `import { ${next} } from "./mod-${next}.ts";\nexport function ${n}() {\n  return ${next}();\n}\n`
      : `export function ${n}() {\n  return 1;\n}\n`;
  }
  for (const n of names.slice(0, 4)) files[`test/mod-${n}.test.ts`] = `import "../src/mod-${n}.ts";\n`;
  return { ...files, ...extra };
}

function git(dir: string, ...args: string[]) {
  execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", ...args], { cwd: dir, stdio: "pipe" });
}

test("a name's case is read only when it has more than one word", () => {
  assert.equal(caseOf("user-profile"), "kebab-case");
  assert.equal(caseOf("userProfile"), "camelCase");
  assert.equal(caseOf("UserProfile"), "PascalCase");
  assert.equal(caseOf("user_profile"), "snake_case");
  assert.equal(caseOf("Button"), "PascalCase");
  assert.equal(caseOf("utils"), null);
  assert.equal(caseOf("index"), null);
});

test("conventions are read from the code, and only what the code agrees on becomes a rule", async () => {
  const dir = project(house({ "src/oddOne.ts": "export const odd = () => 1;\n" }));
  git(dir, "init", "-q");
  const mined = mine(await loadProgram(dir, await loadConfig(dir)));
  assert.deepEqual(rulesFrom(mined), {
    "file-names": "kebab-case",
    tests: "separate-folder",
    "test-suffix": ".test",
    exports: "named",
    barrels: "no",
    "import-extensions": ".ts",
    functions: "declarations",
  });
  // 10 of 11 is above the bar; the outlier is counted, not hidden
  assert.match(renderConventions(mined, ""), /- file names: kebab-case \(10 of 11\)/);
});

test("a repo that disagrees with itself gets no rule for it, just a description", async () => {
  const dir = project({
    "src/index.ts": "export function main() {}\n",
    "src/a-one.ts": "export function a() {}\n",
    "src/b-two.ts": "export const b = () => 1;\n",
    "src/c-three.ts": "export function c() {}\n",
    "src/d-four.ts": "export const d = () => 1;\n",
  });
  const mined = mine(await loadProgram(dir, await loadConfig(dir)));
  assert.equal(rulesFrom(mined).functions, undefined);
  assert.match(renderConventions(mined, ""), /exported functions: mixed \(3 declarations, 2 arrows\); not enforced/);
});

test("rewriting the file keeps the notes; parseConventions reads back what renderConventions wrote", async () => {
  const dir = project(house());
  git(dir, "init", "-q");
  await establish(dir);
  const file = path.join(dir, ".claude/conventions.md");
  const notes = "- money is integer cents, named *Cents\n";
  writeFileSync(file, readFileSync(file, "utf8").replace(/## notes\n[\s\S]*$/, `## notes\n\n${notes}`));
  const { drift, wrote } = await establish(dir, true);
  assert.deepEqual(drift, []);
  assert.equal(wrote, true);
  const back = parseConventions(readFileSync(file, "utf8"));
  assert.equal(back.notes.trim(), notes.trim());
  assert.equal(back.rules["file-names"], "kebab-case");
});

test("drift: when the code moves away from what's written, conventions says so and writes nothing", async () => {
  const dir = project(house());
  git(dir, "init", "-q");
  await establish(dir);
  const file = path.join(dir, ".claude/conventions.md");
  writeFileSync(file, readFileSync(file, "utf8").replace("functions: declarations", "functions: arrows"));
  const before = readFileSync(file, "utf8");
  const { drift, wrote } = await establish(dir);
  assert.deepEqual(drift, ["functions: written arrows, code now declarations (11 of 11)"]);
  assert.equal(wrote, false);
  assert.equal(readFileSync(file, "utf8"), before);
});

test("new code that breaks a recorded convention gets a note, and old code that already did doesn't", async () => {
  const dir = project(
    house({
      "src/legacyThing.ts": "export default function legacy() {\n  return 0;\n}\n",
      ".claude/conventions.md":
        "---\nfile-names: kebab-case\ntests: separate-folder\nexports: named\nimport-extensions: .ts\nfunctions: declarations\n---\n\n## notes\n",
    }),
  );
  git(dir, "init", "-q");
  git(dir, "add", "-A");
  git(dir, "commit", "-qm", "base");
  writeFileSync(
    path.join(dir, "src/userProfile.ts"),
    'import { two } from "./mod-two";\nexport default function profile() {\n  return two();\n}\nexport const helper = () => profile();\n',
  );
  writeFileSync(path.join(dir, "src/mod-one.test.ts"), 'import "./mod-one.ts";\n');
  writeFileSync(
    path.join(dir, "src/index.ts"),
    'import { one } from "./mod-one.ts";\nimport profile, { helper } from "./userProfile.ts";\nexport function main() {\n  return one() + profile() + helper();\n}\n',
  );
  const diff = await diffScope(dir, "HEAD");
  const { hunks } = await analyze(dir, { ...(await loadConfig(dir)), maxHunks: 100 }, { changed: diff!.files, diff, llm: false });
  const notes = hunks
    .filter((h) => h.kind === "convention")
    .map((h) => `${h.file}:${h.startLine} ${h.reason.split(";")[0]}`)
    .sort();
  assert.deepEqual(notes, [
    "src/mod-one.test.ts:1 This test is in a source folder",
    'src/userProfile.ts:1 "./mod-two" is extensionless',
    'src/userProfile.ts:1 "userProfile.ts" is camelCase',
    "src/userProfile.ts:2 A default export",
    "src/userProfile.ts:5 An exported arrow function",
  ]);
  assert.ok(hunks.filter((h) => h.kind === "convention").every((h) => h.action === "comment" && !h.safe));
});

test("a repo that uses barrels keeps them: the barrel isn't flagged as glue", async () => {
  const files = house({
    "src/lib/index.ts": 'export * from "./money.ts";\n',
    "src/lib/money.ts": "export function cents(n: number) {\n  return n * 100;\n}\n",
  });
  files["src/index.ts"] = 'import { one } from "./mod-one.ts";\nimport { cents } from "./lib/index.ts";\nexport function main() {\n  return one() + cents(1);\n}\n';
  const dir = project(files);
  const scan = async () => (await analyze(dir, await loadConfig(dir), { changed: null, llm: false })).hunks.filter((h) => h.kind === "glue");
  assert.equal((await scan()).length, 1, "without a conventions file, a barrel is glue");
  mkdirSync(path.join(dir, ".claude"));
  writeFileSync(path.join(dir, ".claude/conventions.md"), "---\nbarrels: yes\n---\n");
  assert.equal((await scan()).length, 0);
});

test("another app in the same repo isn't held to this one's conventions", async () => {
  const dir = project(house({ ".claude/conventions.md": "---\nfile-names: kebab-case\n---\n" }));
  git(dir, "init", "-q");
  git(dir, "add", "-A");
  git(dir, "commit", "-qm", "base");
  mkdirSync(path.join(dir, "web/src"), { recursive: true });
  writeFileSync(path.join(dir, "web/src/useReplayClock.ts"), "export function useReplayClock() {\n  return 0;\n}\n");
  writeFileSync(path.join(dir, "src/newThing.ts"), "export function newThing() {\n  return 0;\n}\n");
  writeFileSync(path.join(dir, "src/index.ts"), 'import { newThing } from "./newThing.ts";\nexport function main() {\n  return newThing();\n}\n');
  const diff = await diffScope(dir, "HEAD");
  const { hunks } = await analyze(dir, await loadConfig(dir), { changed: diff!.files, diff, llm: false });
  assert.deepEqual(
    hunks.filter((h) => h.kind === "convention").map((h) => h.file),
    ["src/newThing.ts"],
  );
});
