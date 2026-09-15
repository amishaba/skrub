import path from "node:path";
import { sessionContext } from "../agent/session.ts";
import { readStdinJson } from "./hook.ts";

/** A Claude Code SessionStart hook: hand the session the conventions and the product, never blocking it. */
export async function sessionCommand(): Promise<void> {
  const input = await readStdinJson<{ cwd?: string }>();
  const cwd = path.resolve(input.cwd ?? process.cwd());
  const context = await sessionContext(cwd).catch(() => null);
  if (context) console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: context } }));
}
