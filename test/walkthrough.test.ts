import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { tagOf, walkthrough } from "../scripts/walkthrough.ts";
import { prLines, type DemoScan } from "../scripts/bake-demo.ts";
import { removesLines } from "../src/hunk.ts";

const scan = JSON.parse(readFileSync(new URL("../web/scan.json", import.meta.url), "utf8")) as DemoScan;
const lines = prLines();
const html = walkthrough(scan.hunks, lines);
const covering = (file: string, line: number) => scan.hunks.findIndex((h) => h.file === file && line >= h.startLine && line <= h.endLine);
const proven = scan.hunks.filter((h) => removesLines(h) && h.safe).reduce((n, h) => n + h.endLine - h.startLine + 1, 0);
const calls = scan.hunks.filter((h) => removesLines(h) && !h.safe).length;
const edit = scan.hunks.find((h) => h.replacement != null)!;

/** Run the page script against stand-ins for the marked lines, with a clock we move by hand. */
function playback(reduced = false) {
  const marked = lines.flatMap((l) => {
    const at = covering(l.file, l.line);
    const h = scan.hunks[at];
    if (!h) return [];
    const cls = new Set<string>();
    const t = { textContent: l.text };
    const dataset: Record<string, string> = { h: String(at) };
    if (removesLines(h) && h.safe) dataset.del = "1";
    if (h.replacement != null && h.safe && l.line === h.startLine) dataset.to = h.replacement.replace(/\n$/, "");
    return [{ dataset, cls, t, querySelector: () => t, classList: { add: (c: string) => cls.add(c), remove: (c: string) => cls.delete(c) } }];
  });
  const rootCls = new Set<string>();
  const el: Record<string, any> = {
    pr: { querySelectorAll: () => marked, classList: { add: (c: string) => rootCls.add(c), remove: (c: string) => rootCls.delete(c) } },
    "pr-n": { textContent: "" },
    "pr-label": { textContent: "" },
  };
  let now = 0;
  let timers: { at: number; f: () => void; id: number }[] = [];
  let seen: ((e: { isIntersecting: boolean }[]) => void) | null = null;
  vm.runInNewContext(html.match(/<script>([\s\S]*?)<\/script>/)![1]!, {
    document: { getElementById: (id: string) => el[id] },
    matchMedia: () => ({ matches: reduced }),
    setTimeout: (f: () => void, ms: number) => { const id = timers.length + 1; timers.push({ at: now + ms, f, id }); return id; },
    clearTimeout: (id: number) => { timers = timers.filter((t) => t.id !== id); },
    IntersectionObserver: class { constructor(cb: typeof seen) { seen = cb; } observe() {} },
  });
  const advance = (ms: number) => {
    now += ms;
    for (const t of [...timers].sort((a, b) => a.at - b.at)) if (t.at <= now) { timers = timers.filter((x) => x !== t); t.f(); }
  };
  const count = (c: string) => marked.filter((l) => l.cls.has(c)).length;
  const edited = () => marked.find((l) => l.dataset.to != null)!.t.textContent;
  return { el, marked, rootCls, advance, count, edited, enter: () => seen!([{ isIntersecting: true }]), leave: () => seen!([{ isIntersecting: false }]) };
}

test("every line shown is one the agent added, and every mark is a real finding's range", () => {
  const rows = [...html.matchAll(/<div class="l"( data-h="(\d+)")?( data-del="1")?( data-to="[^"]*")?(?: data-gone)?><span class="t">([\s\S]*?)<\/span>/g)];
  assert.equal(rows.length, 99);
  rows.forEach((r, i) => {
    const want = lines[i]!;
    const text = r[5]!.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");
    assert.equal(text.trim(), want.text.trim(), `${want.file}:${want.line}`);
    assert.equal(r[2] == null ? -1 : Number(r[2]), covering(want.file, want.line), `${want.file}:${want.line} mark`);
  });
  assert.equal(rows.filter((r) => r[3]).length, proven, "only what the compiler proved dead fades");
  assert.ok(html.includes('class="l gap"'), "a modified file shows a gap where it skips old code");
  assert.equal(tagOf(scan.hunks.find((h) => h.kind === "dup")!), "copy of sortBy");
});

test("on view, findings light up; then the proven ones fade, the export drops, and the judgment calls stay", () => {
  const p = playback();
  assert.equal(p.count("on"), 0, "nothing moves before it's on screen");
  p.enter();
  p.advance(250 + 120 * 2);
  assert.ok(p.count("on") > 0 && p.count("on") < p.marked.length, "partway through the findings");
  assert.equal(p.count("gone"), 0);
  p.advance(4000);
  assert.equal(p.count("on"), p.marked.length);
  assert.equal(p.count("gone"), proven);
  assert.equal(p.edited(), edit.replacement!.replace(/\n$/, ""));
  assert.ok(p.rootCls.has("done"));
  assert.ok(p.rootCls.has("shut"), "after a beat, the deleted lines close up");
  assert.equal(p.el["pr-n"].textContent, String(99 - proven));
  assert.equal(p.el["pr-label"].textContent, `after fix · ${calls} calls left for you`);
});

test("it holds the result, then replays, for as long as it's on screen; off screen it stops", () => {
  const p = playback();
  p.enter(); p.advance(4500);
  assert.equal(p.count("gone"), proven, "first pass finished, holding");
  p.advance(3500);
  assert.equal(p.count("gone"), 0, "started over");
  assert.ok(!p.rootCls.has("shut"), "and the code is back at full length");
  assert.equal(p.el["pr-n"].textContent, "99");
  assert.equal(p.edited(), edit.text.replace(/\n$/, ""), "the export is back for the replay");
  p.leave();
  p.advance(60000);
  assert.equal(p.count("on"), 0, "nothing runs off screen");
  p.enter(); p.advance(4500);
  assert.equal(p.count("gone"), proven, "back on screen, it plays again");
});

test("reduced motion shows the end state and never animates", () => {
  const still = playback(true);
  assert.equal(still.count("gone"), proven);
  assert.ok(still.rootCls.has("shut"), "already closed up");
  assert.equal(still.el["pr-n"].textContent, String(99 - proven));
});

test("the code sits in four fixed columns, and only headers, gaps and blank lines around deleted code fold away with it", () => {
  assert.equal((html.match(/<div class="pr-col">/g) ?? []).length, 4);
  for (const m of html.matchAll(/<div class="pr-file" data-gone>([^<]+)<\/div>/g)) {
    assert.ok(lines.filter((l) => l.file === m[1] && l.text.trim()).every((l) => { const h = scan.hunks[covering(l.file, l.line)]; return h && removesLines(h) && h.safe; }), `every real line of ${m[1]} is deleted`);
  }
  assert.ok(html.includes('<div class="pr-file" data-gone>src/export/json.ts</div>'), "a deleted file's header goes with it");
  assert.ok(!html.includes('data-gone>src/cli.ts<'), "a file with code left keeps its header");
});

test("the animation sits below the beliefs and above the agent loop", () => {
  const page = readFileSync(new URL("../web/index.html", import.meta.url), "utf8");
  assert.ok(page.indexOf("what i think about code") < page.indexOf('class="pr"'));
  assert.ok(page.indexOf('class="pr"') < page.indexOf("in the agent's loop"));
});
