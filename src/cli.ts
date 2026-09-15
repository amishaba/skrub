import { createRequire } from "node:module";
import { Command } from "commander";
import { scanCommand } from "./commands/scan.ts";
import { viewCommand } from "./commands/view.ts";
import { applyCommand } from "./commands/apply.ts";
import { commentCommand } from "./commands/comment.ts";
import { checkCommand, fixCommand } from "./commands/fix.ts";
import { hookCommand } from "./commands/hook.ts";
import { prewriteCommand } from "./commands/prewrite.ts";
import { sessionCommand } from "./commands/session.ts";
import { initCommand } from "./commands/init.ts";
import { conventionsCommand } from "./commands/conventions.ts";
import { errMessage } from "./lib/errors.ts";

const { version } = createRequire(import.meta.url)("../package.json") as { version: string };

const program = new Command();

program
  .name("skrub")
  .description("Find what your TypeScript repo doesn't need, and what new code wrote again instead of reusing. Nothing changes until you say so.")
  .version(version)
  .showHelpAfterError();

function scanOpts(cmd: Command): Command {
  return cmd
    .option("--against <ref>", "only hunks in git diff <ref>")
    .option("--staged", "only hunks in the staged diff")
    .option("--cwd <path>", "working directory")
    .option("--json", "print summary to stdout")
    .option("--no-llm", "skip the optional naming/pattern pass");
}

scanOpts(
  program
    .command("scan", { isDefault: true })
    .description("Scan, then go through the findings: d delete, k keep, a apply, q quit"),
).action(async (opts) => {
  await scanCommand(opts);
});

program
  .command("view")
  .description("Go through the latest scan again")
  .option("--web", "HTML review page instead of the TUI")
  .option("-p, --port <number>", "port for --web (default 4322)")
  .option("--cwd <path>", "working directory")
  .option("--no-open", "don't open the browser")
  .action(async (opts) => {
    await viewCommand(opts);
  });

program
  .command("apply")
  .description("Apply what you chose to delete in the last scan")
  .option("--id <dir>", "scan directory name under .skrub/")
  .option("--cwd <path>", "working directory")
  .action(async (opts) => {
    await applyCommand(opts);
  });

program
  .command("comment")
  .description("Leave quality notes on a pull request")
  .option("--against <ref>", "git ref to diff against (default: PR base)")
  .option("--cwd <path>", "working directory")
  .option("--pr <number>", "pull request number")
  .option("--repo <owner/name>", "GitHub repo (default GITHUB_REPOSITORY)")
  .option("--no-llm", "skip the optional naming/pattern pass")
  .action(async (opts) => {
    await commentCommand(opts);
  });

scanOpts(
  program
    .command("fix")
    .description("Delete the safe findings in one go, no review (for agents and scripts)")
    .option("--all", "also delete the heuristic findings")
    .option("--dry-run", "print what would be deleted")
    .option("--no-verify", "skip the typecheck after deleting"),
).action(async (opts) => {
  await fixCommand(opts);
});

scanOpts(
  program
    .command("check")
    .description("Report findings; exit 1 if any are safe to delete")
    .option("--all", "fail on heuristic findings too"),
).action(async (opts) => {
  await checkCommand(opts);
});

program
  .command("hook")
  .description("Claude Code Stop hook: block once if the agent's change leaves deletable code")
  .action(async () => {
    await hookCommand();
  });

program
  .command("prewrite")
  .description("Claude Code PreToolUse hook: before a new file repeats what the repo has, say where it is, once")
  .action(async () => {
    await prewriteCommand();
  });

program
  .command("session")
  .description("Claude Code SessionStart hook: start every session knowing the conventions and the product")
  .action(async () => {
    await sessionCommand();
  });

program
  .command("conventions")
  .description("Read this repo's conventions from its code into .claude/conventions.md; later, show drift")
  .option("--cwd <path>", "working directory")
  .option("--write", "update the file to match the code (notes are kept)")
  .action(async (opts) => {
    await conventionsCommand(opts);
  });

program
  .command("init")
  .description("Set up Claude Code here: the product and conventions, the session, write and stop hooks, and the skill")
  .option("--cwd <path>", "working directory")
  .option("--no-hook", "skip the hooks")
  .option("--no-skill", "skip the skill")
  .action(async (opts) => {
    await initCommand(opts);
  });

program.parseAsync(process.argv).catch((err) => {
  console.error(errMessage(err));
  process.exit(1);
});
