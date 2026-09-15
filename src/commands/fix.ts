import path from "node:path";
import { type Hunk, fixable, isApplicable, removesLines } from "../hunk.ts";
import { fail, errMessage } from "../lib/errors.ts";
import { runScan } from "../scan/run.ts";
import type { Scan } from "../scan/summary.ts";
import { type FixResult, fix } from "../patch/fix.ts";
import { findingLines, headline, scopeOf } from "../report/report.ts";

interface FixOpts {
  against?: string;
  staged?: boolean;
  cwd?: string;
  llm?: boolean;
  all?: boolean;
  dryRun?: boolean;
  json?: boolean;
  verify?: boolean;
  wholeRepo?: boolean;
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
  const { done, left, reverted, errors, verified, stopped, scope } = result;

  if (opts.json) {
    console.log(JSON.stringify({ [opts.dryRun ? "wouldApply" : "applied"]: done, left, reverted, errors, verified, stopped, scope }, null, 2));
    return;
  }

  if (done.length === 0) {
    console.log(`skrub fix  nothing ${opts.all ? "to delete" : "safe to delete"} in ${scope}${wider(scope)}`);
  } else {
    console.log(`skrub fix  ${opts.dryRun ? "would apply" : "applied"} in ${scope}${wider(scope)}: ${headline(done)}`);
    for (const line of listed(done)) console.log(`  ${line}`);
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

/** With uncommitted changes, skrub looks only at them; say how to look at everything. */
function wider(scope: string): string {
  return scope === "your uncommitted changes" ? " (--whole-repo for everything)" : "";
}

/** Past a handful, `export` keywords dropped from things used only in their own file are counted and named, not listed one per line. */
const DROPS_LISTED = 5;

/** Every deletion on its own line; export drops folded into one line when there are many, so the deletions stay visible. */
function listed(done: Hunk[]): string[] {
  const drops = done.filter((h) => isApplicable(h) && !removesLines(h));
  if (drops.length <= DROPS_LISTED) return findingLines(done);
  const names = drops.flatMap((h) => h.symbols ?? []);
  const named = names.length > 8 ? `${names.slice(0, 8).join(", ")}, …` : names.join(", ");
  return [
    ...findingLines(done.filter((h) => !drops.includes(h))),
    `+ ${drops.length} exports used only in their own file lose \`export\`${named ? `: ${named}` : ""} (--json lists each)`,
  ];
}

/** Exit 1 when there is something to delete (safe only, unless --all). For CI and scripts. */
export async function checkCommand(opts: FixOpts): Promise<void> {
  const cwd = path.resolve(opts.cwd ?? process.cwd());
  let scan: Scan;
  try {
    ({ scan } = await runScan({ against: opts.against, staged: opts.staged, cwd, llm: opts.llm ?? false, wholeRepo: opts.wholeRepo }));
  } catch (err) {
    fail(errMessage(err));
  }
  const failing = fixable(scan.hunks, opts.all);
  if (opts.json) {
    console.log(JSON.stringify({ ok: failing.length === 0, hunks: scan.hunks }, null, 2));
  } else {
    console.log(`skrub check  in ${scopeOf(scan.summary)}${wider(scopeOf(scan.summary))}: ${headline(scan.hunks)}`);
    for (const line of findingLines(scan.hunks)) console.log(`  ${line}`);
  }
  if (failing.length > 0) process.exitCode = 1;
}
