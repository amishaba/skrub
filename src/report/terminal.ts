import type { Scan } from "../scan/summary.ts";
import { headline, kindRows, scopeOf } from "./report.ts";
import { runHint } from "../agent/self.ts";

/** The scan, as printed when there is no TUI to open (piped, CI, or `view` without a terminal). */
export function printScanSummary(
  scan: Scan,
  extra?: { dir?: string; llmFlag?: boolean; hint?: boolean },
): void {
  console.log(`skrub  ${scan.summary.id}`);
  console.log(`  ${headline(scan.hunks)}`);
  const kinds = kindRows(scan.hunks)
    .map((r) => `${r.kind} ${r.hunks}`)
    .join("  ");
  if (kinds) console.log(`  ${kinds}`);
  console.log(`  in ${scopeOf(scan.summary)}`);
  if (scan.summary.llm) console.log(`  llm ${scan.summary.llm}`);
  else if (extra?.llmFlag === false) console.log("  mechanical (--no-llm)");
  else console.log("  mechanical (set GEMINI_API_KEY for the llm pass)");
  if (extra?.dir) console.log(`  ${extra.dir}`);
  if (extra?.hint !== false) console.log(`  ${runHint()} view`);
}
