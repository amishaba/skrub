import { promises as fs } from "node:fs";
import path from "node:path";
import type { Decisions, Hunk } from "../hunk.ts";
import type { Scan, ScanSummary } from "../scan/summary.ts";
import { exists, readJson, writeJson } from "../lib/fs.ts";

export const SKRUB_DIR = ".skrub";
const LEGACY_DIR = ".unvibe";

/** A new scan's id, which is also its directory name: `scan-2026-10-04T12-00-00`. */
export function newScanId(): string {
  return `scan-${new Date().toISOString().replace(/:/g, "-").replace(/\..+/, "")}`;
}

export async function resolveScanDir(root: string, id: string): Promise<string> {
  const next = path.join(root, SKRUB_DIR, id);
  if (await exists(path.join(next, "findings.json"))) return next;
  const legacy = path.join(root, LEGACY_DIR, id);
  if (await exists(path.join(legacy, "findings.json"))) return legacy;
  return next;
}

export async function writeScan(root: string, scan: Scan, patch: string): Promise<string> {
  const dir = path.join(root, SKRUB_DIR, scan.summary.id);
  await writeJson(path.join(dir, "findings.json"), { hunks: scan.hunks });
  await writeJson(path.join(dir, "summary.json"), scan.summary);
  await writeJson(path.join(dir, "decisions.json"), {} as Decisions);
  await fs.writeFile(path.join(dir, "patch.diff"), patch, "utf8");
  return dir;
}

export async function readScan(root: string, id: string): Promise<Scan> {
  const dir = await resolveScanDir(root, id);
  const hunks = (await readJson<{ hunks: Hunk[] }>(path.join(dir, "findings.json"))).hunks;
  const summary = await readJson<ScanSummary>(path.join(dir, "summary.json"));
  return { summary, hunks };
}

export async function readDecisions(root: string, id: string): Promise<Decisions> {
  const file = path.join(await resolveScanDir(root, id), "decisions.json");
  if (!(await exists(file))) return {};
  return readJson<Decisions>(file);
}

export async function writeDecisions(root: string, id: string, decisions: Decisions): Promise<void> {
  await writeJson(path.join(await resolveScanDir(root, id), "decisions.json"), decisions);
}

export async function listScanIds(root: string): Promise<string[]> {
  const ids = new Set<string>();
  for (const name of [SKRUB_DIR, LEGACY_DIR]) {
    const dir = path.join(root, name);
    if (!(await exists(dir))) continue;
    const entries = await fs.readdir(dir);
    for (const e of entries) {
      if (!e.startsWith("scan-")) continue;
      if (await exists(path.join(dir, e, "findings.json"))) ids.add(e);
    }
  }
  return [...ids].sort().reverse();
}

export async function latestScanId(root: string): Promise<string | null> {
  const ids = await listScanIds(root);
  return ids[0] ?? null;
}
