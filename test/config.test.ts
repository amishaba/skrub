import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { emptyScope, loadConfig } from "../src/config.ts";
import { execFileSync } from "node:child_process";
import { prContextFromEnv } from "../src/github/pr.ts";
import { project } from "./helpers.ts";

test("without a config, entries come from package.json main/bin/exports plus src/index.ts", async () => {
  const dir = project({
    "package.json": JSON.stringify({
      main: "dist/main.js",
      bin: { tool: "bin/tool.mjs" },
      exports: { ".": { import: "./dist/i.js", require: "./dist/i.cjs" } },
    }),
  });
  const c = await loadConfig(dir);
  assert.deepEqual(c.entries, ["dist/main.js", "bin/tool.mjs", "./dist/i.js", "./dist/i.cjs", "src/index.ts"]);
  assert.deepEqual(c.include, ["src"]);
  assert.equal(c.maxHunks, 40);
});

test("without a package.json, src/index.ts is the only entry", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "skrub-cfg-"));
  assert.deepEqual((await loadConfig(dir)).entries, ["src/index.ts"]);
});

test("a skrub.config file overrides fields; bad values fall back to defaults", async () => {
  const dir = project({});
  writeFileSync(
    path.join(dir, "skrub.config.mjs"),
    'export default { include: ["lib"], exclude: ["lib/gen"], entries: ["lib/cli.ts"], maxHunks: -1 };\n',
  );
  const c = await loadConfig(dir);
  assert.deepEqual(c, { include: ["lib"], exclude: ["lib/gen"], entries: ["lib/cli.ts"], maxHunks: 40 });
});

test("the PR context comes from the Actions event file when there is one", async () => {
  const eventPath = path.join(mkdtempSync(path.join(tmpdir(), "skrub-ev-")), "event.json");
  writeFileSync(
    eventPath,
    JSON.stringify({
      pull_request: { number: 3, head: { sha: "h".repeat(40) }, base: { sha: "b".repeat(40), ref: "main" } },
      repository: { full_name: "amishaba/unvibe" },
    }),
  );
  const prev = process.env.GITHUB_EVENT_PATH;
  process.env.GITHUB_EVENT_PATH = eventPath;
  try {
    const ctx = await prContextFromEnv({});
    assert.deepEqual(ctx, {
      owner: "amishaba",
      repo: "unvibe",
      number: 3,
      headSha: "h".repeat(40),
      baseSha: "b".repeat(40),
      baseRef: "main",
    });
  } finally {
    if (prev == null) delete process.env.GITHUB_EVENT_PATH;
    else process.env.GITHUB_EVENT_PATH = prev;
  }
});

test("with no event, no flags, and no token, there is no PR context", async () => {
  const saved = { ...process.env };
  delete process.env.GITHUB_EVENT_PATH;
  delete process.env.GITHUB_REPOSITORY;
  delete process.env.GITHUB_TOKEN;
  delete process.env.GH_TOKEN;
  try {
    assert.equal(await prContextFromEnv({}), null);
    assert.equal(await prContextFromEnv({ pr: "3" }), null);
  } finally {
    process.env = saved;
  }
});

test("with no config and no src/, a scan says where the TypeScript is instead of finding nothing", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "skrub-scope-"));
  execFileSync("git", ["init", "-q"], { cwd: dir });
  assert.match((await emptyScope(dir)) ?? "", /none in this repo to scan/);
  for (const [file, body] of [["app/main.ts", "1"], ["app/lib.ts", "1"], ["lib/x.ts", "1"], ["test/a.ts", "1"], ["vite.config.ts", "1"]]) {
    mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    writeFileSync(path.join(dir, file), body);
  }
  assert.match((await emptyScope(dir)) ?? "", /include: \["app", "lib"\]/);
  mkdirSync(path.join(dir, "src"));
  assert.match((await emptyScope(dir)) ?? "", /none in src\/ to scan/, "an empty src/ has nothing to scan either");
  writeFileSync(path.join(dir, "src/main.ts"), "export const m = 1;\n");
  assert.equal(await emptyScope(dir), null);
});

test("a JavaScript project is told skrub reads TypeScript, instead of 'nothing to delete'", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "skrub-js-"));
  execFileSync("git", ["init", "-q"], { cwd: dir });
  mkdirSync(path.join(dir, "src"));
  writeFileSync(path.join(dir, "src/x.js"), "export const x = 1;\n");
  assert.equal(await emptyScope(dir), "skrub reads TypeScript (.ts and .tsx), and there's none in src/ to scan. This looks like a JavaScript project.");
  writeFileSync(path.join(dir, "src/y.ts"), "export const y = 1;\n");
  assert.equal(await emptyScope(dir), null);
});
