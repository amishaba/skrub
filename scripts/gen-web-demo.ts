/** Generate the static landing page from the shared review UI and fixture scan.
 * The scan is real; the animation replays its findings on the sample pr's own lines.
 * npm run demo:bake && npm run demo:web
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { FIXTURE_DIR, SCAN_JSON, type DemoScan, prDiff, prLines } from "./bake-demo.ts";
import { alreadyThere } from "../src/agent/prewrite.ts";
import { tagOf, walkthrough } from "./walkthrough.ts";
import { asciiShark } from "./ascii-shark.ts";
import { lineCount, isApplicable, removesLines } from "../src/hunk.ts";

const root = path.resolve(fileURLToPath(import.meta.url), "../..");

export const SITE = "https://skrub.vercel.app";
export const REPO = "https://github.com/amishaba/skrub";

const demo = JSON.parse(readFileSync(SCAN_JSON, "utf8")) as DemoScan;
const src = readFileSync(path.join(root, "src/view/review.html"), "utf8");


/** The story, from the data. The golden test asserts these same numbers. */
export function storyOf(scan: DemoScan) {
  const deletions = scan.hunks.filter(removesLines);
  const edits = scan.hunks.filter((h) => isApplicable(h) && !removesLines(h));
  const notes = scan.hunks.filter((h) => !isApplicable(h)).length;
  const added = prLines().length;
  return { files: scan.source.files.length, added, hunks: scan.hunks.length, deletions: deletions.length, edits: edits.length, lines: lineCount(deletions), notes };
}

// The shark swims through the sample pr's own code: what the agent wrote.
const seaCode = prLines().map((l) => l.text).join("\n");
const story = storyOf(demo);
// Places the agent wrote again what the repo already had: copies and near-copies, a refetched endpoint.
const rewrites = demo.hunks.filter((h) => h.kind === "reuse" || h.kind === "dup").length;

/**
 * What the Write hook told the agent when it created its first new file:
 * skrub's own check, run on the sample repo as it was before the pr.
 */
