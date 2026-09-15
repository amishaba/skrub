import path from "node:path";
import { CONVENTIONS_FILE, type Mined, rulesFrom } from "../conventions/conventions.ts";
import { establish } from "../conventions/establish.ts";

/**
 * First run: read the repo's conventions from its code and write them down.
 * Later runs: say where the code has drifted from what's written; --write
 * takes the code's side and keeps the notes.
 */
export async function conventionsCommand(opts: { cwd?: string; write?: boolean }): Promise<void> {
  const cwd = path.resolve(opts.cwd ?? process.cwd());
  const result = await establish(cwd, opts.write);
  if (!result.mined) {
    console.log("skrub conventions  no source files to read; set `include` in skrub.config.ts (default: src)");
    return;
  }
  if (result.wrote && !result.existed) {
    console.log(`skrub conventions  wrote ${CONVENTIONS_FILE}  (read ${result.mined.sources} source files)`);
    for (const line of summary(result.mined)) console.log(`  ${line}`);
    return;
  }
  console.log(`skrub conventions  ${result.drift.length === 0 ? "no drift" : `${result.drift.length} changed`}${result.wrote ? `, wrote ${CONVENTIONS_FILE}` : ""}`);
  for (const line of result.drift) console.log(`  ${line}`);
  if (result.drift.length > 0 && !result.wrote) console.log(`\n  if the code is right: skrub conventions --write`);
}

function summary(mined: Mined): string[] {
  const rules = Object.entries(rulesFrom(mined)).map(([k, v]) => `${k}: ${v}`);
  const mixed = mined.observations.filter((f) => !f.value && f.total > 0).map((f) => f.key);
  return [
    rules.length > 0 ? `checked from now on: ${rules.join(" · ")}` : "nothing consistent enough to check yet",
    ...(mixed.length > 0 ? [`mixed, not enforced: ${mixed.join(", ")}`] : []),
  ];
}
