import path from "node:path";
import { spawn } from "node:child_process";
import { fail } from "../lib/errors.ts";
import { latestScanId, listScanIds, readScan, resolveScanDir } from "../store/scans.ts";
import { printScanSummary } from "../report/terminal.ts";
import { startReviewServer } from "../view/server.ts";
import { isInteractiveTty } from "../tui/tty.ts";
import { runHint } from "../agent/self.ts";

export async function viewCommand(
  opts: { port?: string; cwd?: string; open?: boolean; web?: boolean } = {},
): Promise<void> {
  const cwd = path.resolve(opts.cwd ?? process.cwd());

  if (!opts.web) {
    if (!isInteractiveTty()) {
      const id = await latestScanId(cwd);
      if (!id) fail(`no scan to view — run ${runHint()} first`);
      const scan = await readScan(cwd, id);
      printScanSummary(scan, { dir: await resolveScanDir(cwd, id), hint: false });
      return;
    }
    const { launchTui } = await import("../tui/launch.tsx");
    await launchTui({ mode: "view", cwd });
    return;
  }

  await viewWeb({ port: opts.port, cwd, open: opts.open });
}

async function viewWeb(opts: { port?: string; cwd: string; open?: boolean }): Promise<void> {
  const cwd = opts.cwd;
  const wanted = opts.port ? Number.parseInt(opts.port, 10) : 4322;
  if (!Number.isFinite(wanted) || wanted < 1 || wanted > 65535) {
    fail("--port must be a number between 1 and 65535.");
  }

  const port = await startReviewServer(cwd, wanted);
  const url = `http://127.0.0.1:${port}/review`;
  const scans = await listScanIds(cwd);

  console.log(`skrub view  ${url}`);
  console.log(`  demo preview: http://127.0.0.1:${port}/`);
  if (scans.length === 0) {
    console.log(`  no scans yet — ${runHint()}`);
  } else {
    console.log(`  ${scans.length} scan${scans.length === 1 ? "" : "s"}`);
  }
  console.log("  Ctrl+C to stop");

  if (opts.open !== false) openBrowser(url);
}

function openBrowser(url: string): void {
  const cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
  try {
    spawn(cmd, [url], { stdio: "ignore", detached: true, shell: process.platform === "win32" }).unref();
  } catch {
    // URL is printed regardless
  }
}
