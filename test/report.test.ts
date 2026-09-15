import test from "node:test";
import assert from "node:assert/strict";
import { headline, kindRows, noteMarkdown, suggestsDeletion, summaryMarkdown } from "../src/report/report.ts";
import { hunk, note, scan } from "./helpers.ts";

const FORBIDDEN = [/possibly/i, /\(observed\)/, /might be/i, /bugbot/i, /seems/i];

const sample = scan(
  [
    hunk({ id: "dup", kind: "dup", safe: false, file: "src/money.ts", startLine: 3, endLine: 28 }),
    hunk({ id: "ex1", startLine: 1, endLine: 3 }),
    hunk({ id: "ex2", startLine: 10, endLine: 12 }),
    hunk({ id: "file", kind: "unused_file", file: "src/old.ts", startLine: 1, endLine: 6 }),
    hunk({ id: "cm", kind: "claudeism", startLine: 20, endLine: 20 }),
    note({ id: "nm", file: "src/h.ts", startLine: 5, endLine: 7 }),
  ],
  { llm: null },
);

test("the headline is the whole result: deletions, lines, tokens, and comment-only notes", () => {
  // tokens come from the hunks' text: five copies of a 24-character line is 120 characters, ~30 tokens
  assert.equal(headline(sample.hunks), "5 deletions · 39 lines · ~30 tokens · 1 naming note");
  assert.equal(headline([]), "nothing to delete");
  assert.equal(headline([hunk()]), "1 deletion · 1 line · ~6 tokens");
  assert.equal(headline([note(), note({ kind: "pattern", startLine: 9 })]), "2 notes");
});

test("kind rows are sorted by lines, most first, ties by hunk count", () => {
  const rows = kindRows(sample.hunks).map((r) => `${r.kind}:${r.hunks}/${r.lines}/${r.safe}`);
  assert.deepEqual(rows, ["dup:1/26/0", "unused_export:2/6/2", "unused_file:1/6/1", "naming:1/3/0", "claudeism:1/1/1"]);
  assert.equal(kindRows(sample.hunks).find((r) => r.kind === "naming")?.deletable, false);
});

test("the PR summary: headline first, meta line, worst kind in row one, legend, no hedging", () => {
  const md = summaryMarkdown(sample, {
    base: "c84b8383dcf9a63038f0f0a7a85260c84a42cb4d",
    head: "5545441fc674fe0bab5ec6b0c3e799332dbe0a78",
    posted: 6,
    total: 6,
  });
  const lines = md.split("\n");
  assert.equal(lines[0], "## 5 deletions · 39 lines · ~30 tokens · 1 naming note");
  assert.equal(lines[2], "c84b838 → 5545441 · 4 files · mechanical · 6 inline");
  const rows = lines.filter((l) => l.startsWith("| `"));
  assert.equal(rows[0], "| `dup` | 1 | 26 | 0/1 |");
  assert.equal(rows[rows.length - 2], "| `naming` (comment) | 1 | 3 | 0/1 |");
  assert.ok(md.includes("<sub>"));
  for (const re of FORBIDDEN) assert.doesNotMatch(md, re);
});

test("the summary says when notes could not be anchored, and shows the llm model when one ran", () => {
  const md = summaryMarkdown(scan(sample.hunks, { llm: "gemini-2.5-flash" }), { posted: 4, total: 6, skipped: 2 });
  assert.match(md, /· llm gemini-2\.5-flash · 4 of 6 inline, 2 outside the diff$/m);
});

test("an empty scan is a distinct headline with no table", () => {
  const md = summaryMarkdown(scan([]), { base: "main" });
  assert.equal(md, "## nothing to delete\n\nagainst main · mechanical");
});

test("inline notes: delete hunks carry an empty suggestion over their range; files and naming do not", () => {
  const del = noteMarkdown(hunk({ reason: "Exported thing is never referenced." }), "It has no callers.");
  assert.equal(del, "**skrub** · `unused_export` · safe\n\nExported thing is never referenced.\n\nIt has no callers.\n\n```suggestion\n```");
  assert.equal(suggestsDeletion(hunk({ kind: "unused_file" })), false);
  assert.doesNotMatch(noteMarkdown(hunk({ kind: "unused_file" })), /suggestion/);
  assert.equal(suggestsDeletion(note()), false);
  // A judgment call (a wrapper, a copy) needs its callers updated; one click can't do that.
  assert.equal(suggestsDeletion(hunk({ kind: "glue", safe: false })), false);
  assert.doesNotMatch(noteMarkdown(hunk({ kind: "glue", safe: false })), /```suggestion/);
  assert.equal(noteMarkdown(note()), "**skrub** · `naming`\n\nExported name 'data' doesn't say what this is.");
});
