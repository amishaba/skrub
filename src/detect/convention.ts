import { type Hunk, slug } from "../hunk.ts";
import { type DiffScope, addsLines, wasMoved } from "../git/diff.ts";
import { sliceLines } from "../lib/lines.ts";
import { type Rules, violations } from "../conventions/conventions.ts";
import type { Program } from "../program/program.ts";

/** New code that breaks a recorded convention. A note to read, never a deletion. */
export function conventionHunks(program: Program, rules: Rules, diff: DiffScope): Hunk[] {
  const isNewFile = (rel: string) => diff.added.get(rel) === "all";
  // Moved or reformatted code was already there; the repo accepted it once.
  const isAdded = (rel: string, line: number, text?: string) => addsLines(diff, rel, line) && !(text && wasMoved(diff, text));
  const texts = new Map(program.files.map(({ sf, rel }) => [rel, sf.getFullText()]));
  return violations(program, rules, isNewFile, isAdded).map((v) => ({
    id: slug(["convention", v.key, v.file, String(v.line)]),
    file: v.file,
    startLine: v.line,
    endLine: v.line,
    kind: "convention",
    confidence: 0.6,
    reason: `${v.message.charAt(0).toUpperCase()}${v.message.slice(1)}`,
    text: sliceLines(texts.get(v.file) ?? "", v.line, v.line),
    safe: false,
    action: "comment",
  }));
}
