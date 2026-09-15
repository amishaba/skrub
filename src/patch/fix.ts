import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { type Hunk, fixable } from "../hunk.ts";
import { loadConfig } from "../config.ts";
import { readJson, writeJson } from "../lib/fs.ts";
import { runScan } from "../scan/run.ts";
import { SKRUB_DIR } from "../store/scans.ts";
import { applyHunks } from "./apply.ts";
import { type Check, errorFile, errorNames, introduced, runCheck, verifyCommands } from "./verify.ts";

interface FixOpts {
  against?: string;
  staged?: boolean;
  llm?: boolean;
  /** Also delete the heuristic findings, not just the safe ones. */
  all?: boolean;
  dryRun?: boolean;
  /** False skips the typecheck after deleting. */
  verify?: boolean;
}

export interface FixResult {
  /** What was deleted, or with `dryRun`, what would be. */
  done: Hunk[];
  /** What is left for a person to read. */
  left: Hunk[];
  /** Deleted, then put back because the typecheck broke (now, or on an earlier run). */
  reverted: Hunk[];
  /** The errors that made skrub put them back. */
  errors: string[];
  /** The check that ran after deleting, or null if none did. */
  verified: string | null;
  /** Why fix stopped early, if a later pass couldn't scan. Everything applied before it was still checked. */
  stopped?: string;
}

const MAX_PASSES = 5;
/** Edits that broke the typecheck on an earlier run, so fix doesn't try them again. */
const BROKE = "broke-typecheck.json";

/**
 * Scan and delete, no TUI. Built for an agent's last step, or a script.
 * Deleting an import can leave the export it pointed at dead, so this keeps
 * going until a pass finds nothing new. Then it typechecks once: an edit that
 * broke the check goes back, so what `fix` leaves deleted is what the build
 * still agrees with.
 */
export async function fix(cwd: string, opts: FixOpts): Promise<FixResult> {
  const scanOnce = async (against: string | undefined) =>
    (await runScan({ against, staged: opts.staged, cwd, llm: opts.llm ?? false, uncapped: true })).scan;

  const broke = new Set(await readJson<string[]>(path.join(cwd, SKRUB_DIR, BROKE)).catch(() => [] as string[]));
  const split = (hunks: Hunk[]) => {
    const all = fixable(hunks, opts.all);
    return { fixes: all.filter((h) => !broke.has(key(h))), known: all.filter((h) => broke.has(key(h))) };
  };

  let scan = await scanOnce(opts.against);
  let { fixes, known } = split(scan.hunks);
  if (opts.dryRun) return { done: fixes, left: scan.hunks.filter((h) => !fixes.includes(h)), reverted: known, errors: [], verified: null };

  const cmds = opts.verify === false || fixes.length === 0 ? null : await verifyCommands(cwd, (await loadConfig(cwd)).verify);
  const before = cmds ? await runCheck(cwd, cmds) : null;
  const originals = new Map<string, string | null>();
  const firstPass = new Set<Hunk>(fixes);
  const applied: Hunk[] = [];
  let stopped: string | undefined;

  // Every pass keeps the first pass's scope: a tree that is clean again must
  // not widen it to the whole project. --staged stops after one, since fix
  // never edits the staged diff.
  const against = scan.summary.against ?? undefined;
  const passes = opts.staged ? 1 : MAX_PASSES;
  for (let pass = 0; fixes.length > 0 && pass < passes; pass++) {
    await remember(cwd, fixes, originals);
    await applyHunks(cwd, fixes);
    applied.push(...fixes);
    if (pass === passes - 1) break;
    try {
      scan = await scanOnce(against);
    } catch (err) {
      stopped = err instanceof Error ? err.message : String(err);
      break;
    }
    ({ fixes } = split(scan.hunks));
  }

  const left = scan.hunks.filter((h) => !applied.includes(h) && !known.includes(h));
  const result: FixResult = { done: applied, left, reverted: known, errors: [], verified: cmds ? cmds.map(label).join(" && ") : null, ...(stopped ? { stopped } : {}) };
  if (!cmds || !before || applied.length === 0) return result;

  const checked = await putBackWhatBroke(cwd, cmds, before, originals, firstPass, result);
  if (checked.reverted.length > known.length) {
    for (const h of checked.reverted) broke.add(key(h));
    await writeJson(path.join(cwd, SKRUB_DIR, BROKE), [...broke]);
  }
  return checked;
}

