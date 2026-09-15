import path from "node:path";
import { fail, errMessage } from "../lib/errors.ts";
import { applyAccepted } from "../patch/apply.ts";

export async function applyCommand(opts: { id?: string; cwd?: string }): Promise<void> {
  const cwd = path.resolve(opts.cwd ?? process.cwd());
  let result: { id: string; applied: number };
  try {
    result = await applyAccepted(cwd, opts.id);
  } catch (err) {
    fail(errMessage(err));
  }
  console.log(`skrub apply  ${result.id}`);
  console.log(result.applied === 0 ? "  nothing accepted" : `  ${result.applied} hunks`);
}
