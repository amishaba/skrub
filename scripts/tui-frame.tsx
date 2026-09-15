/**
 * Render one frame of the real TUI to an HTML file, for a screenshot.
 *
 * Mounts the Ink app in view mode on web/scan.json with a fake 110x30 TTY,
 * presses n once, lets the reveal and count-up animations finish, takes the
 * last frame Ink wrote, and turns its ANSI styling into <span>s. docs/tui.png is a headless
 * Chrome capture of that file. Nothing is drawn by hand.
 *
 *   FORCE_COLOR=3 node --import tsx scripts/tui-frame.tsx out.html
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { PassThrough } from "node:stream";
import { fileURLToPath } from "node:url";
import { render } from "ink";
import { App } from "../src/tui/App.tsx";
import type { Scan } from "../src/scan/summary.ts";

const root = path.resolve(fileURLToPath(import.meta.url), "../..");
const out = process.argv[2] ?? path.join(root, "docs/tui.html");
const COLS = 110;
const ROWS = 30;

const scan = JSON.parse(readFileSync(path.join(root, "web/scan.json"), "utf8")) as Scan;
// one decision already made (× in the list, "1 accepted" in the header), then
// press n once so the frame shows the second hunk: a whole unused file.
const decisions = { [scan.hunks[0]!.id]: "accept" } as const;

type Tty = PassThrough & { columns: number; rows: number; isTTY: boolean; setRawMode: () => void; ref: () => void; unref: () => void };
const stdout = Object.assign(new PassThrough(), { columns: COLS, rows: ROWS, isTTY: true, setRawMode() {}, ref() {}, unref() {} }) as Tty;
const stdin = Object.assign(new PassThrough(), { columns: COLS, rows: ROWS, isTTY: true, setRawMode() {}, ref() {}, unref() {} }) as Tty;

const frames: string[] = [];
stdout.on("data", (chunk: Buffer) => frames.push(chunk.toString("utf8")));

const instance = render(<App mode="view" cwd={root} scan={scan} decisions={{ ...decisions }} />, {
  stdout: stdout as unknown as NodeJS.WriteStream,
  stdin: stdin as unknown as NodeJS.ReadStream,
  exitOnCtrlC: false,
  patchConsole: false,
});
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
await sleep(400);
stdin.write("n");
await sleep(2200);
const last = [...frames].reverse().find((f) => f.includes("\n")) ?? "";
instance.unmount();

// Ink writes erase-lines sequences before each frame; keep only the frame.
const frame = last.replace(/\x1b\[\?25[lh]/g, "").replace(/\x1b\[\d*[AKGJH]/g, "");

interface Style { fg?: string; bg?: string; bold?: boolean; dim?: boolean; inverse?: boolean; strike?: boolean }
const BASIC: Record<number, string> = { 30: "#000", 31: "#ff5f56", 32: "#3ddc84", 33: "#e5c07b", 34: "#61afef", 35: "#c678dd", 36: "#56b6c2", 37: "#e8e8e8", 90: "#6b6b6b", 91: "#ff5f56", 92: "#3ddc84", 97: "#fff" };

function toHtml(text: string): string {
  let style: Style = {};
  let html = "";
  let buf = "";
  const flush = () => {
    if (!buf) return;
    const css: string[] = [];
    let fg = style.fg;
    let bg = style.bg;
    if (style.inverse) [fg, bg] = [bg ?? "#000", fg ?? "#e8e8e8"];
    if (fg) css.push(`color:${fg}`);
    if (bg) css.push(`background:${bg}`);
    if (style.bold) css.push("font-weight:700");
    if (style.dim) css.push("opacity:.45");
    if (style.strike) css.push("text-decoration:line-through");
    const esc = buf.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    html += css.length ? `<span style="${css.join(";")}">${esc}</span>` : esc;
    buf = "";
  };
  const re = /\x1b\[([\d;]*)m/g;
  let i = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    buf += text.slice(i, m.index);
    flush();
    i = m.index + m[0].length;
    const p = (m[1] ?? "").split(";").map(Number);
    for (let k = 0; k < p.length; k++) {
      const n = p[k]!;
      if (n === 0) style = {};
      else if (n === 1) style.bold = true;
      else if (n === 2) style.dim = true;
      else if (n === 7) style.inverse = true;
      else if (n === 9) style.strike = true;
      else if (n === 22) { style.bold = false; style.dim = false; }
      else if (n === 27) style.inverse = false;
      else if (n === 29) style.strike = false;
      else if (n === 39) style.fg = undefined;
      else if (n === 49) style.bg = undefined;
      else if (n === 38 && p[k + 1] === 2) { style.fg = `rgb(${p[k + 2]},${p[k + 3]},${p[k + 4]})`; k += 4; }
      else if (n === 48 && p[k + 1] === 2) { style.bg = `rgb(${p[k + 2]},${p[k + 3]},${p[k + 4]})`; k += 4; }
      else if (BASIC[n]) style.fg = BASIC[n];
      else if (BASIC[n - 10]) style.bg = BASIC[n - 10];
    }
  }
  buf += text.slice(i);
  flush();
  return html;
}

const page = `<!doctype html>
<html lang="en"><head><meta charset="utf-8" />
<link rel="preconnect" href="https://fonts.googleapis.com" /><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;700&display=swap" rel="stylesheet" />
<style>
  html, body { margin: 0; background: #000; }
  pre { margin: 0; padding: 22px 26px; color: #e8e8e8; font: 13px/1.2 "JetBrains Mono", ui-monospace, Menlo, monospace; white-space: pre; }
</style></head><body><pre>${toHtml(frame)}</pre></body></html>
`;
writeFileSync(out, page);
console.log(`wrote ${out}  ${frame.split("\n").length} rows  ${frames.length} frames captured`);
process.exit(0);
