import { SyntaxKind, type SourceFile } from "ts-morph";
import { type Hunk, slug } from "../hunk.ts";
import { sliceLines } from "../lib/lines.ts";
import type { Program } from "../program/program.ts";

const NARRATION = /^(let's |i'll |i will |now we |this function |this code )/i;
const TODO = /^\s*(?:\/\/|\/\*)\s*todo:?\s*implement\b/i;
const IDENT = /(?:export\s+)?(?:async\s+)?(?:function|class|const|let|var|type|interface|enum)\s+([A-Za-z_$][\w$]*)/;

export function claudeismHunks(program: Program): Hunk[] {
  const hunks: Hunk[] = [];
  for (const { sf, rel } of program.files) {
    const text = sf.getFullText();
    const lines = text.split("\n");
    const quoted = linesInsideStrings(sf);
    for (let i = 0; i < lines.length; i++) {
      if (quoted.has(i + 1)) continue;
      const raw = lines[i]!;
      const comment = commentText(raw);
      if (comment == null) continue;
      const next = codeAfter(lines, i + 1, 1) || null;
      let reason: string | null = null;
      let safe = true;
      if (NARRATION.test(comment)) reason = "Narrating comment. The code already says this.";
      else if (restatesName(comment, next)) reason = "Comment restates the next identifier.";
      else if (isLoneComment(lines, i) && paraphrases(comment, codeAfter(lines, i + 1, 3))) {
        reason = "Comment says what the next lines already say.";
      }
      else if (TODO.test(raw) && next && !/not implemented|throw new Error/.test(next)) {
        reason = "TODO: implement, but the body is already there.";
        // The body may not do what the TODO asks yet; whether it's done is a reader's call.
        safe = false;
      }
      if (!reason) continue;
      const startLine = i + 1;
      hunks.push({
        id: slug(["claudeism", rel, String(startLine)]),
        file: rel,
        startLine,
        endLine: startLine,
        kind: "claudeism",
        confidence: 0.9,
        reason,
        text: sliceLines(text, startLine, startLine),
        safe,
        action: "delete",
      });
    }
  }
  return hunks;
}

/** Lines that continue a string or template literal: a `//` there is text, not a comment. */
function linesInsideStrings(sf: SourceFile): Set<number> {
  const out = new Set<number>();
  for (const kind of [SyntaxKind.NoSubstitutionTemplateLiteral, SyntaxKind.TemplateExpression, SyntaxKind.StringLiteral]) {
    for (const node of sf.getDescendantsOfKind(kind)) {
      const start = sf.getLineAndColumnAtPos(node.getStart()).line;
      const end = sf.getLineAndColumnAtPos(node.getEnd()).line;
      for (let line = start + 1; line <= end; line++) out.add(line);
    }
  }
  return out;
}

function commentText(line: string): string | null {
  const t = line.trim();
  if (t.startsWith("//")) return t.slice(2).trim();
  if (t.startsWith("*") && !t.startsWith("*/")) return t.replace(/^\*\s?/, "").trim();
  if (t.startsWith("/*")) return t.replace(/^\/\*+\s?/, "").replace(/\*\/$/, "").trim();
  return null;
}

function isCommentLine(trimmed: string): boolean {
  return trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*");
}

/** The next `n` lines of code after `from`, skipping blanks and comments, joined. */
function codeAfter(lines: string[], from: number, n: number): string {
  const out: string[] = [];
  for (let i = from; i < lines.length && out.length < n; i++) {
    const t = lines[i]!.trim();
    if (!t || isCommentLine(t)) continue;
    out.push(t);
  }
  return out.join("\n");
}

function restatesName(comment: string, next: string | null): boolean {
  if (!next) return false;
  const m = next.match(IDENT);
  if (!m) return false;
  const name = m[1]!.toLowerCase();
  const words = comment.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  if (words === name) return true;
  const compact = words.replace(/\s+/g, "");
  return compact === name;
}

const STOP = new Set(
  "a an the this that these those it its of to in into on for from with by and or as at be is are was were then than via each every all any new our we".split(" "),
);
// Words that carry intent the code can't: a reason, a constraint, a warning.
const KEEPS = /\b(because|since|why|so that|otherwise|instead|unless|until|only|must|never|always|assume|careful|important|note|warning|hack|workaround|fixme|todo|xxx|see|e\.g|i\.e)\b|https?:|@|`|eslint|ts-|prettier|biome|istanbul/i;

/** A single `//` line, not part of a block of comments, and not trailing code. */
function isLoneComment(lines: string[], i: number): boolean {
  const isLine = (j: number) => lines[j]?.trim().startsWith("//") ?? false;
  return isLine(i) && !isLine(i - 1) && !isLine(i + 1);
}

/**
 * Most of the comment's words are already identifiers in the next few lines:
 * "write the csv file next to the report" over `writeFile(csvFileName(report), …)`.
 */
function paraphrases(comment: string, code: string): boolean {
  if (KEEPS.test(comment)) return false;
  const words = comment
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 1 && !STOP.has(w))
    .map(stem);
  if (words.length < 2 || words.length > 10) return false;
  const idents = new Set(
    (code.match(/[A-Za-z][A-Za-z0-9]*/g) ?? [])
      .flatMap((t) => t.split(/(?<=[a-z0-9])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])/))
      .map((w) => stem(w.toLowerCase())),
  );
  const hits = words.filter((w) => idents.has(w)).length;
  return hits >= 2 && hits / words.length >= 0.6;
}

function stem(w: string): string {
  return w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w;
}
