import { type Hunk, groupByFile, removesLines } from "../hunk.ts";

export function rankHunks(hunks: Hunk[], max: number): Hunk[] {
  const scored = [...hunks].sort((a, b) => {
    if (a.safe !== b.safe) return a.safe ? -1 : 1;
    if (b.confidence !== a.confidence) return b.confidence - a.confidence;
    const aLines = a.endLine - a.startLine + 1;
    const bLines = b.endLine - b.startLine + 1;
    if (bLines !== aLines) return bLines - aLines;
    return a.file.localeCompare(b.file) || a.startLine - b.startLine;
  });
  return scored.slice(0, max);
}

/**
 * unused_file swallows other hunks in the same file. Deletions can't overlap,
 * so overlapping ones keep the larger. Notes delete nothing, so they never
 * crowd each other out, but a note on lines being deleted anyway is moot.
 */
export function dedupeHunks(hunks: Hunk[]): Hunk[] {
  const files = new Set(hunks.filter((h) => h.kind === "unused_file").map((h) => h.file));
  const live = hunks.filter((h) => h.kind === "unused_file" || !files.has(h.file));
  const notes = [...new Map(live.filter((h) => h.action === "comment").map((h) => [h.id, h])).values()];
  const kept = live.filter((h) => h.action !== "comment");
  const byFile = groupByFile(kept);
  const out: Hunk[] = [];
  for (const list of byFile.values()) {
    const sorted = [...list].sort((a, b) => a.startLine - b.startLine || b.endLine - a.endLine);
    const accepted: Hunk[] = [];
    for (const h of sorted) {
      const overlaps = accepted.some((x) => !(h.endLine < x.startLine || h.startLine > x.endLine));
      if (!overlaps) accepted.push(h);
    }
    out.push(...accepted);
  }
  // Moot only when its lines go away; dropping an `export` keyword leaves the code the note is about.
  const moot = (n: Hunk) => out.some((d) => removesLines(d) && d.file === n.file && n.startLine <= d.endLine && n.endLine >= d.startLine);
  return [...out, ...notes.filter((n) => !moot(n))];
}