/** How a check reads in the output: `npm run typecheck`, `tsc -p tsconfig.app.json`, or the configured command. */
function label(cmd: string[]): string {
  if (cmd[0] === "sh") return cmd[2]!;
  if (cmd[0] === "npm") return "npm run typecheck";
  return `tsc -p ${cmd[cmd.indexOf("-p") + 1]}`;
}

/** A finding as it was: the same id over the same text. A changed file makes a new key, so fix tries again. */
function key(h: Hunk): string {
  return `${h.id}:${createHash("sha1").update(h.text).digest("hex").slice(0, 10)}`;
}

/** Keep each file's text before its first edit (null: it didn't exist), to put it back. */
async function remember(cwd: string, hunks: Hunk[], originals: Map<string, string | null>): Promise<void> {
  for (const h of hunks) {
    if (originals.has(h.file)) continue;
    originals.set(h.file, await fs.readFile(path.join(cwd, h.file), "utf8").catch(() => null));
  }
}

/**
 * Put back the files the check now fails in, then try their edits again
 * without the ones the errors name (deleting a type can leave the schema it
 * named unused). If the check still fails (the break shows up in a file fix
 * didn't touch), put everything back.
 */
async function putBackWhatBroke(
  cwd: string,
  cmds: string[][],
  before: Check,
  originals: Map<string, string | null>,
  firstPass: Set<Hunk>,
  result: FixResult,
): Promise<FixResult> {
  let after = introduced(before, await runCheck(cwd, cmds));
  if (!after.broken) return result;
  const errors = after.errors;

  const failing = new Set(errors.map(errorFile).filter((f) => originals.has(f)));
  const restored = new Set<string>();
  const kept = new Set<Hunk>();
  if (failing.size > 0) {
    await restore(cwd, originals, failing, restored);
    const retry = retryable(result.done, failing, errors, firstPass);
    if (retry.length > 0) {
      try {
        await applyHunks(cwd, retry);
        retry.forEach((h) => kept.add(h));
      } catch {
        // The retry didn't apply cleanly; those files stay as they were.
      }
    }
    after = introduced(before, await runCheck(cwd, cmds));
    if (after.broken && kept.size > 0) {
      await restore(cwd, originals, failing, restored);
      kept.clear();
      after = introduced(before, await runCheck(cwd, cmds));
    }
  }
  if (after.broken) {
    kept.clear();
    await restore(cwd, originals, new Set(originals.keys()), restored);
  }

  const back = (h: Hunk) => restored.has(h.file) && !kept.has(h);
  return {
    ...result,
    done: result.done.filter((h) => !back(h)),
    reverted: [...result.reverted, ...result.done.filter(back)],
    errors,
  };
}

/**
 * Edits in the failing files worth one more try: first-pass edits (later ones
 * were made against text the restore just undid) whose deleted lines don't
 * mention a name the new errors quote.
 */
function retryable(done: Hunk[], failing: Set<string>, errors: string[], firstPass: Set<Hunk>): Hunk[] {
  const names = new Set(errors.flatMap(errorNames));
  const mentions = (h: Hunk) => [...names].some((n) => new RegExp(`(?<![\\w$])${n.replace(/\$/g, "\\$")}(?![\\w$])`).test(h.text));
  const inFailing = done.filter((h) => failing.has(h.file));
  if (inFailing.some((h) => !firstPass.has(h))) {
    const later = new Set(inFailing.filter((h) => !firstPass.has(h)).map((h) => h.file));
    return inFailing.filter((h) => !later.has(h.file) && !mentions(h));
  }
  return inFailing.filter((h) => !mentions(h));
}

async function restore(cwd: string, originals: Map<string, string | null>, files: Set<string>, restored: Set<string>): Promise<void> {
  for (const file of files) {
    const text = originals.get(file);
    const abs = path.join(cwd, file);
    if (text == null) await fs.rm(abs, { force: true });
    else {
      await fs.mkdir(path.dirname(abs), { recursive: true });
      await fs.writeFile(abs, text, "utf8");
    }
    restored.add(file);
  }
}
