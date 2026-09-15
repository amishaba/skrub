import path from "node:path";
import { errMessage } from "../lib/errors.ts";
import { preWriteReason } from "../agent/prewrite.ts";
import { readStdinJson } from "./hook.ts";

interface PreToolInput {
  session_id?: string;
  cwd?: string;
  tool_name?: string;
  tool_input?: { file_path?: string; content?: string };
}

/**
 * A Claude Code PreToolUse hook for Write. Before the agent creates a file
 * that repeats what the repo already has, stop that write once and say where
 * the existing code is.
 */
export async function prewriteCommand(): Promise<void> {
  const input = await readStdinJson<PreToolInput>();
  const file = input.tool_input?.file_path;
  if (input.tool_name !== "Write" || !file) return;
  const cwd = path.resolve(input.cwd ?? process.cwd());
  let reason: string | null;
  try {
    reason = await preWriteReason(cwd, input.session_id ?? "default", file, input.tool_input?.content ?? "");
  } catch (err) {
    // A broken check must never stop the agent from writing.
    console.error(`skrub prewrite: check failed, not blocking (${errMessage(err)})`);
    return;
  }
  if (reason)
    console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: reason } }));
}
