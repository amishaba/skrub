import { Text } from "ink";
import { useCountUp, usePulse } from "./motion.ts";

export function Header(props: {
  scanning?: boolean;
  hunks: number;
  lines: number;
  accepted: number;
  llm: string | null;
  index: number;
  total: number;
}) {
  const hunks = useCountUp(props.hunks, !props.scanning);
  const lines = useCountUp(props.lines, !props.scanning);
  const bumped = usePulse(props.accepted);

  if (props.scanning) {
    return (
      <Text wrap="truncate-end">
        <Text bold>skrub</Text>
      </Text>
    );
  }

  const llm = props.llm ? `llm ${props.llm}` : "mechanical";
  const pos = props.total === 0 ? "0/0" : `${props.index + 1}/${props.total}`;
  return (
    <Text wrap="truncate-end">
      <Text bold>skrub</Text>
      {`    ${hunks} hunks    ${lines} lines    `}
      <Text color={bumped ? "red" : undefined} bold={bumped}>
        {`${props.accepted} accepted`}
      </Text>
      {`    ${llm}    ${pos}`}
    </Text>
  );
}
