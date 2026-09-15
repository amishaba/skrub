import { Box, Text } from "ink";
import { SPINNER, useTick } from "./motion.ts";
import { SHARK_ROWS, Shark } from "./Shark.tsx";

const STAGES = ["unused exports", "wrappers", "duplicates", "comments", "names"] as const;

export function ScanSpinner(props: { columns: number; rows: number }) {
  const tick = useTick(80);
  const stage = useTick(640) % STAGES.length;
  const frame = SPINNER[tick % SPINNER.length];
  const showStages = props.rows >= SHARK_ROWS + 8;

  return (
    <Box flexDirection="column" paddingLeft={1}>
      <Text>{`${frame}  scanning TypeScript graph…`}</Text>
      <Text> </Text>
      <Shark columns={Math.max(8, props.columns - 2)} />
      {showStages ? (
        <>
          <Text> </Text>
          {STAGES.map((label, i) => (
            <Text key={label} dimColor={i !== stage}>
              {i === stage ? `${frame}  ${label}` : `·  ${label}`}
            </Text>
          ))}
        </>
      ) : null}
    </Box>
  );
}
