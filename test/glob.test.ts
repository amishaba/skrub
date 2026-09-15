import test from "node:test";
import assert from "node:assert/strict";
import { matches } from "../src/program/glob.ts";
import { shouldSkipFile } from "../src/program/program.ts";

test("a pattern without * matches the path or anything under it", () => {
  assert.equal(matches("src/a.ts", "src"), true);
  assert.equal(matches("src/gen/a.ts", "src/gen"), true);
  assert.equal(matches("src/gen/a.ts", "src/gen/"), true);
  assert.equal(matches("src/generated.ts", "src/gen"), false);
  assert.equal(matches("lib/a.ts", "src"), false);
});

test("* stays within one segment, ** crosses directories", () => {
  assert.equal(matches("src/a.ts", "src/*.ts"), true);
  assert.equal(matches("src/x/a.ts", "src/*.ts"), false);
  assert.equal(matches("src/x/a.ts", "src/**/*.ts"), true);
  assert.equal(matches("src/a.ts", "**/*.ts"), true);
  assert.equal(matches("src/a.tsx", "**/*.ts"), false);
  assert.equal(matches("src\\win\\a.ts", "src/**"), true);
});

test("declaration, test, and example files are never scanned", () => {
  assert.equal(shouldSkipFile("src/types.d.ts"), true);
  assert.equal(shouldSkipFile("src/a.test.ts"), true);
  assert.equal(shouldSkipFile("src/a.spec.tsx"), true);
  assert.equal(shouldSkipFile("example/a.ts"), true);
  assert.equal(shouldSkipFile("src/example/a.ts"), true);
  assert.equal(shouldSkipFile("src/examples.ts"), false);
  assert.equal(shouldSkipFile("src/a.ts"), false);
});
