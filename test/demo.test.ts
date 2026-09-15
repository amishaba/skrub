import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SCAN_JSON, type DemoScan } from "../scripts/bake-demo.ts";
import { headline, kindRows } from "../src/report/report.ts";
import { isApplicable, lineCount, removesLines } from "../src/hunk.ts";

const root = path.resolve(fileURLToPath(import.meta.url), "../..");
const shipped = JSON.parse(readFileSync(SCAN_JSON, "utf8")) as DemoScan;
const page = readFileSync(path.join(root, "web/index.html"), "utf8");
const sample = readFileSync(path.join(root, "web/sample.html"), "utf8");
const readme = readFileSync(path.join(root, "README.md"), "utf8");
const SITE = "https://unvibe-eight.vercel.app";

test("the sample review is seeded with the shipped scan, byte for byte, before the app script runs", () => {
  const inline = `window.__SKRUB_DEMO__ = ${JSON.stringify({ summary: shipped.summary, hunks: shipped.hunks })};`;
  const at = sample.indexOf(inline);
  assert.ok(at > 0, "baked scan is inlined");
  assert.ok(at < sample.indexOf("<script>\nconst $ = "), "shim comes before the app script");
  assert.ok(sample.indexOf("</head>") > at, "shim is in <head>");
});

test("the landing page tells the story and links to the review instead of embedding it", () => {
  assert.ok(!page.includes("__SKRUB_DEMO__"));
  assert.ok(!page.includes('id="filters"'));
  assert.ok(!page.includes("const $ = "), "no review app script on the landing page");
  assert.ok(page.includes('href="sample"'));
});

test("the hero numbers are the scan's numbers", () => {
  const deletions = shipped.hunks.filter(removesLines);
  const safe = shipped.hunks.filter((h) => isApplicable(h) && h.safe).length;
  const calls = shipped.hunks.filter((h) => isApplicable(h) && !h.safe).length;
  assert.ok(page.includes(`<b>${lineCount(deletions)}</b> of them the agent didn't need: ${safe} safe to delete and ${calls} judgment calls for you`));
  assert.ok(page.includes(`${shipped.source.files.length} files, <b>99 added lines</b>`));
});

test("link-preview tags are present and absolute", () => {
  for (const tag of [
    `<link rel="canonical" href="${SITE}/" />`,
    `<meta property="og:url" content="${SITE}/" />`,
    `<meta property="og:image" content="${SITE}/og.png" />`,
    '<meta property="og:image:width" content="1200" />',
    '<meta property="og:image:height" content="630" />',
    '<meta name="twitter:card" content="summary_large_image" />',
    '<meta property="og:title" content="skrub - clean code &amp; product sense for coding agents" />',
  ]) {
    assert.ok(page.includes(tag), tag);
  }
  assert.match(page, /<meta property="og:description" content="clean code &amp; product sense for coding agents\. on one 99-line pull request, skrub found 44 lines the agent didn't need/);
});

test("the README's verdict is the headline the report module prints for the shipped scan", () => {
  assert.ok(readme.includes(`> ## ${headline(shipped.hunks)}`));
  const rows = kindRows(shipped.hunks);
  assert.ok(rows.every((r, i) => i === 0 || rows[i - 1]!.lines >= r.lines), "most lines first");
});

test("the README's story numbers are the fixture's", () => {
  assert.ok(readme.includes("changes 8 files and adds 99 lines"));
  assert.ok(readme.includes(`[live demo](${SITE})`));
});

test("every filter on the page has something to show", () => {
  const kinds = new Set(shipped.hunks.map((h) => h.kind));
  assert.ok(shipped.hunks.some((h) => h.safe), "safe");
  assert.ok(kinds.has("glue"), "glue");
  assert.ok(kinds.has("claudeism"), "comments");
  assert.ok(kinds.has("naming") || kinds.has("dup") || kinds.has("pattern"), "quality");
});


test("dependency-free hosting skips npm auto-build and serves the committed demo", () => {
  const config = JSON.parse(readFileSync(path.join(root, "vercel.json"), "utf8"));
  assert.equal(config.installCommand, "");
  assert.equal(config.buildCommand, "", "an omitted command auto-detects npm run build without installed tsx");
  assert.equal(config.framework, null);
  assert.equal(config.outputDirectory, "web");
  assert.ok(readFileSync(path.join(root, config.outputDirectory, "index.html"), "utf8").includes('class="pr"'));
  assert.ok(readFileSync(path.join(root, config.outputDirectory, "sample.html"), "utf8").includes("__SKRUB_DEMO__"));
  assert.equal(config.cleanUrls, true, "web/sample.html is served at /sample");
});

test("both pages link the favicon, and every icon they link exists", () => {
  for (const html of [page, sample]) {
    for (const href of ["/favicon.svg", "/favicon-32.png", "/apple-touch-icon.png"]) {
      assert.ok(html.includes(`href="${href}"`), href);
      assert.ok(readFileSync(path.join(root, "web", href.slice(1))).length > 0, href);
    }
  }
});
