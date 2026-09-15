import { type Hunk, type HunkKind, isApplicable, removesLines, lineCount, tokenCount } from "../hunk.ts";
import type { Scan } from "../scan/summary.ts";

/**
 * Everything a reader sees about a scan: the one-line headline, the PR
 * summary, and the inline note. The terminal, the PR comment, and the demo
 * page all render from here so their numbers cannot disagree.
 */

interface ReportMeta {
  /** Base and head of the diff, shortened for display. */
  base?: string | null;
  head?: string | null;
  /** Inline notes that landed on the PR, how many were attempted, and how many GitHub refused (outside the diff). */
  posted?: number;
  total?: number;
  skipped?: number;
}

/**
 * "13 deletions · 53 lines · ~330 tokens · 2 exports to drop · 1 naming note", or
 * "nothing to delete". Any set of hunks, so every surface words it the same way.
 */
export function headline(hunks: Hunk[]): string {
  const deletions = hunks.filter(removesLines);
  const edits = hunks.filter((h) => isApplicable(h) && !removesLines(h));
  const notes = hunks.filter((h) => !isApplicable(h));
  if (hunks.length === 0) return "nothing to delete";
  const parts: string[] = [];
  if (deletions.length > 0) {
    parts.push(
      plural(deletions.length, "deletion"),
      plural(lineCount(deletions), "line"),
      `~${plural(tokenCount(deletions), "token")}`,
    );
  }
  if (edits.length > 0) parts.push(`${plural(edits.length, "export")} to drop`);
  if (notes.length > 0) {
    const allNaming = notes.every((h) => h.kind === "naming");
    parts.push(plural(notes.length, allNaming ? "naming note" : "note"));
  }
  return parts.join(" · ");
}

interface KindRow {
  kind: HunkKind;
  hunks: number;
  lines: number;
  safe: number;
  /** Comment-only kinds (naming, pattern) are read, never deleted. */
  deletable: boolean;
}

/** One row per kind, most lines first; ties by hunk count, then name. */
export function kindRows(hunks: Hunk[]): KindRow[] {
  const byKind = new Map<HunkKind, KindRow>();
  for (const h of hunks) {
    const row = byKind.get(h.kind) ?? { kind: h.kind, hunks: 0, lines: 0, safe: 0, deletable: isApplicable(h) };
    row.hunks += 1;
    row.lines += lineCount([h]);
    if (h.safe) row.safe += 1;
    byKind.set(h.kind, row);
  }
  return [...byKind.values()].sort(
    (a, b) => b.lines - a.lines || b.hunks - a.hunks || a.kind.localeCompare(b.kind),
  );
}

/** The single summary comment skrub keeps on a PR. First line is the headline. */
export function summaryMarkdown(scan: Scan, meta: ReportMeta = {}): string {
  const out = [`## ${headline(scan.hunks)}`, "", metaLine(scan, meta)];
  if (scan.hunks.length === 0) return out.join("\n");

  out.push("", "| kind | hunks | lines | safe |", "| --- | ---: | ---: | ---: |");
  for (const r of kindRows(scan.hunks)) {
    const kind = r.deletable ? `\`${r.kind}\`` : `\`${r.kind}\` (comment)`;
    out.push(`| ${kind} | ${r.hunks} | ${r.lines} | ${r.safe}/${r.hunks} |`);
  }
  out.push(
    "",
    "<sub>safe = deleting it can't break the build: the compiler found no references to the export, file, or import, or it is only a comment. " +
      "the rest are heuristics; read before you click. " +
      "a suggestion deletes exactly those lines (or drops one `export`), and nothing is applied until you accept it.</sub>",
  );
  return out.join("\n");
}

function metaLine(scan: Scan, meta: ReportMeta): string {
  const parts: string[] = [];
  const base = short(meta.base ?? scan.summary.against);
  const head = short(meta.head);
  if (base && head) parts.push(`${base} → ${head}`);
  else if (base) parts.push(`against ${base}`);
  const files = new Set(scan.hunks.map((h) => h.file)).size;
  if (files > 0) parts.push(plural(files, "file"));
  parts.push(scan.summary.llm ? `llm ${scan.summary.llm}` : "mechanical");
  if (meta.posted != null && meta.total != null && meta.total > 0) {
    const skipped = meta.skipped ?? 0;
    let inline = meta.posted === meta.total ? `${meta.posted} inline` : `${meta.posted} of ${meta.total} inline`;
    if (skipped > 0) inline += `, ${skipped} outside the diff`;
    parts.push(inline);
  }
  return parts.join(" · ");
}

/**
 * The inline note on one hunk. Safe delete hunks carry an empty GitHub
 * suggestion over exactly their line range, so one click removes those lines.
 * Whole files get no suggestion: you delete the file, not blank its body. A
 * judgment call gets none either: deleting a wrapper or a copy means updating
 * its callers, which one click can't do.
 */
export function noteMarkdown(h: Hunk, explanation?: string): string {
  const body = [`**skrub** · \`${h.kind}\`${h.safe ? " · safe" : ""}`, "", h.reason];
  if (suggestsDeletion(h)) {
    if (explanation) body.push("", explanation);
    // an empty suggestion deletes the lines; an edit's suggestion is its new line
    body.push("", "```suggestion", ...(h.replacement ? [h.replacement.replace(/\n$/, "")] : []), "```");
  }
  return body.join("\n");
}

/**
 * One line per finding, for an agent or a log: where, what, why. Safe ones
 * first, as ranked; `safe` is spelled out so a reader knows what to trust.
 */
export function findingLines(hunks: Hunk[]): string[] {
  return hunks.map((h) => {
    const where = h.startLine === h.endLine ? `${h.file}:${h.startLine}` : `${h.file}:${h.startLine}-${h.endLine}`;
    const tag = h.kind === "unused_file" ? "unused_file (delete the file)" : h.kind;
    return `${where}  ${tag}${h.safe ? " · safe" : ""}  ${h.reason}`;
  });
}

/** What a scan looked at, as the terminal says it: "your uncommitted changes", "the whole repo". */
export function scopeOf(summary: { against: string | null; staged: boolean }): string {
  if (summary.staged) return "the staged changes";
  if (summary.against === "HEAD") return "your uncommitted changes";
  if (summary.against) return `the changes since ${short(summary.against)}`;
  return "the whole repo";
}

export function suggestsDeletion(h: Hunk): boolean {
  return h.safe && h.startLine >= 1 && isApplicable(h) && h.kind !== "unused_file";
}

function short(sha: string | null | undefined): string | null {
  if (!sha) return null;
  return /^[0-9a-f]{40}$/i.test(sha) ? sha.slice(0, 7) : sha;
}

function plural(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}
