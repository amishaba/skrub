import type { Config } from "../config.ts";
import type { Hunk } from "../hunk.ts";
import type { DiffScope } from "../git/diff.ts";
import { detect } from "../detect/detect.ts";
import { reviewWithLlm } from "../llm/review.ts";
import { geminiKey } from "../llm/gemini.ts";
import { dedupeHunks, rankHunks } from "./rank.ts";
import { inDiff, inScope } from "./scope.ts";

interface AnalyzeOpts {
  /** Files in scope (a git diff), or null for the whole project. */
  changed: string[] | null;
  /** Line-level diff: when given, a hunk must touch an added line, or be something the diff orphaned. */
  diff?: DiffScope | null;
  llm: boolean;
}

export interface Analysis {
  hunks: Hunk[];
  /** Model that ran the second pass, "error" if it failed, null if it didn't run. */
  model: string | null;
}

/**
 * The scan itself, with no git, no disk writes, and no exit: detectors, then the
 * optional LLM pass, then scope, dedupe, and rank. Everything that shows a number
 * — the TUI, the web page, the PR comment, the demo fixture — comes from here.
 */
export async function analyze(cwd: string, config: Config, opts: AnalyzeOpts): Promise<Analysis> {
  const scope = (hs: Hunk[]) => (opts.diff ? inDiff(hs, opts.diff) : inScope(hs, opts.changed));
  let hunks = scope(await detect(cwd, config, { changed: opts.changed, diff: opts.diff ?? null }));

  let model: string | null = null;
  try {
    const reviewed = await reviewWithLlm(cwd, hunks, opts.changed ?? hunks.map((h) => h.file), opts.llm);
    hunks = scope(reviewed.hunks);
    model = reviewed.model;
  } catch {
    model = opts.llm && geminiKey() ? "error" : null;
  }

  return { hunks: rankHunks(dedupeHunks(hunks), config.maxHunks), model };
}
