import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { loadConfig } from "../src/config.ts";
import { diffScope } from "../src/git/diff.ts";
import { analyze } from "../src/scan/analyze.ts";
import { establish } from "../src/conventions/establish.ts";
import { alreadyThere, preWriteReason } from "../src/agent/prewrite.ts";
import { addPreWriteHook, addStopHook } from "../src/agent/install.ts";
import type { Hunk } from "../src/hunk.ts";
import { project } from "./helpers.ts";

/** A committed repo, then the agent's change on top, uncommitted. */
function repo(before: Record<string, string>, after: Record<string, string>): string {
  const dir = project(before);
  const git = (...args: string[]) => execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", ...args], { cwd: dir, stdio: "pipe" });
  git("init", "-q");
  git("add", "-A");
  git("commit", "-qm", "base");
  for (const [rel, text] of Object.entries(after)) writeFileSync(path.join(dir, rel), text);
  return dir;
}

async function scanChange(dir: string): Promise<Hunk[]> {
  const diff = await diffScope(dir, "HEAD");
  return (await analyze(dir, await loadConfig(dir), { changed: diff!.files, diff, llm: false })).hunks;
}

const DROPDOWN = `import { useState } from "react";

export function Dropdown({ options, value, onChange }: { options: string[]; value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative inline-block text-left w-48">
      <button onClick={() => setOpen(!open)} className="px-3 py-2 border rounded-md">{value}</button>
      {open && (
        <ul className="absolute mt-1 w-full bg-white shadow-lg">
          {options.map((o) => (
            <li key={o} onClick={() => { onChange(o); setOpen(false); }}>{o}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
`;

const BASE = {
  "src/index.ts": 'export { Settings } from "./Settings.tsx";\nexport { Profile } from "./Profile.tsx";\nexport { Team } from "./Team.tsx";\n',
  "src/Dropdown.tsx": DROPDOWN,
  "src/api.ts": "export async function getInvoices() {\n  return fetch(`/api/invoices`).then((r) => r.json());\n}\n",
  "src/Settings.tsx": 'import { Dropdown } from "./Dropdown.tsx";\nimport { getInvoices } from "./api.ts";\nexport const Settings = () => { void getInvoices(); return <Dropdown options={["a"]} value="a" onChange={() => {}} />; };\n',
  "src/Profile.tsx": 'import { Dropdown } from "./Dropdown.tsx";\nexport const Profile = () => <Dropdown options={["b"]} value="b" onChange={() => {}} />;\n',
  "src/Team.tsx": "export const Team = () => <p>team</p>;\n",
};

test("reuse: a new near-copy of a shared component, a fetch a wrapper already does, and a component's classes copied", async () => {
  const dir = repo(BASE, {
    "src/Team.tsx": `import { useState } from "react";

export const Team = () => <StatusDropdown statuses={["on", "off"]} current="on" onPick={() => {}} />;

export function StatusDropdown({ statuses, current, onPick }: { statuses: string[]; current: string; onPick: (v: string) => void }) {
  const [shown, setShown] = useState(false);
  void fetch("/api/invoices?status=open");
  return (
    <div className="w-48 relative inline-block text-left">
      <button onClick={() => setShown(!shown)} className="px-3 py-2 border rounded-md">{current}</button>
      {shown && (
        <ul className="absolute mt-1 w-full bg-white shadow-lg">
          {statuses.map((s) => (
            <li key={s} onClick={() => { onPick(s); setShown(false); }}>{s}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
`,
  });
  const reuse = (await scanChange(dir)).filter((h) => h.kind === "reuse");
  assert.ok(reuse.every((h) => h.action === "comment" && !h.safe), "reuse findings are notes, never deletions");
  const reasons = reuse.map((h) => h.reason);
  assert.ok(
    reasons.some((r) => /% the same as Dropdown in src\/Dropdown\.tsx:3, which 2 files already use\. Reuse or extend/.test(r)),
    reasons.join("\n"),
  );
  assert.ok(reasons.includes("getInvoices in src/api.ts:2 already calls GET /api/invoices. Call it instead of fetching here."), reasons.join("\n"));
  assert.equal(reasons.filter((r) => r.startsWith("Same classes as <Dropdown>")).length, 1, "one note per copied component");
  assert.ok(reasons.some((r) => r.startsWith("Same classes as <Dropdown> in src/Dropdown.tsx:6.")), reasons.join("\n"));
});

