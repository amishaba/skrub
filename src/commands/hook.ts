import path from "node:path";
import { errMessage } from "../lib/errors.ts";
import { stopHook } from "../agent/hook.ts";

interface StopInput {
  session_id?: string;
  cwd?: string;
  stop_hook_active?: boolean;
}

/**
 * A Claude Code Stop hook. When the agent is about to finish and its change
 * leaves code to clean up, block the stop once and hand it the list; it can
 * delete, or say why something stays. A clean change gets one line for the user.
 */
export async function hookCommand(): Promise<void> {
  const input = await readStdinJson<StopInput>();
  if (input.stop_hook_active) return;
  const cwd = path.resolve(input.cwd ?? process.cwd());

  let verdict: Awaited<ReturnType<typeof stopHook>>;
  try {
    verdict = await stopHook(cwd, input.session_id ?? "default");
  } catch (err) {
    // A broken scan must never trap the agent; say so and let it stop.
    console.error(`skrub hook: scan failed, not blocking (${errMessage(err)})`);
    return;
  }
  if (verdict && "block" in verdict) console.log(JSON.stringify({ decision: "block", reason: verdict.block }));
  else if (verdict) console.log(JSON.stringify({ systemMessage: verdict.pass }));
}

export async function readStdinJson<T>(): Promise<Partial<T>> {
  if (process.stdin.isTTY) return {};
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  const text = Buffer.concat(chunks).toString("utf8").trim();
  if (!text) return {};
  try {
    return JSON.parse(text) as Partial<T>;
  } catch {
    return {};
  }
}
