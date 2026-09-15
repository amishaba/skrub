import path from "node:path";
import { Node } from "ts-morph";
import { exists } from "../lib/fs.ts";
import { loadConfig } from "../config.ts";
import { isIncluded, loadProgram, shouldSkipFile } from "../program/program.ts";
import { sharedExports } from "../program/usage.ts";
import { overlapping } from "../detect/reuse.ts";
import { shapes, shapesIn, similarity } from "../detect/similar.ts";
import { recordOnce } from "./hook.ts";

const SOURCE = /\.[cm]?[jt]sx?$/;
const NEAR_COPY = 0.7;

/**
 * What a Claude Code PreToolUse hook should tell the agent before it writes a
 * new file, or null to let the write through: the code the repo already has
 * that the new file repeats, by name or by shape. Raised once per file per
 * session, so writing it again goes through.
 */
export async function preWriteReason(cwd: string, session: string, filePath: string, content: string): Promise<string | null> {
  const rel = path.relative(cwd, path.resolve(cwd, filePath)).split(path.sep).join("/");
  const lines = await alreadyThere(cwd, filePath, content);
  if (!lines.length || !(await recordOnce(cwd, "prewrite.json", session, rel))) return null;
  return [
    `skrub: before you add ${rel}, the repo already has this:`,
    ...lines.map((l) => `- ${l}`),
    "Reuse or extend it. If the new file is still the right call, write it again; skrub won't stop it twice.",
  ].join("\n");
}

/** What a new file at `filePath` would repeat, one line each, at most three; empty for anything else. */
export async function alreadyThere(cwd: string, filePath: string, content: string): Promise<string[]> {
  const abs = path.resolve(cwd, filePath);
  const rel = path.relative(cwd, abs).split(path.sep).join("/");
  if (rel.startsWith("..") || !SOURCE.test(rel) || shouldSkipFile(rel) || (await exists(abs))) return [];
  const config = await loadConfig(cwd);
  if (!isIncluded(rel, config.include)) return [];

  const program = await loadProgram(cwd, config);
  const existing = shapes(program);
  const shared = sharedExports(program);
  const sf = program.project.createSourceFile(abs, content, { overwrite: true });
  const found: string[] = [];

  for (const [name, decls] of sf.getExportedDeclarations()) {
    const decl = decls[0];
    const own =
      name !== "default" ? name : decl && (Node.isFunctionDeclaration(decl) || Node.isClassDeclaration(decl)) ? decl.getName() : undefined;
    if (!own) continue;
    // Declared there, not re-exported: a barrel that re-exports this very file isn't a second copy.
    const same = program.files.find(
      (f) => f.rel !== rel && (f.sf.getExportedDeclarations().get(own) ?? []).some((d) => d.getSourceFile() === f.sf),
    );
    if (same) {
      found.push(`\`${own}\` is already exported from ${same.rel}.`);
      continue;
    }
    const near = overlapping(own, shared);
    if (near) found.push(`\`${near.name}\` (${near.kind} in ${near.rel}) is used by ${near.importers} files.`);
  }
  const mine = shapesIn(sf, rel);
  const nodes = new Set(mine.map((s) => s.node));
  // Only outermost functions: a callback inside a near-copy is part of it, not a second finding.
  for (const s of mine.filter((m) => !m.node.getAncestors().some((a) => nodes.has(a)))) {
    let best: { name: string; at: string; score: number } | undefined;
    for (const other of existing) {
      const score = similarity(s, other);
      if (score >= NEAR_COPY && (!best || score > best.score)) best = { name: other.name ?? "a function", at: `${other.rel}:${other.line}`, score };
    }
    if (best) found.push(`${s.name ?? "a function here"} is ${Math.round(best.score * 100)}% the same as ${best.name} in ${best.at}.`);
  }
  program.project.removeSourceFile(sf);
  return [...new Set(found)].slice(0, 3);
}
