import path from "node:path";
import { selfCommand } from "../agent/self.ts";
import { addPreWriteHook, addSessionStartHook, addStopHook, copySkill, gitignoreSkrubDir } from "../agent/install.ts";
import { CONVENTIONS_FILE } from "../conventions/conventions.ts";
import { establish } from "../conventions/establish.ts";

/**
 * Set a repo up so its coding agent reuses what exists and cleans up after
 * itself: the skrub skill in .claude/skills, a Stop hook and a Write hook in
 * .claude/settings.json, and .skrub/ in .gitignore. Running it again updates all three in place.
 */
export async function initCommand(opts: { cwd?: string; hook?: boolean; skill?: boolean }): Promise<void> {
  const cwd = path.resolve(opts.cwd ?? process.cwd());
  const cmd = selfCommand(cwd);
  const done: string[] = [];

  if (opts.skill !== false) {
    await copySkill(path.join(cwd, ".claude/skills/skrub"), cmd);
    done.push(".claude/skills/skrub/  the skill: when to run skrub, and the practices it can't check");
  }
  if (opts.hook !== false) {
    await addStopHook(path.join(cwd, ".claude/settings.json"), `${cmd} hook`);
    await addPreWriteHook(path.join(cwd, ".claude/settings.json"), `${cmd} prewrite`);
    await addSessionStartHook(path.join(cwd, ".claude/settings.json"), `${cmd} session`);
    done.push(".claude/settings.json  a Stop hook: leftovers in the agent's change block it from finishing, once");
    done.push(".claude/settings.json  a Write hook: a new file that repeats existing code is pointed at it first, once");
    done.push(".claude/settings.json  a SessionStart hook: every session starts knowing the conventions and what the product is");
  }
  const conventions = await establish(cwd, false, true);
  if (!conventions.mined) done.push(`${CONVENTIONS_FILE}  skipped: no source files under \`include\` (default src)`);
  else if (!conventions.existed)
    done.push(
      `${CONVENTIONS_FILE}  this repo's conventions${conventions.mined.shared.length ? ", and what it shares most," : ""} read from its code`,
    );
  if (await gitignoreSkrubDir(cwd)) done.push(".gitignore  .skrub/");

  console.log("skrub init");
  for (const line of done) console.log(`  ${line}`);
  console.log("\n  other agents: add to AGENTS.md");
  console.log(`  > Follow ${CONVENTIONS_FILE}. Before finishing a change, run \`${cmd} fix\`.`);
}
