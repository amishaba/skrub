import type { Node, SourceFile } from "ts-morph";
import { type Hunk, slug } from "../hunk.ts";
import { sliceLines } from "../lib/lines.ts";

export function nodeHunk(opts: {
  sf: SourceFile;
  rel: string;
  node: Node;
  text: string;
  kind: Hunk["kind"];
  confidence: number;
  reason: string;
  safe: boolean;
  action: Hunk["action"];
  symbols?: string[];
}): Hunk {
  const start = opts.sf.getLineAndColumnAtPos(opts.node.getStart(true)).line;
  const end = opts.sf.getLineAndColumnAtPos(opts.node.getEnd()).line;
  return {
    id: slug([opts.kind, opts.rel, String(start)]),
    file: opts.rel,
    startLine: start,
    endLine: end,
    kind: opts.kind,
    confidence: opts.confidence,
    reason: opts.reason,
    text: sliceLines(opts.text, start, end),
    safe: opts.safe,
    action: opts.action,
    ...(opts.symbols ? { symbols: opts.symbols } : {}),
  };
}
