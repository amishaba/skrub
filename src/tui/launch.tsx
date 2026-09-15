import { render } from "ink";
import { fail } from "../lib/errors.ts";
import { latestScanId, readDecisions, readScan } from "../store/scans.ts";
import { App, type TuiProps } from "./App.tsx";
import { runHint } from "../agent/self.ts";

export async function launchTui(props: {
  cwd: string;
  mode: "scan" | "view";
  scanOpts?: TuiProps["scanOpts"];
}): Promise<void> {
  if (props.mode === "view") {
    const id = await latestScanId(props.cwd);
    if (!id) fail(`no scan to view — run ${runHint()} first`);
    const scan = await readScan(props.cwd, id);
    const decisions = await readDecisions(props.cwd, id);
    const instance = render(<App mode="view" cwd={props.cwd} scan={scan} decisions={decisions} />);
    await instance.waitUntilExit();
    return;
  }

  const instance = render(<App mode="scan" cwd={props.cwd} scanOpts={props.scanOpts} />);
  await instance.waitUntilExit();
}
