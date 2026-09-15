import path from "node:path";
import { promises as fs } from "node:fs";
import { type Hunk, groupByFile, isApplicable } from "../hunk.ts";
import { gitApply, isGitRepo } from "../git/git.ts";
import { applyHunksToText, checkedPatch } from "./patch.ts";
import { latestScanId, readDecisions, readScan } from "../store/scans.ts";
import { runHint } from "../agent/self.ts";

/** Apply the hunks marked "accept" in a saved scan (the latest, unless `id`). */
export async function applyAccepted(
  cwd: string,
  id?: string,
): Promise<{ id: string; applied: number }> {
  const resolved = id ?? (await latestScanId(cwd));
  if (!resolved) throw new Error(`no scan to apply — run ${runHint()} first`);

  const scan = await readScan(cwd, resolved);
  const decisions = await readDecisions(cwd, resolved);
  const accepted = scan.hunks.filter((h) => decisions[h.id] === "accept" && isApplicable(h));
  await applyHunks(cwd, accepted);
  return { id: resolved, applied: accepted.length };
}

/** Delete exactly these hunks: through `git apply` when in a repo, so git refuses if a file moved on. */
export async function applyHunks(cwd: string, hunks: Hunk[]): Promise<void> {
  const accepted = hunks.filter(isApplicable);
  if (accepted.length === 0) return;

  const patch = await checkedPatch(cwd, accepted);
  if (await isGitRepo(cwd)) {
    if (patch) await gitApply(cwd, patch);
  } else {
    await applyInProcess(cwd, accepted);
  }
}

async function applyInProcess(cwd: string, hunks: Hunk[]): Promise<void> {
  const byFile = groupByFile(hunks);
  for (const [file, fileHunks] of byFile) {
    const abs = path.join(cwd, file);
    if (fileHunks.some((h) => h.kind === "unused_file")) {
      await fs.unlink(abs);
      continue;
    }
    const original = await fs.readFile(abs, "utf8");
    const next = applyHunksToText(original, fileHunks);
    await fs.writeFile(abs, next, "utf8");
  }
}
