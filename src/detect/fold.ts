import { type DiffScope, wasMoved } from "../git/diff.ts";
import type { Hunk } from "../hunk.ts";
import { lastLine, sliceLines } from "../lib/lines.ts";
import { isEntry, type Program } from "../program/program.ts";
import { importers } from "../program/usage.ts";
import { slug } from "../hunk.ts";

/** Small enough that a file of its own is ceremony, not organisation. */
const SMALL = 30;

/**
 * A small file the diff added whose exports one other file uses: an
 * abstraction that hasn't earned its place yet. It belongs in that file until
 * a second caller needs it. A note; moving code is a judgment call.
 */
export function foldHunks(program: Program, diff: DiffScope | null): Hunk[] {
  if (!diff) return [];
  // A file that only lends its types still has every file that imports them.
  const used = importers(program, { types: true });
  const hunks: Hunk[] = [];
  for (const { sf, rel } of program.files) {
    if (diff.added.get(rel) !== "all" || isEntry(rel, program.entries)) continue;
    const text = sf.getFullText();
    const end = lastLine(text);
    if (end > SMALL || wasMoved(diff, text)) continue;
    const names = [...sf.getExportedDeclarations().keys()];
    if (!names.length) continue;
    const callers = new Set<string>();
    for (const name of names) for (const f of used.get(`${rel}#${name}`) ?? []) callers.add(f);
    if (callers.size !== 1) continue;
    const [caller] = callers;
    hunks.push({
      id: slug(["fold", rel]),
      file: rel,
      startLine: 1,
      endLine: end,
      kind: "fold",
      confidence: 0.45,
      reason: `Only ${caller} uses this file. Keep it in ${caller} until a second file needs it.`,
      text: sliceLines(text, 1, end),
      safe: false,
      action: "comment",
    });
  }
  return hunks;
}
