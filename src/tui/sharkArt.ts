/**
 * The pixel-art shark, as pure data — no React/ink — so both the TUI component
 * ([Shark.tsx]) and the web page's ascii shark ([scripts/ascii-shark.ts]) draw
 * from one source.
 *
 * The silhouette is authored as a fill-only shape (letters below) and gets a
 * black outline traced around it automatically, which keeps the whole body one
 * connected piece. Colors: navy fin with an orange tip, a light-blue back over
 * a blue body with a grey belly, cyan gill slashes, a white eye with a dark
 * pupil, and a red-and-white toothy grin over a pink tongue.
 *
 * The body (and every colored feature) is fixed; only the tail fluke (A ↔ B)
 * and the eye (open ↔ blink) change between frames, so nothing jitters.
 */

// pixel palette — '.'/' ' are transparent
export const PALETTE: Record<string, string> = {
  k: "#12161c", // outline / black
  b: "#3f8fd6", // body blue
  l: "#74b8ef", // light-blue back highlight
  d: "#294c9c", // navy fin
  g: "#c2cace", // grey belly
  w: "#eef3f6", // white teeth
  r: "#d6483f", // red mouth
  e: "#ffffff", // eye white
  p: "#11151b", // pupil
  c: "#37c7d4", // cyan gill slashes
  o: "#f2914e", // orange fin tip
  m: "#ec6aa6", // pink tongue
};

// Fill-only body (no tail). Letters: B body · D fin · O orange-tip · E eye ·
// P pupil · C gill · M red mouth · W teeth · N tongue. The outline is traced on.
const BASE = `
..............DD..............
.............DOOD.............
............DDDDDD............
...........BBBBBBBBBBB........
.........BBBBBBBBBBBBBBB......
........BBBBBBBBBBBBBBEEEB.....
.......BBBBBBBCBCBCBBBEPEBB...
......BBBBBBBBCBCBCBBBBBBBBB..
......BBBBBBBBCBCBCBBBBBBBBB..
.......BBBBBBBBBBBBBMWMWMWB...
........BBBBBBBBBBBWMWMWM.....
..........BBBBBBBBBNNNN.......
............BBBBBBBBB.........
............DDDDD.............
`;

// Two tail poses (columns 0–6) for the swim swish. The peduncle (rows 6–9) is
// shared so the fin stays attached; only the upper/lower lobes swing.
const TAIL_A = [
  ".......", ".......", ".......", ".TT....", ".TTT...", "..TTT..", "...TTTT",
  "....TT.", "....TT.", "...TTTT", "..TTT..", ".TTT...", ".TT....", ".......",
];
const TAIL_B = [
  ".......", ".......", ".......", ".......", ".TT....", ".TTT...", "...TTTT",
  "....TT.", "....TT.", "...TTTT", "..TTTT.", ".TTTT..", ".TTT...", ".......",
];

function parseGrid(sprite: string): string[][] {
  const rows = sprite.split("\n").filter((r) => r.length > 0);
  const w = Math.max(...rows.map((r) => r.length));
  return rows.map((r) => r.padEnd(w, ".").split(""));
}

// Drop a tail pose onto the body's empty left columns.
function compose(base: string[][], tail: string[]): string[][] {
  return base.map((row, y) =>
    row.map((c, x) => {
      const t = (tail[y] ?? "")[x];
      return t && t !== "." ? t : c;
    }),
  );
}

// Trace a 1px black outline around every filled pixel (8-neighbour).
function autoOutline(grid: string[][]): string[][] {
  const h = grid.length;
  const out = grid.map((r) => r.slice());
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < grid[y].length; x++) {
      if (grid[y][x] !== ".") continue;
      let touch = false;
      for (let dy = -1; dy <= 1 && !touch; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const n = (grid[y + dy] || [])[x + dx];
          if (n && n !== "." && n !== "k") { touch = true; break; }
        }
      }
      if (touch) out[y][x] = "k";
    }
  }
  return out;
}

// Body shades top→bottom: light-blue back, blue body, grey belly.
function bodyColor(y: number): string {
  return y <= 6 ? "l" : y <= 9 ? "b" : "g";
}
const RECOLOR: Record<string, string> = {
  T: "d", D: "d", O: "o", E: "e", P: "p", C: "c", M: "r", W: "w", N: "m",
};
function recolor(grid: string[][]): string[][] {
  return grid.map((row, y) => row.map((ch) => (ch === "B" ? bodyColor(y) : (RECOLOR[ch] ?? ch))));
}

function build(tail: string[]): string[][] {
  return recolor(autoOutline(compose(parseGrid(BASE), tail)));
}

// Close the eye: fill the sclera with body colour and drop a dark eyelid line
// across the pupil row.
function blink(grid: string[][]): string[][] {
  const lidRows = new Set<number>();
  grid.forEach((row, y) => {
    if (row.includes("p")) lidRows.add(y);
  });
  return grid.map((row, y) =>
    row.map((c) => {
      if (c === "p") return "k";
      if (c === "e") return lidRows.has(y) ? "k" : bodyColor(y);
      return c;
    }),
  );
}

const gridA = build(TAIL_A);
const gridB = build(TAIL_B);

export const SHARK_W = gridA[0]!.length;

// The four recolored pixel grids the animation cycles through.
export const GRIDS = {
  aOpen: gridA,
  aBlink: blink(gridA),
  bOpen: gridB,
  bBlink: blink(gridB),
};
type FrameKey = keyof typeof GRIDS;

// Which grid to show on a given tick: tail swishes every 3 ticks, a quick blink
// every 28.
export function frameKey(tick: number): FrameKey {
  const blinking = tick % 28 >= 26;
  return Math.floor(tick / 3) % 2 === 0
    ? blinking ? "aBlink" : "aOpen"
    : blinking ? "bBlink" : "bOpen";
}
