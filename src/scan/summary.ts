import type { Hunk, HunkKind } from "../hunk.ts";
import { lineCount, removesLines, tokenCount } from "../hunk.ts";

export interface ScanSummary {
  id: string;
  createdAt: string;
  cwd: string;
  against: string | null;
  staged: boolean;
  hunks: number;
  /** Lines the deletions remove: the same number the headline shows. Notes delete nothing. */
  lines: number;
  /** Rough token count of the deletable lines (characters / 4): what they cost every prompt that reads them. */
  tokens: number;
  byKind: Partial<Record<HunkKind, number>>;
  llm: string | null;
}

export interface Scan {
  summary: ScanSummary;
  hunks: Hunk[];
}

export function scanSummary(
  id: string,
  cwd: string,
  against: string | null,
  staged: boolean,
  hunks: Hunk[],
  llm: string | null,
  createdAt: string = new Date().toISOString(),
): ScanSummary {
  const byKind: ScanSummary["byKind"] = {};
  for (const h of hunks) {
    byKind[h.kind] = (byKind[h.kind] ?? 0) + 1;
  }
  return {
    id,
    createdAt,
    cwd,
    against,
    staged,
    hunks: hunks.length,
    lines: lineCount(hunks.filter(removesLines)),
    tokens: tokenCount(hunks.filter(removesLines)),
    byKind,
    llm,
  };
}
