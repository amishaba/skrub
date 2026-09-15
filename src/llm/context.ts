import { promises as fs } from "node:fs";
import path from "node:path";
import type { Hunk } from "../hunk.ts";

/** The source files a prompt shows the model, clipped so a big repo stays under budget. */
export async function readFileBlocks(cwd: string, files: string[]): Promise<string[]> {
  const blocks: string[] = [];
  for (const rel of files.filter((f) => /\.[cm]?[jt]sx?$/.test(f)).slice(0, 12)) {
    try {
      const text = await fs.readFile(path.join(cwd, rel), "utf8");
      const clipped = text.length > 6000 ? text.slice(0, 6000) + "\n/* truncated */" : text;
      blocks.push(`FILE ${rel}\n${clipped}`);
    } catch {
      // deleted in the working tree
    }
  }
  return blocks;
}

/** A hunk as the model sees it: where, what, why, and its text, clipped. */
export function candidate(h: Hunk) {
  return {
    id: h.id,
    file: h.file,
    startLine: h.startLine,
    endLine: h.endLine,
    kind: h.kind,
    reason: h.reason,
    text: h.text.length > 1200 ? h.text.slice(0, 1200) + "\n/* truncated */" : h.text,
  };
}
