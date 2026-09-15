import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { asciiShark } from "../scripts/ascii-shark.ts";

const code = readFileSync(new URL("./fixtures/sample-pr/src/export/csv.ts", import.meta.url), "utf8");

function sea(reduced = false) {
  const els: Record<string, any> = {
    sea: { clientWidth: 1098 },
    "sea-pre": { style: {}, innerHTML: "" },
    "sea-count": { textContent: "" },
  };
  let frame: (now: number) => void = () => {};
  const document = { hidden: false, getElementById: (id: string) => els[id] };
  const script = asciiShark(code).match(/<script>([\s\S]*?)<\/script>/)![1]!;
  vm.runInNewContext(script, {
    document,
    window: {},
    addEventListener() {},
    matchMedia: () => ({ matches: reduced, addEventListener() {} }),
    requestAnimationFrame: (f: typeof frame) => (frame = f),
  });
  const eaten = () => Number(els["sea-count"].textContent.replace(/,/g, ""));
  return { els, document, eaten, tick: (now: number) => frame(now) };
}

test("the shark swims through the real code, eats a lane, and the lane grows back", () => {
  const s = sea();
  const html = () => s.els["sea-pre"].innerHTML as string;
  assert.match(html(), /class="sea-b"/, "the shark is drawn");
  assert.ok(html().includes("toCsv"), "the field is the fixture's code");
  s.tick(0);
  s.tick(3000);
  const early = s.eaten();
  assert.ok(early > 0, "it eats as it moves");
  s.tick(9000);
  assert.ok(s.eaten() > early, "and keeps eating");
  assert.match(html(), /class="sea-new"/, "eaten code grows back");
  // The page styles short class names (.n is the finding number: block, serif,
  // 40px). A shared name once blew the band up into giant letters.
  const classes = new Set([...html().matchAll(/class="([^"]+)"/g)].map((m) => m[1]!));
  assert.ok([...classes].every((c) => c.startsWith("sea-")), [...classes].join(" "));
});

test("hidden time never moves the shark; reduced motion is one still frame", () => {
  const s = sea();
  s.tick(0);
  s.tick(1000);
  const before = s.eaten();
  s.document.hidden = true;
  s.tick(60000);
  s.document.hidden = false;
  s.tick(60001);
  assert.equal(s.eaten(), before);

  const still = sea(true);
  const frame = still.els["sea-pre"].innerHTML;
  assert.ok(still.eaten() > 1000, "the still frame shows the lane already eaten");
  still.tick(0);
  still.tick(60000);
  assert.equal(still.els["sea-pre"].innerHTML, frame);
});
