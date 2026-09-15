import { Box, Text } from "ink";
import type { Decision, Hunk } from "../hunk.ts";

export const LIST_WIDTH = 34;

function mark(decision: Decision | undefined): string {
  return decision === "accept" ? "×" : "·";
}

function loc(h: Hunk, max: number): string {
  const s = `${h.file}:${h.startLine}`;
  if (s.length <= max) return s;
  return `…${s.slice(s.length - (max - 1))}`;
}

function pad(s: string, width: number): string {
  const clipped = s.length > width ? s.slice(0, width) : s;
  return clipped + " ".repeat(width - clipped.length);
}

export function HunkList(props: {
  hunks: Hunk[];
  index: number;
  decisions: Record<string, Decision | undefined>;
  height: number;
  flash?: Decision | null;
}) {
  const { hunks, index, decisions, height, flash } = props;
  const window = Math.max(1, height);
  let start = Math.max(0, index - Math.floor(window / 2));
  start = Math.min(start, Math.max(0, hunks.length - window));
  const slice = hunks.slice(start, start + window);

  return (
    <Box flexDirection="column" width={LIST_WIDTH + 1} flexShrink={0}>
      {slice.map((h, i) => {
        const at = start + i;
        const current = at === index;
        const pending = decisions[h.id] == null;
        const label = pad(` ${mark(decisions[h.id])} ${loc(h, LIST_WIDTH - 4)}`, LIST_WIDTH);
        const killing = current && flash === "accept";
        return (
          <Text
            key={h.id}
            inverse={current}
            dimColor={!current && pending}
            color={killing ? "red" : undefined}
          >
            {`${label}│`}
          </Text>
        );
      })}
    </Box>
  );
}
