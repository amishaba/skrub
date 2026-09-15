import { createHash } from "node:crypto";
import path from "node:path";
import { fixable, type Hunk } from "../hunk.ts";
import { isDirty, isGitRepo, refExists } from "../git/git.ts";
import { diffScope } from "../git/diff.ts";
import { loadConfig } from "../config.ts";
import { analyze } from "../scan/analyze.ts";
import { findingLines, headline } from "../report/report.ts";
import { SKRUB_DIR } from "../store/scans.ts";
import { exists, readJson, writeJson } from "../lib/fs.ts";
import { selfCommand } from "./self.ts";
import { CONVENTIONS_FILE } from "../conventions/conventions.ts";
import { productUnfilled } from "../product/product.ts";
import { promises as fs } from "node:fs";

/**
 * What a Claude Code Stop hook should tell the agent, or null to let it stop.
 * Scans only what it changed since the last commit (untracked files
 * included). If it left code to clean up, the answer is the list; the same
 * findings are only raised once per session, so an agent that disagrees is
 * not stuck in a loop.
 */
export async function stopHookReason(cwd: string, session: string): Promise<string | null> {
  if (!(await isGitRepo(cwd)) || !(await isDirty(cwd))) return null;
  // Before the first commit, everything is the agent's change.
  const diff = (await refExists("HEAD", cwd)) ? await diffScope(cwd, "HEAD") : null;
  if (diff && diff.files.length === 0) return null;
  const { hunks } = await analyze(cwd, await loadConfig(cwd), { changed: diff?.files ?? null, diff, llm: false });
  const deletions = fixable(hunks, true);
  const conventions = hunks.filter((h) => h.kind === "convention");
  const reuse = hunks.filter((h) => h.kind === "reuse");
  const folds = hunks.filter((h) => h.kind === "fold");
  const raised = [...deletions, ...conventions, ...reuse, ...folds];
  const unfilled = productUnfilled(await fs.readFile(path.join(cwd, CONVENTIONS_FILE), "utf8").catch(() => ""));
  if (raised.length === 0 && !unfilled) return null;

  const fingerprint = createHash("sha1")
    .update([...raised.map((h) => `${h.id}:${h.text}`).sort(), unfilled ? "product-unfilled" : ""].join("\n"))
    .digest("hex");
  if (!(await recordOnce(cwd, "hook.json", session, fingerprint))) return null;
  const message = stopMessage(deletions, conventions, reuse, folds, selfCommand());
  if (!unfilled) return message;
  const product =
    `skrub: ${CONVENTIONS_FILE} doesn't say yet who this product is for. Fill in each "(to fill in)" under "## product" ` +
    "from the README, routes and UI (who uses it, the space and the products to model on, what to copy from them), then tell the user in one line so they can correct it.";
  return raised.length ? `${product}\n\n${message}` : `${product}\nThen finish; skrub won't raise this again this session.`;
}

/**
 * What the agent reads when skrub blocks its stop: the leftovers, the broken
 * conventions, what it rewrote instead of reusing, then small files to fold.
 * At most MAX_LINES findings in all, shared in that order.
 */
function stopMessage(deletions: Hunk[], conventions: Hunk[], reuse: Hunk[], folds: Hunk[], cmd: string): string {
  const lines: string[] = [];
  let budget = MAX_LINES;
  const capped = (found: string[]): string[] => {
    const shown = found.slice(0, Math.max(budget, 1));
    budget -= shown.length;
    const rest = found.length - shown.length;
    return rest > 0 ? [...shown, `…and ${rest} more (\`${cmd} check\` lists them all).`] : shown;
  };
  if (deletions.length > 0) {
    const safe = deletions.filter((h) => h.safe).length;
    lines.push(
      `skrub: this change leaves ${headline(deletions)} that every later prompt pays for.`,
      ...capped(findingLines(deletions)),
      safe === deletions.length
        ? `\`${cmd} fix\` deletes all of them; then typechecks and puts back anything that breaks.`
        : safe > 0
          ? `\`${cmd} fix\` deletes the ${safe} marked safe. The rest are heuristics: delete them, or keep one and say in a line why.`
          : "These are heuristics: delete them, or keep one and say in a line why.",
    );
  }
  if (conventions.length > 0) {
    if (lines.length > 0) lines.push("");
    lines.push(
      `skrub: ${conventions.length} ${conventions.length === 1 ? "place breaks" : "places break"} this repo's conventions.`,
      ...capped(findingLines(conventions)),
      "Follow the convention, or if this is a deliberate change, say so (the user can run `skrub conventions --write`).",
    );
  }
  if (reuse.length > 0) {
    if (lines.length > 0) lines.push("");
    lines.push(
      `skrub: ${reuse.length} ${reuse.length === 1 ? "place writes" : "places write"} again what the repo already has.`,
      ...capped(findingLines(reuse)),
      "Use what exists, or keep the new one and say in a line why it's different.",
    );
  }
  if (folds.length > 0) {
    if (lines.length > 0) lines.push("");
    lines.push(
      `skrub: ${folds.length} new ${folds.length === 1 ? "file is" : "files are"} small and used by only one other file.`,
      ...capped(findingLines(folds)),
      "Fold each into the file that uses it, or keep it and say in a line why.",
    );
  }
  lines.push("Then finish; skrub won't raise the same list again this session.");
  return lines.join("\n");
}

/** Findings listed in one stop message, across all sections: the agent's context stays small. */
const MAX_LINES = 10;

/** Record `fingerprint` for the session in `.skrub/<name>`; false if it was already raised. */
export async function recordOnce(cwd: string, name: string, session: string, fingerprint: string): Promise<boolean> {
  const file = path.join(cwd, SKRUB_DIR, name);
  let seen: Record<string, string[]> = {};
  if (await exists(file)) {
    try {
      seen = await readJson(file);
    } catch {
      seen = {};
    }
  }
  const list = seen[session] ?? [];
  if (list.includes(fingerprint)) return false;
  // Keep the file small: only the last few sessions matter.
  const sessions = Object.keys(seen).filter((s) => s !== session).slice(-9);
  const next: Record<string, string[]> = {};
  for (const s of sessions) next[s] = seen[s]!;
  next[session] = [...list, fingerprint].slice(-20);
  await writeJson(file, next);
  return true;
}
