import type { Hunk } from "../src/hunk.ts";
import { removesLines } from "../src/hunk.ts";
import type { PrLine } from "./bake-demo.ts";

/** A few words for the margin: what skrub saw, not how it works. */
export function tagOf(h: Hunk): string {
  if (h.kind === "unused_import") return "unused import";
  if (h.kind === "unused_file") return "never imported";
  if (h.kind === "unused_export") return "never used";
  if (h.kind === "needless_export") return "export not needed";
  if (h.kind === "dup") return `copy of ${/Same as (\S+)/.exec(h.reason)?.[1] ?? "an existing helper"}`;
  if (h.kind === "glue") return /re-exports/.test(h.reason) ? "only re-exports" : "pass-through";
  if (h.kind === "reuse") {
    const owner = /<(\w+)>/.exec(h.reason)?.[1] ?? /% the same as (\S+)/.exec(h.reason)?.[1];
    if (/already calls|also called/.test(h.reason)) return "endpoint fetched elsewhere";
    return owner ? `like ${owner}` : "already exists";
  }
  if (h.kind === "fold") return "used once";
  if (h.kind === "naming") return "vague name";
  if (h.kind === "convention") return "off-convention";
  if (/TODO/.test(h.reason)) return "stale todo";
  if (/restates/.test(h.reason)) return "restates the name";
  return "narrates";
}

/**
 * The lines the sample pr added, set in columns, with skrub's findings marked
 * in the order it ranks them. Then what it can prove is dead fades; the
 * judgment calls stay marked, because those are yours; and the count falls.
 * Every line and every mark comes from the fixture, its diff, and its real scan.
 */
/** Four across: the whole pr fits one desktop screen at a readable size. */
const COLUMNS = 4;

