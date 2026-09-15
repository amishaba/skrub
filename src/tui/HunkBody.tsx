import { Box, Text } from "ink";
import type { Decision, Hunk } from "../hunk.ts";
import { useReveal } from "./motion.ts";

export function HunkBody(props: {
  hunk: Hunk | undefined;
  decision?: Decision;
  flash?: Decision | null;
  maxLines: number;
}) {
  const { hunk, decision, flash, maxLines } = props;
  const lines = hunk?.text.split("\n") ?? [];
  const budget = Math.max(1, maxLines);
  const clipped = lines.length > budget ? [...lines.slice(0, budget - 1), "…"] : lines;
  const shown = useReveal(hunk?.id ?? "", clipped.length, 18);

  if (!hunk) {
    return <Text dimColor> no hunks</Text>;
  }

  const tag = `${hunk.kind}${hunk.safe ? " · safe" : ""}`;
  const decided = decision === "accept" ? "  ×" : decision === "skip" ? "  ·" : "";
  const killing = flash === "accept";
  const keeping = flash === "skip";

  return (
    <Box flexDirection="column" flexGrow={1} overflow="hidden" paddingLeft={1}>
      <Text wrap="truncate-end" color={killing ? "red" : undefined} dimColor={keeping}>
        {`${hunk.file}:${hunk.startLine}`}
        <Text dimColor={keeping} color={killing ? "red" : undefined}>
          {`     ${tag}`}
        </Text>
        {decided}
      </Text>
      <Text wrap="truncate-end" dimColor={keeping} strikethrough={killing}>
        {hunk.reason}
      </Text>
      <Text> </Text>
      {clipped.slice(0, shown).map((line, i) => (
        <Text
          key={i}
          wrap="truncate-end"
          dimColor={keeping || i === shown - 1}
          strikethrough={killing && hunk.replacement == null}
          color={killing ? "red" : undefined}
        >
          {line}
        </Text>
      ))}
      {hunk.replacement != null && shown >= clipped.length ? (
        <Text wrap="truncate-end" color="green" dimColor={keeping}>
          {`→ ${hunk.replacement.replace(/\n$/, "")}`}
        </Text>
      ) : null}
    </Box>
  );
}
