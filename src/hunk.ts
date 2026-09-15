export type HunkKind =
  | "unused_export"
  | "unused_file"
  | "unused_import"
  | "glue"
  | "claudeism"
  | "dup"
  | "naming"
  | "pattern"
  | "convention"
  | "needless_export"
  | "reuse"
  | "fold";

export type Decision = "accept" | "skip";
type HunkAction = "delete" | "comment";

export interface Hunk {
  id: string;
  file: string;
  startLine: number;
  endLine: number;
  kind: HunkKind;
  confidence: number;
  reason: string;
  text: string;
  safe: boolean;
  action: HunkAction;
  /** Names this hunk declares (export, import, file stem). If a diff removed a mention of one, the diff orphaned it. */
  symbols?: string[];
  /** Applying the hunk writes this over its lines instead of deleting them (an edit, not a deletion). */
  replacement?: string;
}

/** A hunk you can apply: a deletion, or an edit with a replacement. Notes are only read. */
export function isApplicable(h: Hunk): boolean {
  return h.action !== "comment";
}

/** Applying it removes lines (as opposed to rewriting them, or being a note). */
export function removesLines(h: Hunk): boolean {
  return h.action !== "comment" && h.replacement == null;
}

export type Decisions = Record<string, Decision>;

/** Safe deletions only, unless `all`: the heuristics need a reader, so they wait for one. */
export function fixable(hunks: Hunk[], all = false): Hunk[] {
  return hunks.filter((h) => isApplicable(h) && (all || h.safe));
}

export function groupByFile(hunks: Hunk[]): Map<string, Hunk[]> {
  const byFile = new Map<string, Hunk[]>();
  for (const h of hunks) {
    const list = byFile.get(h.file) ?? [];
    list.push(h);
    byFile.set(h.file, list);
  }
  return byFile;
}

/** Lines a set of hunks removes; an edit rewrites its line, so it removes none. */
export function lineCount(hunks: Hunk[]): number {
  return hunks.reduce((n, h) => n + (h.replacement == null ? h.endLine - h.startLine + 1 : 0), 0);
}

/** About four characters per token for code; close enough to say what the lines cost a prompt. An edit saves only what it cuts. */
export function tokenCount(hunks: Hunk[]): number {
  return Math.round(hunks.reduce((n, h) => n + h.text.length - (h.replacement?.length ?? 0), 0) / 4);
}

/** A hunk id: stable across runs, so decisions and PR notes line up with the same finding. */
export function slug(parts: string[]): string {
  const s = parts
    .join("-")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return s.slice(0, 80) || "hunk";
}
