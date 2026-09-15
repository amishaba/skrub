import { createTwoFilesPatch } from "diff";
import { promises as fs } from "node:fs";
import path from "node:path";
import { type Hunk, groupByFile, isApplicable } from "../hunk.ts";
import { errMessage } from "../lib/errors.ts";
import { gitApplyCheck, isGitRepo } from "../git/git.ts";
import { offsetAt, sliceLines } from "../lib/lines.ts";

/**
 * The patch for the applicable hunks, checked against the working tree with
 * `git apply --check` when in a repo, so a file that moved on is refused
 * before anything is written.
 */
export async function checkedPatch(cwd: string, hunks: Hunk[]): Promise<string> {
  let patch: string;
  try {
    patch = await buildPatch(cwd, hunks.filter(isApplicable));
  } catch (err) {
    throw new Error(`could not build patch: ${errMessage(err)}`, { cause: err });
  }
  if (patch && (await isGitRepo(cwd))) {
    const check = await gitApplyCheck(cwd, patch);
    if (!check.ok) throw new Error(`git apply --check failed:\n${check.error}`);
  }
  return patch;
}

export async function buildPatch(root: string, hunks: Hunk[]): Promise<string> {
  const byFile = groupByFile(hunks);
  const parts: string[] = [];
  for (const file of [...byFile.keys()].sort()) {
    const fileHunks = byFile.get(file)!;
    const abs = path.join(root, file);
    const original = await fs.readFile(abs, "utf8");
    const next = applyHunksToText(original, fileHunks);
    if (next === original) continue;
    if (fileHunks.some((h) => h.kind === "unused_file")) {
      parts.push(deletedFilePatch(file, original));
      continue;
    }
    parts.push(unifiedPatch(file, original, next));
  }
  return parts.join("");
}

export function applyHunksToText(original: string, hunks: Hunk[]): string {
  const sorted = [...hunks].sort((a, b) => b.startLine - a.startLine);
  let text = original;
  for (const h of sorted) {
    const slice = sliceLines(text, h.startLine, h.endLine);
    if (norm(slice) !== norm(h.text)) {
      throw new Error(`hunk ${h.id} does not match ${h.file}:${h.startLine}-${h.endLine}`);
    }
    const start = offsetAt(text, h.startLine);
    const end = offsetAt(text, h.endLine + 1);
    text = text.slice(0, start) + (h.replacement ?? "") + text.slice(end);
  }
  return text;
}

function unifiedPatch(file: string, oldText: string, newText: string): string {
  const body = createTwoFilesPatch(
    `a/${file}`,
    `b/${file}`,
    oldText,
    newText,
    undefined,
    undefined,
    { context: 3 },
  );
  const stripped = body.replace(/^Index:.*\n=+\n/, "");
  return `diff --git a/${file} b/${file}\n${stripped}`;
}

function deletedFilePatch(file: string, oldText: string): string {
  const lines = oldText.split("\n");
  const hasNl = oldText.endsWith("\n");
  const contentLines = hasNl ? lines.slice(0, -1) : lines;
  const n = contentLines.length || 1;
  const body = contentLines.map((l) => `-${l}`).join("\n");
  const missingNl = hasNl ? "" : "\n\\ No newline at end of file\n";
  return (
    `diff --git a/${file} b/${file}\n` +
    `deleted file mode 100644\n` +
    `--- a/${file}\n` +
    `+++ /dev/null\n` +
    `@@ -1,${n} +0,0 @@\n` +
    `${body}${missingNl}\n`
  );
}

function norm(s: string): string {
  return s.replace(/\r\n/g, "\n");
}
