import type { Config } from "../config.ts";
import type { Hunk } from "../hunk.ts";
import { type DiffScope, addsLines } from "../git/diff.ts";
import { loadProgram } from "../program/program.ts";
import { type KnipResult, runKnip } from "../knip/knip.ts";
import { unusedHunks } from "./unused.ts";
import { glueHunks } from "./glue.ts";
import { claudeismHunks } from "./claudeism.ts";
import { dupHunks } from "./dup.ts";
import { namingHunks } from "./naming.ts";
import { conventionHunks } from "./convention.ts";
import { reuseHunks } from "./reuse.ts";
import { foldHunks } from "./fold.ts";
import { readConventions } from "../conventions/conventions.ts";

export async function detect(
  cwd: string,
  config: Config,
  opts: { changed: string[] | null; diff?: DiffScope | null },
): Promise<Hunk[]> {
  // knip runs in its own process; start it first so it works while the program loads.
  const knipRun = runKnip(cwd).catch((err: unknown) => {
    // Without knip there are no unused files or exports to report; everything else still runs.
    console.error(`skrub: skipping unused files and exports. ${err instanceof Error ? err.message : String(err)}`);
    return { files: new Set<string>(), exports: new Map() } satisfies KnipResult;
  });
  const program = await loadProgram(cwd, config);
  const knip = await knipRun;
  const changed = opts.changed ? new Set(opts.changed) : null;
  const diff = opts.diff ?? null;
  // A function is new if the diff added any of its lines; without line info, if its file changed.
  const isNew = diff
    ? (rel: string, start: number, end: number) => addsLines(diff, rel, start, end)
    : changed
      ? (rel: string) => changed.has(rel)
      : null;
  const conventions = await readConventions(cwd);
  const barrelsAreHouseStyle = conventions?.rules.barrels === "yes";
  return [
    ...unusedHunks(program, knip),
    ...glueHunks(program, { flagBarrels: !barrelsAreHouseStyle }),
    ...claudeismHunks(program),
    ...dupHunks(program, isNew),
    ...reuseHunks(program, isNew, diff),
    ...foldHunks(program, diff),
    ...namingHunks(program),
    ...(conventions && diff ? conventionHunks(program, conventions.rules, diff) : []),
  ];
}