test("reuse: a fetch two files repeat, with no wrapper yet, asks for one typed function", async () => {
  const dir = repo(
    { ...BASE, "src/Team.tsx": 'export const Team = () => { void fetch("/api/members/" + 1); return null; };\nexport const Members = () => { void fetch(`/api/team/${1}`); return null; };\n' },
    {
      "src/Profile.tsx": BASE["src/Profile.tsx"] + "export function loadTeam(id: number) {\n  return fetch(`/api/team/${id}?full=1`);\n}\n",
      "src/index.ts": BASE["src/index.ts"] + 'export { loadTeam } from "./Profile.tsx";\n',
    },
  );
  const reasons = (await scanChange(dir)).filter((h) => h.kind === "reuse").map((h) => h.reason);
  assert.ok(reasons.includes("GET /api/team/:param is also called in src/Team.tsx:2. Give it one typed function that every caller uses."), reasons.join("\n"));
});

test("fold: a small new file only one other file uses belongs in that file; naming: a utils.ts says nothing", async () => {
  const dir = repo(BASE, {
    "src/teamName.ts": "export function teamName(t: string) {\n  return t.trim();\n}\n",
    "src/Team.tsx": 'import { teamName } from "./teamName.ts";\nimport { clamp } from "./utils.ts";\nexport const Team = () => <p>{teamName(" team ")}{clamp(1)}</p>;\n',
    "src/utils.ts": "export function clamp(n: number) {\n  return Math.max(0, n);\n}\n",
  });
  const hunks = await scanChange(dir);
  assert.equal(hunks.find((h) => h.kind === "fold")?.reason, "Only src/Team.tsx uses this file. Keep it in src/Team.tsx until a second file needs it.");
  assert.ok(hunks.some((h) => h.kind === "naming" && h.file === "src/utils.ts" && /doesn't say what's in it/.test(h.reason)));
});