async function writeHookSaid(): Promise<{ file: string; lines: string[] }> {
  const added = prDiff().added;
  const dir = mkdtempSync(path.join(tmpdir(), "skrub-demo-"));
  try {
    cpSync(FIXTURE_DIR, dir, { recursive: true });
    const fresh = [...added].filter(([, r]) => r === "all").map(([f]) => f);
    const contents = new Map(fresh.map((f) => [f, readFileSync(path.join(dir, f), "utf8")]));
    execFileSync("git", ["apply", "-R", "--unidiff-zero", "pr.diff"], { cwd: dir });
    for (const file of fresh) {
      const lines = await alreadyThere(dir, file, contents.get(file)!);
      if (lines.length) return { file, lines };
    }
    return { file: "", lines: [] };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
const hook = await writeHookSaid();
const title = "skrub - clean code & product sense for coding agents";
const safeCount = demo.hunks.filter((h) => isApplicable(h) && h.safe).length;
const callCount = demo.hunks.filter((h) => isApplicable(h) && !h.safe).length;
const description =
  `clean code & product sense for coding agents. on one ${story.added}-line pull request, skrub found ${story.lines} lines the agent didn't need: ` +
  `${safeCount} safe to delete and ${callCount} judgment calls, plus ${rewrites} places it rewrote code the repo already had.`;
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

const meta = `
<meta name="description" content="${esc(description)}" />
<link rel="canonical" href="${SITE}/" />
<meta property="og:type" content="website" />
<meta property="og:url" content="${SITE}/" />
<meta property="og:site_name" content="skrub" />
<meta property="og:title" content="${esc(title)}" />
<meta property="og:description" content="${esc(description)}" />
<meta property="og:image" content="${SITE}/og.png" />
<meta property="og:image:width" content="1200" />
<meta property="og:image:height" content="630" />
<meta property="og:image:alt" content="${esc(`skrub: ${story.deletions} deletions, ${story.lines} of ${story.added} lines, on one pull request`)}" />
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="${esc(title)}" />
<meta name="twitter:description" content="${esc(description)}" />
<meta name="twitter:image" content="${SITE}/og.png" />`;

const shim = `
<script>
// --- static demo shim: answer /api/* from the baked scan (web/scan.json) ---
window.__SKRUB_DEMO__ = ${JSON.stringify({ summary: demo.summary, hunks: demo.hunks })};
(function () {
  const D = window.__SKRUB_DEMO__;
  const KEY = "skrub-demo-decisions";
  const load = () => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; } };
  const save = (d) => { try { localStorage.setItem(KEY, JSON.stringify(d)); } catch {} };
  const reply = (obj) => new Response(JSON.stringify(obj), { headers: { "content-type": "application/json" } });
  const real = window.fetch ? window.fetch.bind(window) : null;
  window.fetch = (url, opts) => {
    const u = String(url);
    if (u.startsWith("/api/scans")) return Promise.resolve(reply({ latest: D.summary.id, scans: [D.summary] }));
    if (u.startsWith("/api/scan?")) return Promise.resolve(reply({ ...D, decisions: load() }));
    if (u.startsWith("/api/decision")) {
      try {
        const body = JSON.parse((opts && opts.body) || "{}");
        const d = load(); d[body.hunkId] = body.decision; save(d);
        return Promise.resolve(reply({ ok: true, decisions: d }));
      } catch { return Promise.resolve(reply({ ok: false })); }
    }
    return real ? real(url, opts) : Promise.reject(new Error("offline demo"));
  };
})();
</script>`;

// The landing page's own sections; the review app keeps the template's styles.
const styles = `
<style>
  .hero { border-bottom: 1px solid var(--rule); }
  .hero-grid { display: grid; grid-template-columns: minmax(0, 1.2fr) minmax(0, 1fr); border-bottom: 1px solid var(--rule); }
  .hero-grid > div { padding: 40px 28px 36px; min-width: 0; }
  .hero-title { display: flex; flex-direction: column; justify-content: space-between; gap: 40px; }
  .hero-tag { font: 11px var(--mono); letter-spacing: 0.06em; color: var(--dim); }
  .hero-h { font-family: var(--serif); font-weight: 400; font-size: clamp(44px, 5.4vw, 68px); line-height: 0.92; letter-spacing: -0.035em; margin: 0; }
  .hero-h em { color: var(--dim); font-style: normal; }
  .hero-tagline { font: 13px/1.6 var(--mono); color: var(--dim); margin: 18px 0 0; }
  .hero-copy { border-left: 1px solid var(--rule); display: flex; flex-direction: column; justify-content: flex-end; gap: 18px; }
  .hero-stat { font-family: var(--serif); font-size: clamp(48px, 6vw, 72px); line-height: 0.9; letter-spacing: -0.02em; }
  .hero-stat span { color: var(--dim); font-style: italic; }
  .hero-sub { font: 14px/1.65 var(--mono); color: var(--dim); margin: 0; max-width: 48ch; }
  .hero-sub b { color: var(--ink); font-weight: 500; }
  .hero-sub a { color: var(--dim); }
  .hero-sub a:hover { color: var(--ink); background: var(--wash); }
  .hero-links { font: 13px var(--mono); margin: 0; display: flex; flex-wrap: wrap; gap: 6px 18px; }
  .hero-links a { color: var(--dim); text-decoration: none; }
  .hero-links a:hover { color: var(--ink); background: var(--wash); }
  .hero-links code { color: var(--green); }
  .hero-walk { padding: 0 28px; }
  .walk-sec { border-bottom: 1px solid var(--rule); }
  .sec { border-bottom: 1px solid var(--rule); }
  .sec-h { display: flex; align-items: baseline; gap: 14px; padding: 26px 28px 22px; border-bottom: 1px solid var(--rule); margin: 0; font-weight: 400; }
  .sec-h .ix { font: 11px var(--mono); color: var(--dim); letter-spacing: 0.06em; }
  .sec-h .w { font-family: var(--serif); font-size: 34px; line-height: 0.95; letter-spacing: -0.01em; }
  .sec-h .note { margin-left: auto; font: 11px var(--mono); color: var(--dim); }
  .sec-h .note a { color: var(--dim); }
  .sec p { margin: 0; color: var(--dim); font-size: 14px; line-height: 1.65; }
  .sec p b { color: var(--ink); font-weight: 500; }
  .sec code { color: var(--green); }
  .beliefs .bp { border-left: 1px solid var(--rule); align-self: stretch; }
  .beliefs .bp p { margin: 0 0 10px; }
  .beliefs .bp p:last-child { margin-bottom: 0; }
  .facts { margin: 0 0 10px; padding: 0; list-style: none; }
  .facts li { display: grid; grid-template-columns: 130px minmax(0, 1fr); gap: 14px; padding: 6px 0; border-top: 1px solid var(--rule); font-size: 13px; line-height: 1.55; }
  .facts li:last-child { border-bottom: 1px solid var(--rule); }
  .facts .fk { font: 16px var(--serif); color: var(--ink); }
  .setup { margin: 0; padding: 18px 28px; border-top: 1px solid var(--rule); color: var(--dim); font-size: 13px; line-height: 1.6; }
  .beliefs { margin: 0; padding: 0; list-style: none; }
  .beliefs > li { display: grid; grid-template-columns: 90px minmax(0, 0.8fr) minmax(0, 1.4fr); border-top: 1px solid var(--rule); }
  .beliefs > li:first-child { border-top: 0; }
  .beliefs > li > * { padding: 18px 28px; min-width: 0; }
  .beliefs .bi { font: 11px var(--mono); color: var(--dim); padding-top: 22px; }
  .beliefs .bw { font-family: var(--serif); font-size: 24px; line-height: 1.05; border-left: 1px solid var(--rule); }
  .beliefs > li > p { border-left: 1px solid var(--rule); align-self: stretch; }
  @media (max-width: 720px) {
    .hero-grid { grid-template-columns: 1fr; }
    .hero-h { font-size: clamp(64px, 10vw, 124px); line-height: 0.86; }
    .hero-grid > div { padding: 30px 18px; }
    .hero-copy { border-left: 0; border-top: 1px solid var(--rule); }
    .hero-walk { padding: 0 16px; }
    .sec-h { flex-wrap: wrap; padding: 22px 18px 18px; }
    .sec-h .note { margin-left: 0; width: 100%; }
    .beliefs > li { grid-template-columns: 1fr; }
    .beliefs > li > * { padding: 0 18px; border-left: 0 !important; }
    .beliefs .bi { padding-top: 18px; }
    .beliefs > li > p, .beliefs .bp { padding-bottom: 18px; padding-top: 8px; }
    .facts li { grid-template-columns: 1fr; gap: 2px; }
    .setup { padding: 18px; }
  }
</style>`;

/** What each kind of finding is, said plainly, for a sentence on the page. */
const SAYS: Partial<Record<string, string>> = {
  unused_import: "an import nothing uses",
  unused_file: "a file nothing imports",
  unused_export: "an export nothing imports",
  needless_export: "an export only its own file uses",
  claudeism: "a comment that only repeats the code",
};
const examples = [...new Map(demo.hunks.filter((h) => h.safe).map((h) => [h.kind, h])).values()].slice(0, 3);

const hero = `
<section class="hero">
  ${asciiShark(seaCode)}
  <div class="hero-grid">
    <div class="hero-title">
      <div class="hero-tag">skrub</div>
      <div>
        <h1 class="hero-h">clean code &amp; product sense for coding agents<em>.</em></h1>
        <p class="hero-tagline">skrub deletes the dead code your agent leaves behind, points it back at what the repo already has, and starts every session knowing what the product is and whose patterns to follow.</p>
      </div>
    </div>
    <div class="hero-copy">
      <div class="hero-stat">${story.lines}<span> of ${story.added} lines</span></div>
      <p class="hero-sub">on <a href="sample">one real pull request</a>: ${story.files} files, <b>${story.added} added lines</b>. skrub found <b>${story.lines}</b> of them the agent didn't need: ${safeCount} safe to delete and ${callCount} judgment calls for you, plus <b>${rewrites}</b> places it rewrote code the repo already had. <a href="sample">review them yourself</a>.</p>
      <p class="hero-links"><a href="${REPO}">[ github ]</a><a href="sample">[ try the review ]</a><code>npx github:amishaba/skrub</code></p>
    </div>
  </div>
</section>
<section class="sec">
  <h2 class="sec-h"><span class="ix">01</span><span class="w">🤔 what i think about code</span></h2>
  <ol class="beliefs">
    <li><span class="bi">i</span><span class="bw">every line is context.</span><p>clean code can sound like a standard from old style books, but agents build on whatever is already there. if the base is strong, so is everything built on it: better code is better context for every agent that touches it next. (on clean code, the same agent used <a href="https://arxiv.org/html/2605.20049v1">7% fewer tokens and re-opened files 34% less</a>.)</p></li>
    <li><span class="bi">ii</span><span class="bw">reduce, reuse, recycle.</span><p>it belongs in code too: reuse what's already there, add an abstraction only when it earns its place, and name things so they can be found again.</p></li>
    <li><span class="bi">iii</span><span class="bw">less code isn't always better code.</span><p>deleting and reusing can go too far. ten screens sharing one api call looks tidy, until that call does heavy backend work and each screen throws most of it away. so skrub only deletes on its own what <a href="https://knip.dev">knip</a> finds unused, then runs the typecheck and puts back anything that broke. anything that needs judgment, like a duplicate or a wrapper that looks pointless, it hands to you.</p></li>
    <li><span class="bi">iv</span><span class="bw">the repo's habits beat anyone's taste.</span><p>models keep changing and getting better. i can't write better code than a frontier model, but i can give it a baseline: the conventions this codebase already follows, read from the code itself.</p></li>
    <li><span class="bi">v</span><span class="bw">if a tool can check it, it doesn't belong in a prompt.</span><p>a rule in a <code>CLAUDE.md</code> is a request, not a guarantee: across 481 of those files, <a href="https://marmelab.com/blog/2026/09/24/the-state-of-ai-harness-engineering-2026.html">only 4.4% of the security rules</a> had anything actually enforcing them. so skrub turns what it can into checks, and leaves the writing for judgment calls.</p></li>
    <li><span class="bi">vi</span><span class="bw">build like a product engineer.</span><p>the best code is the change the user actually needed. before it builds, the agent works out the problem behind the ask, and copies what's conventional in its space: for a devtool, how sentry, braintrust or posthog do it. users already know those patterns, so they don't have to learn yours.</p></li>
  </ol>
</section>
<section class="walk-sec">
  <div class="hero-walk">${walkthrough(demo.hunks, prLines())}</div>
</section>
<section class="sec">
  <h2 class="sec-h"><span class="ix">02</span><span class="w">in the agent's loop</span><span class="note"><code>npx github:amishaba/skrub init</code></span></h2>
  <ol class="beliefs">
    <li><span class="bi">start</span><span class="bw">it knows the product.</span><div class="bp"><p>every session starts with what the product is, who uses it, and whose patterns to follow. on its first session in <a href="https://github.com/amishaba/agentdiff">agentdiff</a>, the agent wrote:</p><ul class="facts"><li><span class="fk">who uses it</span><span>ai engineers checking whether a prompt, tool or model change altered what their agent does, before it merges</span></li><li><span class="fk">model on</span><span>braintrust, langsmith, promptfoo</span></li></ul></div></li>
    <li><span class="bi">write</span><span class="bw">it reuses what's there.</span><div class="bp"><p>before the agent adds <code>${esc(hook.file.split("/").pop()!)}</code>, skrub points it at what the repo already has:</p><ul class="facts">${hook.lines.map((l) => {
        const m = /^(\S+) is (\d+)% the same as (\S+) in (\S+)\.$/.exec(l);
        return m ? `<li><span class="fk">${esc(m[1]!)}</span><span>${m[2]}% the same as ${esc(m[3]!)}</span></li>` : `<li><span>${esc(l)}</span></li>`;
      }).join("")}</ul><p>in this demo the agent writes the file anyway, so the rest of the story has something to clean up.</p></div></li>
    <li><span class="bi">done?</span><span class="bw">skrub checks the change.</span><div class="bp"><p>the agent wrote ${story.added} lines across ${story.files} files. skrub finds <b>${story.lines}</b> it didn't need: ${examples.map((h) => SAYS[h.kind] ?? esc(tagOf(h))).join(", ")}, and more. it says so once, in at most ten lines.</p></div></li>
    <li><span class="bi">fix</span><span class="bw">the safe ones go.</span><div class="bp"><p><code>skrub fix</code> deletes the ${safeCount} nothing uses, runs the typecheck, and puts back anything that broke.</p></div></li>
    <li><span class="bi">you</span><span class="bw">the rest are your call.</span><div class="bp"><p>${callCount} judgment calls, like a wrapper or a copy of a helper, wait for you: delete them, or keep one with a reason. skrub never asks twice, and a clean change never stops at all.</p></div></li>
  </ol>
  <p class="setup"><code>init</code> sets up the product and conventions in <code>.claude/conventions.md</code>, three hooks (session start, before a new file, before the agent stops), and a skill with a product engineer's guide.</p>
</section>
<section class="sec">
  <h2 class="sec-h"><span class="ix">03</span><span class="w">does it help?</span><span class="note">8 real repos and live claude code runs · oct 2026</span></h2>
  <ol class="beliefs">
    <li><span class="bi">fix</span><span class="bw">8 of 8 real repos stayed green.</span><p>every safe finding applied at once, then typecheck, tests and build still pass. the version before knip broke 4 of them.</p></li>
    <li><span class="bi">fix</span><span class="bw">33 edits on agentdiff, nothing broke.</span><p>dead code and exports nothing else needed, from one <code>fix</code>. typecheck, tests, build and lint all still pass.</p></li>
    <li><span class="bi">claude code</span><span class="bw">1 new file instead of 2.</span><p>the same csv task, with and without skrub. with it, the agent read the product guide, ran <code>fix</code>, and said no to a flag that would have done nothing.</p></li>
    <li><span class="bi">claude code</span><span class="bw">no copies.</span><p>told to put its summing logic in a new file, the agent reused <code>columnTotals</code> instead, and said why.</p></li>
    <li><span class="bi">first run</span><span class="bw">3 products to model on.</span><p>on its first session in agentdiff, the agent picked braintrust, langsmith and promptfoo. you approve the edit, so you can correct it.</p></li>
  </ol>
</section>`;

// The landing page: the template's chrome, with the story instead of the review app.
const landingHeader = `<header>
  <a class="brand" href="${REPO}">skrub<em>.</em></a>
</header>`;
const footer = `<footer>
  <span class="fin">fin</span>
  <span>made by amisha</span>
  <span>a demo of <a href="${REPO}">skrub</a></span>
</footer>`;
const landing = src
  .replace("<title>skrub</title>", () => `<title>skrub</title>${meta}`)
  .replace("</head>", () => `${styles}\n</head>`)
  .replace(/<header>[\s\S]*?<\/header>/, () => `${landingHeader}\n${hero}`)
  .replace(/<p id="error"[\s\S]*?<\/main>\n/, () => "")
  .replace(/<footer>[\s\S]*?<\/footer>/, () => footer)
  .replace(/<script>\nconst \$ = [\s\S]*?<\/script>\n/, () => "");

// The sample review: the real review app, answering from the baked scan.
const sample = src
  .replace("<title>skrub</title>", () => `<title>skrub · sample review</title>\n<meta name="robots" content="noindex" />`)
  .replace("</head>", () => `${shim}\n</head>`)
  .replace('class="brand" href="#"', 'class="brand" href="/"')
  .replace(
    "<span>apply with <code>__SKRUB__ apply</code></span>",
    () => `<span>the sample pr, reviewed · <a href="/">back to skrub</a></span>`,
  )
  .replaceAll("__SKRUB__", "npx github:amishaba/skrub");

for (const [page, markers] of [
  [landing, ["og:image", 'class="hero"', 'class="pr"', 'class="beliefs"', 'href="sample"', "made by amisha"]],
  [sample, ["__SKRUB_DEMO__", '<main id="main">', "const $ = ", "back to skrub"]],
] as const) {
  for (const marker of markers) if (!page.includes(marker)) throw new Error(`injection failed: ${marker}`);
}
for (const gone of ['id="filters"', '<main id="main">', "__SKRUB_DEMO__"]) {
  if (landing.includes(gone)) throw new Error(`landing page still has ${gone}`);
}
writeFileSync(path.join(root, "web/index.html"), landing);
writeFileSync(path.join(root, "web/sample.html"), sample);
console.log(
  `wrote web/index.html (${(landing.length / 1024).toFixed(0)}KB) and web/sample.html (${(sample.length / 1024).toFixed(0)}KB)  ` +
    `${story.hunks} hunks · ${story.deletions} deletions · ${story.lines} of ${story.added} lines`,
);
