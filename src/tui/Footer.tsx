import { Box, Text } from "ink";
import { SPINNER, useTick } from "./motion.ts";

export type FooterHint = "d" | "k" | "a";

export function Footer(props: {
  empty?: boolean;
  status?: string;
  applying?: boolean;
  hint?: FooterHint;
}) {
  const tick = useTick(80, !!props.applying);
  const frame = SPINNER[tick % SPINNER.length];
  const status = props.applying ? `${frame}  applying…` : props.status;

  return (
    <Box flexDirection="column">
      {status ? <Text wrap="truncate-end">{status}</Text> : null}
      <Text wrap="truncate-end">
        {props.empty ? (
          "[q] quit"
        ) : (
          <>
            <Text color={props.hint === "d" ? "red" : undefined} bold={props.hint === "d"}>
              [d] delete
            </Text>
            {"  "}
            <Text dimColor={props.hint === "k"} bold={props.hint === "k"}>
              [k] keep
            </Text>
            {"  [n/p] next  "}
            <Text bold={props.hint === "a"}>{`[a] apply`}</Text>
            {"  [q] quit"}
          </>
        )}
      </Text>
    </Box>
  );
}
