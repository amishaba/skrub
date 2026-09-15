import { GRIDS, PALETTE } from "../src/tui/sharkArt.ts";

/**
 * The hero band: the sample pr's leftover code as an ascii field, and the TUI's
 * shark, redrawn in characters, eating a lane through it. The lane grows back.
 * Each sprite pixel is two characters wide and one line tall, so it stays square.
 */
export function asciiShark(code: string): string {
  const frames = Object.fromEntries(Object.entries(GRIDS).map(([k, g]) => [k, g.map((row) => row.join(""))]));
  const field = code.replace(/\s+/g, " ").trim();
  const colors = Object.entries(PALETTE)
    .filter(([k]) => k !== "k" && k !== "p")
    .map(([k, c]) => `.sea-${k}{color:${c}}`)
    .join("");
  const inline = (v: unknown) => JSON.stringify(v).replace(/<\//g, "<\\/");
  return `<div class="sea" id="sea" role="img" aria-label="an ascii shark swimming through the sample pull request's code, eating it as it goes"><pre id="sea-pre" aria-hidden="true"></pre><span class="sea-count" aria-hidden="true"><b id="sea-count">0</b> chars eaten</span></div>
<style>
.sea {position:relative;overflow:hidden;border-bottom:1px solid var(--rule);padding:22px 0;}
.sea pre {margin:0;padding:0;border:0;max-height:none;overflow:hidden;white-space:pre;color:rgba(255,255,255,.15);font-family:var(--mono);font-size:9px;line-height:10.8px;user-select:none;}
${colors}
.sea-d {color:#3a66c8;}
.sea-new {color:var(--green);opacity:.6;}
.sea-count {position:absolute;right:12px;bottom:6px;padding:2px 6px;background:var(--bg);color:var(--dim);font-size:10px;}
.sea-count b {color:var(--ink);font-weight:400;font-variant-numeric:tabular-nums;}
</style>
<script>
(() => {
  const FRAMES = ${inline(frames)};
  const CODE = ${inline(field)};
  const GLYPHS = { l: "%&$#", b: "#@$%&", g: ":=+-", d: "#%&", o: "**", e: "@@", c: "//", r: "##", w: "vw", m: "~~" };
  const ROWS = 20, SH = FRAMES.aOpen.length, SW = FRAMES.aOpen[0].length * 2, TICK = 55;
  const sea = document.getElementById("sea"), pre = document.getElementById("sea-pre"), count = document.getElementById("sea-count");
  const reduce = matchMedia("(prefers-reduced-motion: reduce)");
  let cols = 0, regrow = new Float64Array(0), x = 0, tick = 0, clock = 0, last = null, visible = true, eaten = 0;

  function frameOf(t) {
    const blink = t % 28 >= 26, a = Math.floor(t / 3) % 2 === 0;
    return FRAMES[(a ? "a" : "b") + (blink ? "Blink" : "Open")];
  }
  function glyph(k, c, r) {
    const set = GLYPHS[k];
    return set[((c * 7 + r * 13 + (tick >> 2) * 5) >>> 0) % set.length];
  }
  function shark() {
    const top = Math.round((ROWS - SH) / 2 + Math.sin(tick / 9));
    return { grid: frameOf(tick), top, left: x };
  }
  function size() {
    const w = sea.clientWidth;
    const fs = Math.max(5, Math.min(9, (w * 0.62) / (SW * 0.6)));
    pre.style.fontSize = fs + "px";
    pre.style.lineHeight = fs * 1.2 + "px";
    pre.style.height = ROWS * fs * 1.2 + "px";
    cols = Math.floor(w / (fs * 0.6));
    regrow = new Float64Array(cols * ROWS);
    eaten = 0;
    if (reduce.matches) still();
  }
  function eat(s) {
    for (let r = 0; r < SH; r++) {
      const row = s.grid[r], y = s.top + r;
      if (y < 0 || y >= ROWS) continue;
      for (let p = 0; p < row.length; p++) {
        if (row[p] === ".") continue;
        for (let h = 0; h < 2; h++) {
          const c = s.left + p * 2 + h;
          if (c < 0 || c >= cols) continue;
          const i = y * cols + c;
          if (regrow[i] <= clock) eaten++;
          regrow[i] = clock + 4000 + Math.random() * 7000;
        }
      }
    }
  }
  function draw(s) {
    let html = "";
    for (let r = 0; r < ROWS; r++) {
      let run = "", cls = "", line = "";
      const flush = () => { if (run) line += cls ? '<span class="sea-' + cls + '">' + run + "</span>" : run; run = ""; };
      for (let c = 0; c < cols; c++) {
        let k = "", ch;
        const sy = r - s.top, sx = c - s.left;
        const px = sy >= 0 && sy < SH && sx >= 0 && sx < SW ? s.grid[sy][sx >> 1] : ".";
        if (px === "k" || px === "p") ch = " ";
        else if (px !== ".") { k = px; ch = glyph(px, c, r); }
        else {
          const due = regrow[r * cols + c];
          if (due > clock) ch = " ";
          else {
            ch = CODE[(r * cols + c) % CODE.length];
            if (due && clock - due < 700) k = "new";
          }
        }
        if (k !== cls) { flush(); cls = k; }
        run += ch === "<" ? "&lt;" : ch === "&" ? "&amp;" : ch;
      }
      flush();
      html += line + "\\n";
    }
    pre.innerHTML = html;
    count.textContent = eaten.toLocaleString("en-US");
  }
  function step() {
    tick++;
    clock += TICK;
    x++;
    if (x > cols + 24) x = -SW - 10;
    const s = shark();
    eat(s);
    draw(s);
  }
  function still() {
    x = Math.round(cols * 0.56);
    const s = shark();
    for (let at = -SW; at <= x; at++) eat({ ...s, left: at });
    clock = 0;
    draw(s);
  }
  function loop(now) {
    if (!reduce.matches && visible && !document.hidden) {
      if (last === null) last = now;
      while (now - last >= TICK) { step(); last += TICK; }
    } else last = null;
    requestAnimationFrame(loop);
  }
  if ("IntersectionObserver" in window) new IntersectionObserver((e) => { visible = e[0].isIntersecting; }).observe(sea);
  addEventListener("resize", size);
  reduce.addEventListener("change", size);
  if (document.fonts) document.fonts.ready.then(size);
  size();
  if (!reduce.matches) { x = Math.round(cols * 0.08); draw(shark()); }
  requestAnimationFrame(loop);
})();
</script>`;
}