export function walkthrough(hunks: Hunk[], lines: PrLine[]): string {
  const escape = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
  const total = lines.length;
  const cover = (l: PrLine) => hunks.findIndex((h) => h.file === l.file && l.line >= h.startLine && l.line <= h.endLine);
  const proven = lines.filter((l) => { const h = hunks[cover(l)]; return h && removesLines(h) && h.safe; }).length;
  const calls = hunks.filter((h) => removesLines(h) && !h.safe).length;

  const deleted = (l: PrLine | undefined) => {
    const h = l && hunks[cover(l)];
    return !!h && removesLines(h) && h.safe;
  };
  const blank = (l: PrLine) => !l.text.trim();
  /** Blank lines that are only spacing once the deletions are gone: leading, trailing, or a second in a row. */
  const loose = new Set<number>();
  for (const file of new Set(lines.map((l) => l.file))) {
    const kept = lines.flatMap((l, i) => (l.file === file && !deleted(l) ? [i] : []));
    const real = kept.filter((i) => !blank(lines[i]!));
    kept.forEach((i, k) => {
      if (!blank(lines[i]!)) return;
      const before = real.some((j) => j < i), after = real.some((j) => j > i);
      if (!before || !after || (k > 0 && blank(lines[kept[k - 1]!]!))) loose.add(i);
    });
  }
  const spacerFor = (i: number) => loose.has(i);
  const folds = (i: number) => deleted(lines[i]) || (blank(lines[i]!) && spacerFor(i));
  // Rows, in order. A file header with no real line left, a ⋯ gap between deleted lines, and blank lines that
  // only spaced out deleted code fold away with them.
  const rows: { html: string; header: boolean }[] = [];
  lines.forEach((l, i) => {
    const prev = lines[i - 1];
    if (!prev || prev.file !== l.file) {
      const all = lines.every((x, j) => x.file !== l.file || folds(j));
      rows.push({ html: `<div class="pr-file"${all ? " data-gone" : ""}>${escape(l.file)}</div>`, header: true });
    } else if (l.line !== prev.line + 1)
      rows.push({ html: `<div class="l gap"${folds(i - 1) && folds(i) ? " data-gone" : ""}><span class="t">⋯</span></div>`, header: false });
    const at = cover(l);
    const h = hunks[at];
    const edit = h?.replacement != null && h.safe && l.line === h.startLine ? ` data-to="${escape(h.replacement.replace(/\n$/, ""))}"` : "";
    const attrs = h ? ` data-h="${at}"${removesLines(h) && h.safe ? ' data-del="1"' : ""}${edit}` : "";
    const tag = h && l.line === h.startLine ? `<i class="tag">${escape(tagOf(h))}</i>` : "";
    const spacer = !h && blank(l) && spacerFor(i) ? " data-gone" : "";
    rows.push({ html: `<div class="l"${attrs}${spacer}><span class="t">${escape(l.text) || " "}</span>${tag}</div>`, header: false });
  });
  // Fixed columns, balanced like CSS columns, but fixed, so deleted lines close up within their column
  // instead of the code reflowing from one column to the next. A header never ends a column.
  const per = Math.ceil(rows.length / COLUMNS);
  const columns: string[][] = [[]];
  rows.forEach((r) => {
    const col = columns[columns.length - 1]!;
    const full = col.length >= per || (r.header && col.length >= per - 1);
    if (full && columns.length < COLUMNS) columns.push([]);
    columns[columns.length - 1]!.push(r.html);
  });
  const body = columns.map((c) => `<div class="pr-col">${c.join("")}</div>`).join("");

  return `<section class="pr" id="pr" aria-label="skrub's findings on the sample pull request, animated">
  <div class="pr-head"><span class="lab" id="pr-label">what the agent wrote</span><span class="pr-count"><span id="pr-n">${total}</span><em> lines</em></span></div>
  <div class="pr-code">${body}</div>
  <div class="pr-foot"><span>real scan · nothing is changed</span><a href="sample">[ try the review → ]</a></div>
</section>
<style>
.pr {--del:#f85149;border:1px solid var(--rule);margin:30px 0 26px;text-align:left;display:flex;flex-direction:column;}
.pr-head {display:flex;justify-content:space-between;align-items:baseline;gap:16px;padding:16px 20px;border-bottom:1px solid var(--rule);}
.pr-head .lab {font:11px var(--mono);color:var(--dim);}
.pr-count {font-family:var(--serif);font-size:44px;line-height:.9;letter-spacing:-.02em;font-variant-numeric:tabular-nums;}
.pr-count em {font-size:.45em;color:var(--dim);font-style:normal;}
.pr-code {display:grid;grid-template-columns:repeat(4,minmax(0,1fr));padding:16px 0;font:11.5px/1.7 var(--mono);flex:1 1 auto;min-height:0;}
.pr-col {min-width:0;}
.pr-col + .pr-col {border-left:1px solid var(--rule);}
.pr-file {padding:10px 20px 2px;color:var(--dim);font-size:10px;max-height:4em;overflow:hidden;transition:max-height .7s ease,padding .7s ease,opacity .5s;}
.pr-col > .pr-file:first-child {padding-top:0;}
.pr .l {position:relative;display:flex;gap:10px;padding:0 20px;white-space:pre;color:rgba(255,255,255,.38);max-height:1.7em;overflow:hidden;transition:color .3s,opacity .7s,max-height .7s ease;}
.pr .l .t {flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;}
.pr .l .tag {flex:none;font:13px/1.3 var(--serif);color:var(--green);opacity:0;transition:opacity .3s;}
.pr .l.on {color:var(--ink);}
/* a diff's colours: what skrub removes is red, what it writes is green */
.pr .l.on[data-del] {color:var(--del);}
.pr .l.on[data-del]::before {background:var(--del);}
.pr .l.on:not(.gone):not(.edited)::before {content:"";position:absolute;left:9px;top:3px;bottom:3px;width:1px;background:var(--ink);}
.pr .l.on .tag {opacity:1;}
.pr .l.edited .tag {opacity:0;}
.pr .l.gone {opacity:.4;}
.pr .l.gap {color:rgba(255,255,255,.2);}
.pr.done .l:not([data-del]) {color:var(--ink);}
.pr.done .l.edited {color:var(--green);}
/* then what fix deleted is gone for real: those lines close up and the code that's left comes together */
.pr.shut .l[data-del], .pr.shut .l[data-gone] {max-height:0;opacity:0;}
.pr.shut .pr-file[data-gone] {max-height:0;padding-top:0;padding-bottom:0;opacity:0;}
/* a desktop sees the whole pr at once: the box fills the screen under the header, the code sized to fit */
@media (min-width: 900px) and (min-height: 560px) {
  .pr {height:calc(100vh - 63px - 56px);margin:28px 0;}
  .pr-code {font-size:clamp(9.5px, calc((100vh - 270px) / 52), 12.5px);overflow:hidden;}
}
.pr-foot {display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;padding:12px 20px;border-top:1px solid var(--rule);font-size:10px;color:var(--dim);}
.pr-foot a {color:var(--dim);}
.pr-foot a:hover {color:var(--ink);background:var(--wash);}
@media(max-width:720px){.pr-code{grid-template-columns:1fr}.pr-col + .pr-col{border-left:0}.pr-count{font-size:34px}.pr .l,.pr-file{padding-left:16px;padding-right:16px}.pr .l.on::before{left:6px}}
</style>
<script>
(() => {
  const TOTAL = ${total}, LEFT = ${total - proven}, AFTER = ${JSON.stringify(`after fix · ${calls} ${calls === 1 ? "call" : "calls"} left for you`)};
  const root = document.getElementById('pr');
  const lines = [...root.querySelectorAll('.l[data-h]')];
  const order = [...new Set(lines.map(l => l.dataset.h))].sort((a, b) => a - b);
  const n = document.getElementById('pr-n'), label = document.getElementById('pr-label');
  let timers = [];
  const at = (ms, f) => timers.push(setTimeout(f, ms));
  const mark = (pick, cls) => lines.filter(pick).forEach(l => l.classList.add(cls));
  // a safe edit (an export nothing else needs) shows its new line once fix has run
  const edits = lines.filter(l => l.dataset.to != null).map(l => ({ l, t: l.querySelector('.t'), from: l.querySelector('.t').textContent }));
  const applyEdits = on => edits.forEach(e => { e.t.textContent = on ? e.l.dataset.to : e.from; on ? e.l.classList.add('edited') : e.l.classList.remove('edited'); });
  function reset() {
    timers.forEach(clearTimeout); timers = [];
    root.classList.remove('done'); root.classList.remove('shut');
    lines.forEach(l => { l.classList.remove('on'); l.classList.remove('gone'); });
    applyEdits(false);
    n.textContent = String(TOTAL); label.textContent = 'what the agent wrote';
  }
  function settle() {
    mark(() => true, 'on'); mark(l => l.dataset.del, 'gone'); applyEdits(true); root.classList.add('done'); root.classList.add('shut');
    n.textContent = String(LEFT); label.textContent = AFTER;
  }
  // findings light up in rank order, then the deletions fade and the count falls;
  // it holds the result, then starts over, for as long as it's on screen
  function play() {
    reset();
    order.forEach((h, i) => at(250 + i * 120, () => mark(l => l.dataset.h === h, 'on')));
    const fade = 250 + order.length * 120 + 350;
    at(fade, () => { mark(l => l.dataset.del, 'gone'); applyEdits(true); root.classList.add('done'); label.textContent = AFTER; });
    const steps = 14;
    for (let s = 1; s <= steps; s++) at(fade + s * 50, () => { n.textContent = String(Math.round(TOTAL - (TOTAL - LEFT) * (s / steps))); });
    // a beat to read what faded, then it closes up
    at(fade + SHUT, () => root.classList.add('shut'));
    at(fade + SHUT + HOLD, play);
  }
  const HOLD = 3200, SHUT = 1100;
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) { settle(); return; }
  new IntersectionObserver(entries => {
    const visible = entries.some(e => e.isIntersecting);
    if (visible && timers.length === 0) play();
    if (!visible) reset();
  }, { threshold: 0.35 }).observe(root);
})();
</script>`;
}
