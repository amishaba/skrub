import { Box, Text } from "ink";
import { useTick } from "./motion.ts";
import { GRIDS, PALETTE, SHARK_W, frameKey } from "./sharkArt.ts";

/**
 * A chunky pixel-art shark that swims left→right, drawn as a color sprite: two
 * pixels per character cell via the "▀" half-block (foreground = top pixel,
 * background = bottom pixel), so it reads as crisp pixels rather than line art.
 * The sprite data and animation frames live in [sharkArt.ts].
 */

type Cell = { ch: string; color?: string; bg?: string };
const TRANSPARENT: Cell = { ch: " " };

// Fold pairs of pixel rows into one text row of half-block cells.
function toRows(grid: string[][]): Cell[][] {
  const rows: Cell[][] = [];
  for (let y = 0; y < grid.length; y += 2) {
    const row: Cell[] = [];
    for (let x = 0; x < grid[y].length; x++) {
      const top = PALETTE[grid[y][x]!];
      const bot = PALETTE[(grid[y + 1] || [])[x] ?? "."];
      if (top && bot) row.push({ ch: "▀", color: top, bg: bot });
      else if (top) row.push({ ch: "▀", color: top });
      else if (bot) row.push({ ch: "▄", color: bot });
      else row.push(TRANSPARENT);
    }
    rows.push(row);
  }
  return rows;
}

const FRAMES = {
  aOpen: toRows(GRIDS.aOpen),
  aBlink: toRows(GRIDS.aBlink),
  bOpen: toRows(GRIDS.bOpen),
  bBlink: toRows(GRIDS.bBlink),
};

export const SHARK_ROWS = FRAMES.aOpen.length;

type Span = { ch: string; color?: string; bg?: string; n: number };

// Composite one sprite row at horizontal offset `x` over a transparent field of
// `width` cells, then coalesce equal cells into runs for compact rendering.
function rowSpans(cells: Cell[], x: number, width: number): Span[] {
  const spans: Span[] = [];
  for (let c = 0; c < width; c++) {
    const src = c - x;
    const cell = src >= 0 && src < cells.length && cells[src]!.ch !== " " ? cells[src]! : TRANSPARENT;
    const last = spans[spans.length - 1];
    if (last && last.ch === cell.ch && last.color === cell.color && last.bg === cell.bg) last.n++;
    else spans.push({ ch: cell.ch, color: cell.color, bg: cell.bg, n: 1 });
  }
  return spans;
}

export function Shark(props: { columns: number }) {
  const tick = useTick(100);
  const rows = FRAMES[frameKey(tick)];

  const width = Math.max(8, props.columns);
  const span = width + SHARK_W;
  const x = (tick % span) - SHARK_W;

  return (
    <Box flexDirection="column">
      {rows.map((cells, i) => (
        <Text key={i}>
          {rowSpans(cells, x, width).map((s, j) => (
            <Text key={j} color={s.color} backgroundColor={s.bg}>
              {s.ch.repeat(s.n)}
            </Text>
          ))}
        </Text>
      ))}
    </Box>
  );
}
