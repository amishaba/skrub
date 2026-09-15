import { promises as fs } from "node:fs";
import path from "node:path";
import { exists } from "../lib/fs.ts";
import { fileURLToPath } from "node:url";
import { SKILL_COMMAND } from "./self.ts";

/** The skill folder that ships with the package. */
const SKILL_SOURCE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../skills/skrub");

interface HookEntry {
  type: string;
  command: string;
  timeout?: number;
}
interface Settings {
  hooks?: Record<string, { matcher?: string; hooks: HookEntry[] }[]>;
  [key: string]: unknown;
}

/** Copy the skill that ships with skrub into `dest`, pointed at this install of skrub. */
export async function copySkill(dest: string, cmd: string): Promise<void> {
  if (!(await exists(SKILL_SOURCE))) throw new Error(`skill files missing from this install: ${SKILL_SOURCE}`);
  await fs.rm(dest, { recursive: true, force: true });
  await copyDir(SKILL_SOURCE, dest, (text) => (cmd === SKILL_COMMAND ? text : text.split(SKILL_COMMAND).join(cmd)));
}

async function copyDir(src: string, dest: string, transform: (text: string) => string): Promise<void> {
  await fs.mkdir(dest, { recursive: true });
  for (const entry of await fs.readdir(src, { withFileTypes: true })) {
    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);
    if (entry.isDirectory()) await copyDir(from, to, transform);
    else await fs.writeFile(to, transform(await fs.readFile(from, "utf8")), "utf8");
  }
}

/** Add or update skrub's Stop hook; every other setting and hook is left as it was. */
export async function addStopHook(file: string, command: string): Promise<void> {
  let settings: Settings = {};
  if (await exists(file)) {
    try {
      settings = JSON.parse(await fs.readFile(file, "utf8")) as Settings;
    } catch {
      throw new Error(`${file} is not valid JSON; fix it or add the hook by hand: ${command}`);
    }
  }
  settings.hooks ??= {};
  const stop = (settings.hooks.Stop ??= []);
  const ours = stop.flatMap((group) => group.hooks).find((h) => isSkrubHook(h.command));
  if (ours) {
    ours.command = command;
    ours.timeout = 60;
  } else {
    stop.push({ hooks: [{ type: "command", command, timeout: 60 }] });
  }
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
}

/** Add or update skrub's PreToolUse hook on Write; every other setting and hook is left as it was. */
export async function addPreWriteHook(file: string, command: string): Promise<void> {
  let settings: Settings = {};
  if (await exists(file)) {
    try {
      settings = JSON.parse(await fs.readFile(file, "utf8")) as Settings;
    } catch {
      throw new Error(`${file} is not valid JSON; fix it or add the hook by hand: ${command}`);
    }
  }
  settings.hooks ??= {};
  const pre = (settings.hooks.PreToolUse ??= []);
  const ours = pre.flatMap((group) => group.hooks).find((h) => /skrub/.test(h.command) && /\bprewrite\s*$/.test(h.command));
  if (ours) {
    ours.command = command;
    ours.timeout = 30;
  } else {
    pre.push({ matcher: "Write", hooks: [{ type: "command", command, timeout: 30 }] });
  }
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
}

/** Add or update skrub's SessionStart hook; every other setting and hook is left as it was. */
export async function addSessionStartHook(file: string, command: string): Promise<void> {
  let settings: Settings = {};
  if (await exists(file)) {
    try {
      settings = JSON.parse(await fs.readFile(file, "utf8")) as Settings;
    } catch {
      throw new Error(`${file} is not valid JSON; fix it or add the hook by hand: ${command}`);
    }
  }
  settings.hooks ??= {};
  const start = (settings.hooks.SessionStart ??= []);
  const ours = start.flatMap((group) => group.hooks).find((h) => /skrub/.test(h.command) && /\bsession\s*$/.test(h.command));
  if (ours) {
    ours.command = command;
    ours.timeout = 15;
  } else {
    start.push({ hooks: [{ type: "command", command, timeout: 15 }] });
  }
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
}

function isSkrubHook(command: string): boolean {
  return /skrub/.test(command) && /\bhook\s*$/.test(command);
}

/** Add .skrub/ to .gitignore; false if it was already there. */
export async function gitignoreSkrubDir(cwd: string): Promise<boolean> {
  const file = path.join(cwd, ".gitignore");
  const text = (await exists(file)) ? await fs.readFile(file, "utf8") : "";
  if (text.split("\n").some((l) => l.trim() === ".skrub/" || l.trim() === ".skrub")) return false;
  const sep = text === "" || text.endsWith("\n") ? "" : "\n";
  await fs.writeFile(file, `${text}${sep}.skrub/\n`, "utf8");
  return true;
}
