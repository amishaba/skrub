import path from "node:path";
import { fixable } from "../hunk.ts";
import { fail, errMessage } from "../lib/errors.ts";
import { runScan } from "../scan/run.ts";
import type { Scan } from "../scan/summary.ts";
import { type FixResult, fix } from "../patch/fix.ts";
import { findingLines, headline } from "../report/report.ts";

interface FixOpts {
  against?: string;
  staged?: boolean;
  cwd?: string;
  llm?: boolean;
  all?: boolean;
  dryRun?: boolean;
  json?: boolean;
  verify?: boolean;
}

/** Prints what it removed and what it left for a person to read. */
export async function fixCommand(opts: FixOpts): Promise<void> {
  const cwd = path.resolve(opts.cwd ?? process.cwd());
  let result: FixResult;
  try {
    result = await fix(cwd, opts);
  } catch (err) {
    fail(errMessage(err));
  }
  const { done, left, reverted, errors, verified, stopped } = result;

  if (opts.json) {
    console.log(JSON.stringify({ [opts.dryRun ? "wouldApply" : "applied"]: done, left, reverted, errors, verified, stopped }, null, 2));
    return;
  }

  if (done.length === 0) {
    console.log(`skrub fix  nothing ${opts.all ? "to delete" : "safe to delete"}`);
  } else {
    console.log(`skrub fix  ${opts.dryRun ? "would apply" : "applied"}: ${headline(done)}`);
    for (const line of findingLines(done)) console.log(`  ${line}`);
  }
  if (stopped) console.log(`\n  stopped after an earlier pass: ${stopped}`);
  if (verified && !opts.dryRun) console.log(`\n  checked with ${verified}: passes`);
  if (reverted.length > 0) {
    console.log(`\n  kept (${reverted.length}): ${errors.length ? "deleting these broke the typecheck, so they went back" : "these broke the typecheck on an earlier run"}`);
    for (const line of findingLines(reverted)) console.log(`  ${line}`);
    for (const e of errors.slice(0, 5)) console.log(`    ${e}`);
  }
  if (left.length > 0) {
    console.log(`\n  left for review (${left.length}): not provably dead; read, then delete or keep`);
    for (const line of findingLines(left)) console.log(`  ${line}`);
  }
}

/** Exit 1 when there is something to delete (safe only, unless --all). For CI and scripts. */
export async function checkCommand(opts: FixOpts): Promise<void> {
  const cwd = path.resolve(opts.cwd ?? process.cwd());
  let scan: Scan;
  try {
    ({ scan } = await runScan({ against: opts.against, staged: opts.staged, cwd, llm: opts.llm ?? false }));
  } catch (err) {
    fail(errMessage(err));
  }
  const failing = fixable(scan.hunks, opts.all);
  if (opts.json) {
    console.log(JSON.stringify({ ok: failing.length === 0, hunks: scan.hunks }, null, 2));
  } else {
    console.log(`skrub check  ${headline(scan.hunks)}`);
    for (const line of findingLines(scan.hunks)) console.log(`  ${line}`);
  }
  if (failing.length > 0) process.exitCode = 1;
}
