import test from "node:test";
import assert from "node:assert/strict";
import { lastLine, offsetAt, sliceLines } from "../src/lib/lines.ts";

test("lastLine matches wc -l: a trailing newline ends the last line, it does not start one", () => {
  assert.equal(lastLine(""), 1);
  assert.equal(lastLine("a"), 1);
  assert.equal(lastLine("a\n"), 1);
  assert.equal(lastLine("\n"), 1);
  assert.equal(lastLine("a\nb"), 2);
  assert.equal(lastLine("a\nb\n"), 2);
  assert.equal(lastLine("a\r\nb\r\n"), 2);
  assert.equal(lastLine("a\n\n"), 2);
});

test("sliceLines returns whole lines, newline included, and clamps past the end", () => {
  const text = "a\nb\nc\nd\n";
  assert.equal(sliceLines(text, 2, 3), "b\nc\n");
  assert.equal(sliceLines(text, 1, 1), "a\n");
  assert.equal(sliceLines(text, 4, 9), "d\n");
  assert.equal(sliceLines(text, 1, 4), text);
});

test("offsetAt is the index where a line starts", () => {
  assert.equal(offsetAt("a\nbb\nc", 1), 0);
  assert.equal(offsetAt("a\nbb\nc", 2), 2);
  assert.equal(offsetAt("a\nbb\nc", 3), 5);
  assert.equal(offsetAt("a\nbb\nc", 4), 6);
});
