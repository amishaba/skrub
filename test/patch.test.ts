import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { applyHunksToText, buildPatch } from "../src/patch/patch.ts";
import { gitApply, gitApplyCheck } from "../src/git/git.ts";
import { hunk, project } from "./helpers.ts";

const FILE = "export const a = 1;\nexport const dead = 2;\nexport const b = 3;\nexport const alsoDead = 4;\n";

test("applyHunksToText removes each range, bottom-up, so earlier line numbers stay valid", () => {
  const out = applyHunksToText(FILE, [
    hunk({ startLine: 2, endLine: 2, text: "export const dead = 2;\n" }),
    hunk({ startLine: 4, endLine: 4, text: "export const alsoDead = 4;\n" }),
  ]);
  assert.equal(out, "export const a = 1;\nexport const b = 3;\n");
});

test("applyHunksToText refuses a hunk whose text no longer matches the file", () => {
  assert.throws(
    () => applyHunksToText(FILE, [hunk({ id: "stale", startLine: 2, endLine: 2, text: "export const gone = 0;\n" })]),
    /hunk stale does not match/,
  );
});

test("buildPatch writes a unified diff per file, a deletion for unused files, and nothing for no-ops", async () => {
  const dir = project({ "src/a.ts": FILE, "src/orphan.ts": "export const x = 1;\n" });
  const patch = await buildPatch(dir, [
    hunk({ file: "src/a.ts", startLine: 2, endLine: 2, text: "export const dead = 2;\n" }),
    hunk({ file: "src/orphan.ts", kind: "unused_file", startLine: 1, endLine: 1, text: "export const x = 1;\n" }),
  ]);
  assert.match(patch, /^diff --git a\/src\/a\.ts b\/src\/a\.ts\n/m);
  assert.match(patch, /^-export const dead = 2;$/m);
  assert.match(patch, /^diff --git a\/src\/orphan\.ts b\/src\/orphan\.ts\ndeleted file mode 100644\n/m);
  assert.doesNotMatch(patch, /\+export/);
});

test("the patch skrub builds is one git will apply, and applying it leaves exactly the kept lines", async () => {
  const dir = project({ "src/a.ts": FILE, "src/orphan.ts": "export const x = 1;\n" });
  const git = (...args: string[]) =>
    execFileSync("git", args, {
      cwd: dir,
      env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" },
      stdio: "pipe",
    }).toString();
  git("init", "-q");
  git("add", ".");
  git("commit", "-q", "-m", "seed");

  const patch = await buildPatch(dir, [
    hunk({ file: "src/a.ts", startLine: 2, endLine: 2, text: "export const dead = 2;\n" }),
    hunk({ file: "src/a.ts", startLine: 4, endLine: 4, text: "export const alsoDead = 4;\n" }),
    hunk({ file: "src/orphan.ts", kind: "unused_file", startLine: 1, endLine: 1, text: "export const x = 1;\n" }),
  ]);
  const check = await gitApplyCheck(dir, patch);
  assert.equal(check.ok, true, check.error);
  await gitApply(dir, patch);
  assert.equal(readFileSync(path.join(dir, "src/a.ts"), "utf8"), "export const a = 1;\nexport const b = 3;\n");
  assert.equal(git("status", "--porcelain").trim(), " M src/a.ts\n D src/orphan.ts".trim());
});

test("a file that changed since the scan fails git apply --check instead of corrupting it", async () => {
  const dir = project({ "src/a.ts": FILE });
  execFileSync("git", ["init", "-q"], { cwd: dir });
  const patch = await buildPatch(dir, [hunk({ file: "src/a.ts", startLine: 2, endLine: 2, text: "export const dead = 2;\n" })]);
  writeFileSync(path.join(dir, "src/a.ts"), "// rewritten\n" + FILE);
  const check = await gitApplyCheck(dir, patch);
  assert.equal(check.ok, false);
});
