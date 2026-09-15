import path from "node:path";
import { fileURLToPath } from "node:url";

/** How the shipped skill files say to run skrub; `init` rewrites it to the command that runs this install. */
export const SKILL_COMMAND = "npx --yes @amishaba/skrub";

const BIN = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../bin/skrub.mjs");

/**
 * Where this skrub runs from: fetched by `npx github:…`, installed in the
 * project's node_modules, or anywhere else (a clone, a global install).
 */
function source(cwd: string, bin: string): "npx" | "project" | "path" {
  const parts = bin.split(path.sep);
  if (parts.includes("_npx")) return "npx";
  if (parts.includes("node_modules") && bin.startsWith(path.resolve(cwd) + path.sep)) return "project";
  return "path";
}

/**
 * The command a hook or skill runs to reach this same skrub. Never a bare
 * `npx skrub` outside a project install: npm has an unrelated `skrub` package.
 */
export function selfCommand(cwd = process.cwd(), bin = BIN): string {
  const from = source(cwd, bin);
  if (from === "npx") return SKILL_COMMAND;
  if (from === "project") return "npx skrub";
  return `node ${JSON.stringify(bin)}`;
}

/** The same, for a person to read in a message: `npx @amishaba/skrub`, `npx skrub`, or `skrub`. */
export function runHint(cwd = process.cwd(), bin = BIN): string {
  const from = source(cwd, bin);
  if (from === "npx") return "npx @amishaba/skrub";
  if (from === "project") return "npx skrub";
  return "skrub";
}