test("conventions list what the repo shares, most used first; init refreshes that list without touching rules or notes, a plain run only reports it", async () => {
  const dir = repo(BASE, {});
  await establish(dir);
  const file = path.join(dir, ".claude/conventions.md");
  const text = readFileSync(file, "utf8");
  assert.match(text, /## use these first\n[\s\S]*- `Dropdown`: component in src\/Dropdown\.tsx, used by 2 files/);
  assert.ok(text.indexOf("## use these first") < text.indexOf("## notes"));
  writeFileSync(file, text.replace(/(## notes\n\n)<!--[\s\S]*?-->/, "$1- money is always in cents"));
  writeFileSync(path.join(dir, "src/Team.tsx"), 'import { Dropdown } from "./Dropdown.tsx";\nexport const Team = () => <Dropdown options={[]} value="" onChange={() => {}} />;\n');
  const report = await establish(dir);
  assert.ok(report.drift.some((d) => d.startsWith("use these first")), "a plain run reports the change");
  assert.match(readFileSync(file, "utf8"), /used by 2 files/, "and leaves the file alone");
  await establish(dir, false, true);
  const after = readFileSync(file, "utf8");
  assert.match(after, /`Dropdown`: component in src\/Dropdown\.tsx, used by 3 files/);
  assert.match(after, /## notes\n\n- money is always in cents/);
});

test("before a new file repeats what exists, the Write hook says where it is, once per file", async () => {
  const dir = repo(BASE, {});
  const content = DROPDOWN.replace("export function Dropdown", "export function StatusDropdown").replace("w-48", "w-56");
  const reason = await preWriteReason(dir, "s1", "src/StatusDropdown.tsx", content);
  assert.match(reason ?? "", /^skrub: before you add src\/StatusDropdown\.tsx, the repo already has this:/);
  assert.match(reason ?? "", /`Dropdown` \(component in src\/Dropdown\.tsx\) is used by 2 files\./);
  assert.match(reason ?? "", /StatusDropdown is \d+% the same as Dropdown in src\/Dropdown\.tsx:3\./);
  assert.equal(await preWriteReason(dir, "s1", "src/StatusDropdown.tsx", content), null, "writing it again goes through");
  assert.equal(await preWriteReason(dir, "s2", "src/Badge.tsx", "export const Badge = () => <b>new</b>;\n"), null, "new code that repeats nothing");
  assert.equal(await preWriteReason(dir, "s2", "src/Dropdown.tsx", DROPDOWN), null, "editing an existing file is not this hook's business");
});

test("init's Write hook sits beside the Stop hook and updates in place", async () => {
  const dir = project({});
  const file = path.join(dir, ".claude/settings.json");
  await addStopHook(file, "npx skrub hook");
  await addPreWriteHook(file, "npx skrub prewrite");
  await addPreWriteHook(file, "node /x/bin/skrub.mjs prewrite");
  const settings = JSON.parse(readFileSync(file, "utf8"));
  assert.deepEqual(settings.hooks.PreToolUse, [{ matcher: "Write", hooks: [{ type: "command", command: "node /x/bin/skrub.mjs prewrite", timeout: 30 }] }]);
  assert.equal(settings.hooks.Stop[0].hooks[0].command, "npx skrub hook");
});

test("an import read through `{ foo }` or `export { foo }` is used; one only shadowed by a local is not", async () => {
  const dir = project({
    "src/index.ts":
      'import { a, b, c } from "./lib.ts";\nexport const config = { a };\nexport { b };\nexport function f() {\n  const c = 1;\n  return c;\n}\n',
    "src/lib.ts": "export const a = 1;\nexport const b = 2;\nexport const c = 3;\n",
  });
  const { hunks } = await analyze(dir, await loadConfig(dir), { changed: null, llm: false });
  assert.deepEqual(hunks.filter((h) => h.kind === "unused_import"), [], "a and b are read, so the import stays");

  const shadowed = project({
    "src/index.ts": 'import { c } from "./lib.ts";\nexport function f() {\n  const c = 1;\n  return c;\n}\n',
    "src/lib.ts": "export const c = 3;\n",
  });
  const found = (await analyze(shadowed, await loadConfig(shadowed), { changed: null, llm: false })).hunks;
  assert.deepEqual(
    found.filter((h) => h.kind === "unused_import").map((h) => h.text),
    ['import { c } from "./lib.ts";\n'],
    "a local c that shadows the import doesn't read it",
  );
});

test("fold counts files that only import types: an interface three files use has earned its file", async () => {
  const dir = repo(BASE, {
    "src/reporter.ts": "export interface Reporter {\n  log(text: string): void;\n}\nexport const silent: Reporter = { log() {} };\n",
    "src/Team.tsx": 'import { silent, type Reporter } from "./reporter.ts";\nexport const Team = () => { silent.log("x"); return null; };\n',
    "src/Profile.tsx": BASE["src/Profile.tsx"] + 'import type { Reporter } from "./reporter.ts";\nexport const r: Reporter | null = null;\n',
  });
  assert.equal((await scanChange(dir)).filter((h) => h.kind === "fold").length, 0);
});

test("the Write hook doesn't count a barrel that re-exports the very file being written as a second copy", async () => {
  const dir = repo({ ...BASE, "src/export.ts": 'export * from "./csv.ts";\n', "src/index.ts": BASE["src/index.ts"] + 'export * from "./export.ts";\n' }, {});
  assert.deepEqual(await alreadyThere(dir, "src/csv.ts", "export function toCsv(rows: string[]) {\n  return rows.join(\",\");\n}\n"), []);
});
