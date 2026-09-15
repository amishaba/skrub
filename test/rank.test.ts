import test from "node:test";
import assert from "node:assert/strict";
import { dedupeHunks, rankHunks } from "../src/scan/rank.ts";
import { lineCount } from "../src/hunk.ts";
import { hunk } from "./helpers.ts";

test("safe hunks come first, then higher confidence, then more lines, then file:line", () => {
  const ranked = rankHunks(
    [
      hunk({ id: "unsafe-big", safe: false, confidence: 0.9, startLine: 1, endLine: 40 }),
      hunk({ id: "safe-low", safe: true, confidence: 0.5, startLine: 1, endLine: 1 }),
      hunk({ id: "safe-high-b", safe: true, confidence: 0.9, file: "src/b.ts", startLine: 5 }),
      hunk({ id: "safe-high-a", safe: true, confidence: 0.9, file: "src/a.ts", startLine: 9 }),
      hunk({ id: "safe-high-tall", safe: true, confidence: 0.9, startLine: 1, endLine: 3 }),
    ],
    10,
  ).map((h) => h.id);
  assert.deepEqual(ranked, ["safe-high-tall", "safe-high-a", "safe-high-b", "safe-low", "unsafe-big"]);
});

test("rankHunks caps at maxHunks after sorting", () => {
  const ranked = rankHunks(
    [hunk({ id: "x", safe: false }), hunk({ id: "y", safe: true }), hunk({ id: "z", safe: true, startLine: 2 })],
    2,
  ).map((h) => h.id);
  assert.deepEqual(ranked, ["y", "z"]);
});

test("an unused file swallows every other hunk in that file", () => {
  const kept = dedupeHunks([
    hunk({ id: "whole", kind: "unused_file", file: "src/x.ts", startLine: 1, endLine: 20 }),
    hunk({ id: "part", kind: "unused_export", file: "src/x.ts", startLine: 3, endLine: 5 }),
    hunk({ id: "other", kind: "unused_export", file: "src/y.ts", startLine: 3, endLine: 5 }),
  ]).map((h) => h.id);
  assert.deepEqual(kept.sort(), ["other", "whole"]);
});

test("overlapping ranges keep the one that starts first (larger on a tie); adjacent ranges both survive", () => {
  const kept = dedupeHunks([
    hunk({ id: "a", startLine: 10, endLine: 12 }),
    hunk({ id: "b", startLine: 11, endLine: 11 }),
    hunk({ id: "c", startLine: 16, endLine: 16 }),
    hunk({ id: "d", startLine: 10, endLine: 15 }),
  ]).map((h) => h.id);
  assert.deepEqual(kept, ["d", "c"]);
});

test("lineCount is inclusive of both ends", () => {
  assert.equal(lineCount([hunk({ startLine: 1, endLine: 1 }), hunk({ startLine: 4, endLine: 6 })]), 4);
  assert.equal(lineCount([]), 0);
});
