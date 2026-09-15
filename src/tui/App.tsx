import { useEffect, useRef, useState } from "react";
import { Box, Text, useApp, useInput } from "ink";
import type { Decision, Decisions } from "../hunk.ts";
import type { Scan } from "../scan/summary.ts";
import { errMessage } from "../lib/errors.ts";
import { runScan } from "../scan/run.ts";
import { applyAccepted } from "../patch/apply.ts";
import { writeDecisions } from "../store/scans.ts";
import { Footer, type FooterHint } from "./Footer.tsx";
import { Header } from "./Header.tsx";
import { HunkBody } from "./HunkBody.tsx";
import { HunkList, LIST_WIDTH } from "./HunkList.tsx";
import { ScanSpinner } from "./ScanSpinner.tsx";
import { SHARK_ROWS, Shark } from "./Shark.tsx";
import { useTerminalSize } from "./useTerminalSize.ts";

export interface TuiProps {
  cwd: string;
  mode: "scan" | "view";
  scanOpts?: { against?: string; staged?: boolean; llm?: boolean };
  scan?: Scan;
  decisions?: Decisions;
}

export function App(props: TuiProps) {
  const { cwd, mode } = props;
  const { exit } = useApp();
  const { columns, rows } = useTerminalSize();

  const [phase, setPhase] = useState<"scanning" | "review" | "error">(
    mode === "scan" ? "scanning" : "review",
  );
  const [scan, setScan] = useState<Scan | undefined>(props.scan);
  const [decisions, setDecisions] = useState<Decisions>(props.decisions ?? {});
  const [index, setIndex] = useState(0);
  const [status, setStatus] = useState<string | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [applying, setApplying] = useState(false);
  const [flash, setFlash] = useState<Decision | null>(null);
  const [hint, setHint] = useState<FooterHint | undefined>();

  const decisionsRef = useRef(decisions);
  decisionsRef.current = decisions;
  const applyingRef = useRef(false);
  const flashRef = useRef(false);
  const flashTimer = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    return () => {
      if (flashTimer.current) clearTimeout(flashTimer.current);
    };
  }, []);

  useEffect(() => {
    if (mode !== "scan") return;
    let alive = true;
    (async () => {
      const started = Date.now();
      try {
        const result = await runScan({
          cwd,
          against: props.scanOpts?.against,
          staged: props.scanOpts?.staged,
          llm: props.scanOpts?.llm,
        });
        const hold = Math.max(0, 2400 - (Date.now() - started));
        if (hold) await new Promise((r) => setTimeout(r, hold));
        if (!alive) return;
        setScan(result.scan);
        setDecisions({});
        setPhase("review");
      } catch (err) {
        if (!alive) return;
        setError(errMessage(err));
        setPhase("error");
      }
    })();
    return () => {
      alive = false;
    };
  }, [mode, cwd, props.scanOpts?.against, props.scanOpts?.staged, props.scanOpts?.llm]);

  const hunks = scan?.hunks ?? [];
  const current = hunks[index];

  useInput((input, key) => {
    const ch = input.toLowerCase();
    if (ch === "q") {
      exit();
      return;
    }
    if (phase !== "review" || applyingRef.current || flashRef.current) return;

    if (ch === "n" || key.downArrow || key.rightArrow) {
      setIndex((i) => Math.max(0, Math.min(hunks.length - 1, i + 1)));
      return;
    }
    if (ch === "p" || key.upArrow || key.leftArrow) {
      setIndex((i) => Math.max(0, i - 1));
      return;
    }
    if ((ch === "d" || ch === "k") && current && scan) {
      const decision: Decision = ch === "d" ? "accept" : "skip";
      const next = { ...decisionsRef.current, [current.id]: decision };
      decisionsRef.current = next;
      setDecisions(next);
      void writeDecisions(cwd, scan.summary.id, next).catch((err) => {
        setStatus(errMessage(err));
      });
      flashRef.current = true;
      setFlash(decision);
      setHint(ch === "d" ? "d" : "k");
      if (flashTimer.current) clearTimeout(flashTimer.current);
      flashTimer.current = setTimeout(() => {
        setFlash(null);
        setHint(undefined);
        setIndex((i) => Math.max(0, Math.min(hunks.length - 1, i + 1)));
        flashRef.current = false;
      }, 180);
      return;
    }
    if (ch === "a" && scan) {
      applyingRef.current = true;
      setApplying(true);
      setHint("a");
      setStatus(undefined);
      void applyAccepted(cwd, scan.summary.id)
        .then((result) => {
          setStatus(result.applied === 0 ? "nothing accepted" : `applied ${result.applied} ${result.applied === 1 ? "finding" : "findings"}`);
        })
        .catch((err) => {
          setStatus(errMessage(err).split("\n")[0] ?? "apply failed");
        })
        .finally(() => {
          applyingRef.current = false;
          setApplying(false);
          setHint(undefined);
        });
    }
  });

  const accepted = Object.values(decisions).filter((d) => d === "accept").length;
  const showList = columns >= 100 && hunks.length > 0;
  const statusRows = status || applying ? 1 : 0;
  const chrome = 4 + statusRows;
  const bodyRows = Math.max(1, rows - chrome);
  const showShark = phase === "review" && bodyRows >= SHARK_ROWS + 8;
  const bodyLines = Math.max(1, bodyRows - 3 - (showShark ? SHARK_ROWS + 1 : 0));
  const sharkCols = Math.max(8, columns - (showList ? LIST_WIDTH + 3 : 3));

  return (
    <Box flexDirection="column" width={columns} height={rows}>
      <Box flexShrink={0}>
        <Header
          scanning={phase === "scanning" || !scan}
          hunks={scan?.summary.hunks ?? 0}
          lines={scan?.summary.lines ?? 0}
          accepted={accepted}
          llm={scan?.summary.llm ?? null}
          index={index}
          total={hunks.length}
        />
      </Box>
      <Text dimColor wrap="truncate-end">
        {"─".repeat(Math.max(1, columns))}
      </Text>
      <Box flexGrow={1} flexDirection="row" overflow="hidden" height={bodyRows}>
        {phase === "scanning" ? (
          <ScanSpinner columns={columns} rows={bodyRows} />
        ) : phase === "error" ? (
          <Text wrap="truncate-end">{` ${error}`}</Text>
        ) : (
          <Box flexDirection="row" flexGrow={1} overflow="hidden">
            {showList ? (
              <HunkList
                hunks={hunks}
                index={index}
                decisions={decisions}
                height={bodyRows}
                flash={flash}
              />
            ) : null}
            <Box flexDirection="column" flexGrow={1} overflow="hidden">
              <Box flexGrow={1} overflow="hidden">
                <HunkBody
                  hunk={current}
                  decision={current ? decisions[current.id] : undefined}
                  flash={flash}
                  maxLines={bodyLines}
                />
              </Box>
              {showShark ? (
                <Box flexShrink={0} height={SHARK_ROWS} paddingLeft={1}>
                  <Shark columns={sharkCols} />
                </Box>
              ) : null}
            </Box>
          </Box>
        )}
      </Box>
      <Text dimColor wrap="truncate-end">
        {"─".repeat(Math.max(1, columns))}
      </Text>
      <Box flexShrink={0}>
        <Footer
          empty={phase !== "review" || hunks.length === 0}
          status={status}
          applying={applying}
          hint={hint}
        />
      </Box>
    </Box>
  );
}
