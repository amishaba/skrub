import type { Hunk } from "../hunk.ts";
import { type DiffScope, addsLines } from "../git/diff.ts";

const ORPHANED = "This diff removed its last reference.";
const ORPHANABLE = new Set<Hunk["kind"]>(["unused_export", "unused_file", "unused_import", "needless_export"]);

/**
 * Keep what this diff wrote, plus dead code it left behind: an unused symbol
 * whose name appears in a removed line lost a reference in this diff. Code
 * the diff never touched is not the agent's to clean up.
 */
export function inDiff(hunks: Hunk[], diff: DiffScope): Hunk[] {
  const out: Hunk[] = [];
  for (const h of hunks) {
    if (addsLines(diff, h.file, h.startLine, h.endLine)) {
      out.push(h);
    } else if (ORPHANABLE.has(h.kind) && h.symbols?.some((s) => mentions(diff.removed, s))) {
      out.push(h.reason.endsWith(ORPHANED) ? h : { ...h, reason: `${h.reason} ${ORPHANED}` });
    }
  }
  return out;
}

function mentions(text: string, symbol: string): boolean {
  const escaped = symbol.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?<![\\w$])${escaped}(?![\\w$])`).test(text);
}

export function inScope(hunks: Hunk[], changed: string[] | null): Hunk[] {
  if (!changed) return hunks;
  const set = new Set(changed.map((f) => f.split("\\").join("/")));
  return hunks.filter((h) => set.has(h.file));
}
