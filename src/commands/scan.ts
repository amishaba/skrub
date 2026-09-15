import path from "node:path";
import { runScan } from "../scan/run.ts";
import { isInteractiveTty } from "../tui/tty.ts";
import { printScanSummary } from "../report/terminal.ts";
import { emptyScope } from "../config.ts";
import { fail } from "../lib/errors.ts";

interface ScanOpts {
  against?: string;
  staged?: boolean;
  cwd?: string;
  json?: boolean;
  llm?: boolean;
}

export async function scanCommand(opts: ScanOpts): Promise<void> {
  const cwd = path.resolve(opts.cwd ?? process.cwd());

  if (opts.json || !isInteractiveTty()) {
    const { scan, dir } = await runScan({
      against: opts.against,
      staged: opts.staged,
      cwd,
      llm: opts.llm,
    });
    if (opts.json) {
      console.log(JSON.stringify(scan.summary, null, 2));
      return;
    }
    printScanSummary(scan, { dir, llmFlag: opts.llm });
    return;
  }

  // The TUI shows errors on one line; say this one in full before it opens.
  const empty = await emptyScope(cwd);
  if (empty) fail(empty);
  const { launchTui } = await import("../tui/launch.tsx");
  await launchTui({
    mode: "scan",
    cwd,
    scanOpts: { against: opts.against, staged: opts.staged, llm: opts.llm },
  });
}
