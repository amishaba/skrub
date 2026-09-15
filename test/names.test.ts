import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { loadConfig } from "../src/config.ts";
import { diffScope } from "../src/git/diff.ts";
import { analyze } from "../src/scan/analyze.ts";
import { establish } from "../src/conventions/establish.ts";
import { project } from "./helpers.ts";

/** A repo whose conventions are read from `before` and committed, then `after` on top, uncommitted. */
async function repo(before: Record<string, string>, after: Record<string, string | null>): Promise<string> {
  const dir = project(before);
  await establish(dir);
  const git = (...args: string[]) => execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", ...args], { cwd: dir, stdio: "pipe" });
  git("init", "-q");
  git("add", "-A");
  git("commit", "-qm", "base");
  for (const [rel, text] of Object.entries(after)) {
    if (text == null) rmSync(path.join(dir, rel));
    else writeFileSync(path.join(dir, rel), text);
  }
  return dir;
}

async function notes(dir: string): Promise<string[]> {
  const diff = await diffScope(dir, "HEAD");
  const { hunks } = await analyze(dir, await loadConfig(dir), { changed: diff!.files, diff, llm: false });
  return hunks.filter((h) => h.kind === "convention").map((h) => h.reason);
}

const rules = (dir: string) => readFileSync(path.join(dir, ".claude/conventions.md"), "utf8");

test("boolean functions: a repo that names them is…/has… gets a note for one that doesn't", async () => {
  const lib = ["isOpen", "hasItems", "canEdit", "isEmpty", "shouldRetry"].map((n) => `export function ${n}(x: number): boolean {\n  return x > 0;\n}\n`).join("");
  const dir = await repo(
    { "src/index.ts": 'export * from "./lib.ts";\n', "src/lib.ts": lib },
    { "src/lib.ts": lib + "export function valid(x: number): boolean {\n  return x > 1;\n}\nexport function isReady(x: number): boolean {\n  return x > 2;\n}\n" },
  );
  assert.match(rules(dir), /boolean-names: is\/has prefix/);
  assert.deepEqual(await notes(dir), ['"valid" returns a boolean; this repo\'s functions that return a boolean: is/has prefix (.claude/conventions.md).']);
});

test("endpoint verbs: the verb the repo uses for fetches, and a note for a new one that uses another", async () => {
  const api = ["Invoices", "Users", "Teams", "Plans"].map((n) => `export function fetch${n}() {\n  return fetch("/api/${n.toLowerCase()}");\n}\n`).join("");
  const dir = await repo(
    { "src/index.ts": 'export * from "./api.ts";\n', "src/api.ts": api },
    { "src/api.ts": api + 'export function loadOrders() {\n  return fetch("/api/orders");\n}\n' },
  );
  assert.match(rules(dir), /endpoint-verbs: fetch/);
  assert.deepEqual(await notes(dir), ['"loadOrders" calls an endpoint; this repo\'s verb for functions that call an endpoint: fetch (.claude/conventions.md).']);
});

test("hooks and component files: use… for functions that call hooks, and a file named after its component", async () => {
  const hook = (n: string) => `import { useState } from "react";\nexport function use${n}() {\n  return useState(0);\n}\n`;
  const component = (n: string) => `export function ${n}() {\n  return <p>${n}</p>;\n}\n`;
  const before: Record<string, string> = {
    "src/index.ts": ["Alpha", "Beta", "Gamma", "Delta"].map((n) => `export * from "./${n}.tsx";\nexport * from "./hooks${n}.ts";\n`).join(""),
  };
  for (const n of ["Alpha", "Beta", "Gamma", "Delta"]) {
    before[`src/${n}.tsx`] = component(n);
    before[`src/hooks${n}.ts`] = hook(n);
  }
  const dir = await repo(before, {
    "src/index.ts": before["src/index.ts"] + 'export * from "./bar.tsx";\n',
    "src/bar.tsx": component("StatusBar"),
    "src/hooksAlpha.ts": hook("Alpha") + 'import { useEffect } from "react";\nexport function syncTitle() {\n  useEffect(() => {}, []);\n}\n',
  });
  assert.match(rules(dir), /hook-names: use prefix/);
  assert.match(rules(dir), /component-names: named after the component/);
  assert.deepEqual((await notes(dir)).sort(), [
    '"syncTitle" calls hooks; this repo\'s functions that call hooks: use prefix (.claude/conventions.md).',
    'StatusBar is in "bar.tsx"; this repo\'s component files: named after the component (.claude/conventions.md).',
  ]);
});

test("moved or reformatted code isn't new: only code the diff wrote gets a convention note", async () => {
  const decls = ["one", "two", "three", "four"].map((n) => `export function ${n}() {\n  return "${n}";\n}\n`).join("");
  const old = 'export const legacy = (id: number) => {\n  return { id, label: "x" };\n};\n';
  const dir = await repo(
    { "src/index.ts": 'export * from "./a.ts";\nexport * from "./b.ts";\n', "src/a.ts": decls + old, "src/b.ts": "export const B = 1;\n" },
    {
      "src/a.ts": decls,
      // the old arrow, moved and reformatted with single quotes; and a brand-new one
      "src/b.ts": "export const B = 1;\nexport const legacy = (id: number) => {\n    return { id, label: 'x' }\n};\nexport const fresh = () => 2;\n",
    },
  );
  assert.match(rules(dir), /functions: declarations/);
  assert.deepEqual(await notes(dir), ['An exported arrow function; this repo\'s exported functions: declarations (.claude/conventions.md).']);
});
