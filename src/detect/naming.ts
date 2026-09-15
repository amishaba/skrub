import path from "node:path";
import { Node } from "ts-morph";
import { type Hunk, slug } from "../hunk.ts";
import { sliceLines } from "../lib/lines.ts";
import { nodeHunk } from "./node-hunk.ts";
import { isEntry, type Program } from "../program/program.ts";

/** Placeholder names that usually mean the author didn't name the thing. */
const WEAK = /^(data|temp|tmp|foo|bar|baz|util|utils|helper|helpers|info|stuff|thing|val|value|obj|arr|item|handler|result|resp|response|output|input)\d*$/i;

/** File names that say where code was put, not what it is. */
const VAGUE_FILE = /^(utils?|helpers?|common|misc|stuff|shared|functions|tools)$/i;

export function namingHunks(program: Program): Hunk[] {
  const hunks: Hunk[] = [];
  for (const { sf, rel } of program.files) {
    if (isEntry(rel, program.entries)) continue;
    const text = sf.getFullText();
    const stem = path.basename(rel).replace(/\.[^.]+$/, "");
    if (VAGUE_FILE.test(stem) && sf.getExportedDeclarations().size > 0)
      hunks.push({
        id: slug(["naming-file", rel]),
        file: rel,
        startLine: 1,
        endLine: 1,
        kind: "naming",
        confidence: 0.5,
        reason: `A file called ${path.basename(rel)} doesn't say what's in it. Name it for what it holds (money.ts, dates.ts) so the next search finds it.`,
        text: sliceLines(text, 1, 1),
        safe: false,
        action: "comment",
      });
    for (const [name, decls] of sf.getExportedDeclarations()) {
      if (!WEAK.test(name) || name === "default") continue;
      const decl = decls.find((d) => !Node.isSourceFile(d));
      if (!decl) continue;
      hunks.push(
        nodeHunk({
          sf,
          rel,
          node: decl,
          text,
          kind: "naming",
          confidence: 0.55,
          reason: `Exported name '${name}' doesn't say what this is.`,
          safe: false,
          action: "comment",
        }),
      );
    }
  }
  return hunks;
}
