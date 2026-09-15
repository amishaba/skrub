import path from "node:path";
import { errMessage } from "../lib/errors.ts";
import { diffScope } from "../git/diff.ts";
import { isDirty, isGitRepo, refExists } from "../git/git.ts";
import { emptyScope, loadConfig } from "../config.ts";
import { checkedPatch } from "../patch/patch.ts";
import { newScanId, writeScan } from "../store/scans.ts";
import { type Scan, scanSummary } from "./summary.ts";
import { type Analysis, analyze } from "./analyze.ts";

interface RunScanOpts {
  against?: string;
  staged?: boolean;
  cwd?: string;
  llm?: boolean;
  /** If set, skip the dirty→HEAD default (PR comment always diffs against base). */
  requireAgainst?: boolean;
  /** Every finding, not just the top `maxHunks`: for `fix`, which deletes them all. */
  uncapped?: boolean;
}

/**
 * A scan as the CLI runs it: pick the diff (a dirty tree means "against HEAD"),
 * analyze, check the patch applies, and save it under .skrub/. Throws with a
 * message fit to print.
 */
export async function runScan(opts: RunScanOpts): Promise<{ scan: Scan; dir: string; patch: string }> {
  const cwd = path.resolve(opts.cwd ?? process.cwd());
  const empty = await emptyScope(cwd);
  if (empty) throw new Error(empty);
  const loaded = await loadConfig(cwd);
  const config = opts.uncapped ? { ...loaded, maxHunks: Infinity } : loaded;

  let against = opts.against;
  // A repo with no commits yet has no HEAD to diff against: everything in it is new, so scan it all.
  if (!opts.requireAgainst && !opts.staged && against == null && (await isGitRepo(cwd)) && (await isDirty(cwd)) && (await refExists("HEAD", cwd))) {
    against = "HEAD";
  }
  if (against && !(await refExists(against, cwd))) {
    throw new Error(`git ref not found: ${against}`);
  }

  const diff = await diffScope(cwd, against, opts.staged);

  let analysis: Analysis;
  try {
    analysis = await analyze(cwd, config, { changed: diff?.files ?? null, diff, llm: opts.llm !== false });
  } catch (err) {
    throw new Error(`scan failed: ${errMessage(err)}`, { cause: err });
  }
  const { hunks } = analysis;

  const id = newScanId();
  const summary = scanSummary(id, cwd, against ?? null, !!opts.staged, hunks, analysis.model);
  const scan: Scan = { summary, hunks };

  const patch = await checkedPatch(cwd, hunks);

  const dir = await writeScan(cwd, scan, patch);
  return { scan, dir, patch };
}
