import path from "node:path";
import { pathToFileURL } from "node:url";
import { promises as fs } from "node:fs";
import { exists } from "./lib/fs.ts";
import { errMessage } from "./lib/errors.ts";
import { listFiles } from "./git/git.ts";
import { matches } from "./program/glob.ts";

export interface Config {
  include: string[];
  exclude: string[];
  entries: string[];
  maxHunks: number;
  /**
   * What `skrub fix` runs after deleting: by default the repo's `typecheck`
   * script, else tsc on tsconfig.json. A command string runs instead; false
   * skips it. Files whose edits break it are put back.
   */
  verify?: string | false;
}

const CONFIG_FILES = [
  "skrub.config.ts",
  "skrub.config.js",
  "skrub.config.mjs",
  "unvibe.config.ts",
  "unvibe.config.js",
  "unvibe.config.mjs",
];

async function findConfigFile(cwd: string): Promise<string | undefined> {
  for (const name of CONFIG_FILES) {
    const p = path.join(cwd, name);
    if (await exists(p)) return p;
  }
  return undefined;
}

const NO_TYPESCRIPT = (where: string, js = false) =>
  `skrub reads TypeScript (.ts and .tsx), and there's none in ${where} to scan.` + (js ? " This looks like a JavaScript project." : "");

/** With a config or a src/, whether what it covers has any TypeScript; null when it does (or git can't say). */
async function noTypeScript(cwd: string): Promise<string | null> {
  const files = listFiles(cwd);
  if (!files) return null;
  const { include } = await loadConfig(cwd);
  const inScope = files.filter((f) => !include.length || include.some((p) => matches(f, p)));
  if (inScope.some((f) => /\.(ts|tsx|mts|cts)$/.test(f) && !f.endsWith(".d.ts"))) return null;
  return NO_TYPESCRIPT(include.map((p) => `${p}/`).join(", ") || "this repo", inScope.some((f) => /\.[cm]?jsx?$/.test(f)));
}

/**
 * Why a scan here would cover nothing: no config and no src/, the default
 * include. Names the folders that do hold TypeScript, for the config to list.
 * Null when there's a config or a src/.
 */
export async function emptyScope(cwd: string): Promise<string | null> {
  if ((await findConfigFile(cwd)) || (await exists(path.join(cwd, "src")))) return noTypeScript(cwd);
  const counts = new Map<string, number>();
  for (const file of listFiles(cwd) ?? []) {
    const [top, ...rest] = file.split("/");
    if (!rest.length || !/\.(ts|tsx|mts|cts)$/.test(file) || file.endsWith(".d.ts")) continue;
    if (top!.startsWith(".") || /^(node_modules|dist|build|tests?|test-d|__tests__|scripts|examples?)$/.test(top!)) continue;
    counts.set(top!, (counts.get(top!) ?? 0) + 1);
  }
  const folders = [...counts].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([f]) => JSON.stringify(f));
  if (!folders.length) return NO_TYPESCRIPT("this repo");
  return (
    "skrub scans src/ by default, and this repo has no src/. Tell it where your code is in skrub.config.ts:\n\n" +
    `  export default { include: [${folders.join(", ")}], entries: [/* files that start your app */] };`
  );
}

export async function loadConfig(cwd: string): Promise<Config> {
  const configPath = await findConfigFile(cwd);

  const pkgEntries = await entriesFromPackageJson(cwd);
  const defaults: Config = {
    include: ["src"],
    exclude: [],
    entries: pkgEntries,
    maxHunks: 40,
  };

  if (!configPath) return defaults;

  let mod: Record<string, unknown>;
  try {
    mod = (await import(pathToFileURL(configPath).href)) as Record<string, unknown>;
  } catch (err) {
    throw new Error(`Could not import ${configPath}: ${errMessage(err)}`, { cause: err });
  }

  const raw = (mod.default ?? mod) as Partial<Config>;
  return {
    include: Array.isArray(raw.include) && raw.include.length ? raw.include.map(String) : defaults.include,
    exclude: Array.isArray(raw.exclude) ? raw.exclude.map(String) : defaults.exclude,
    entries: Array.isArray(raw.entries) && raw.entries.length ? raw.entries.map(String) : defaults.entries,
    maxHunks: typeof raw.maxHunks === "number" && raw.maxHunks > 0 ? raw.maxHunks : defaults.maxHunks,
    ...(raw.verify === false || typeof raw.verify === "string" ? { verify: raw.verify } : {}),
  };
}

async function entriesFromPackageJson(cwd: string): Promise<string[]> {
  const file = path.join(cwd, "package.json");
  if (!(await exists(file))) return ["src/index.ts"];
  try {
    const pkg = JSON.parse(await fs.readFile(file, "utf8")) as Record<string, unknown>;
    const out = new Set<string>();
    for (const field of ["main", "module", "types", "typings"]) {
      if (typeof pkg[field] === "string") out.add(pkg[field] as string);
    }
    if (typeof pkg.bin === "string") out.add(pkg.bin);
    else if (pkg.bin && typeof pkg.bin === "object") {
      for (const v of Object.values(pkg.bin as Record<string, unknown>)) {
        if (typeof v === "string") out.add(v);
      }
    }
    collectExportPaths(pkg.exports, out);
    // Files a script names by path (`esbuild src/web/app.ts`, `tsx scripts/seed.ts`) are run, not imported.
    if (pkg.scripts && typeof pkg.scripts === "object") {
      for (const script of Object.values(pkg.scripts as Record<string, unknown>)) {
        if (typeof script !== "string") continue;
        for (const token of script.split(/[\s=;&|()"']+/)) {
          const rel = token.replace(/^\.\//, "");
          if (/\.[cm]?[jt]sx?$/.test(rel) && !rel.includes("*") && (await exists(path.join(cwd, rel)))) out.add(rel);
        }
      }
    }
    out.add("src/index.ts");
    return [...out];
  } catch {
    return ["src/index.ts"];
  }
}

function collectExportPaths(value: unknown, out: Set<string>): void {
  if (typeof value === "string") {
    out.add(value);
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const v of Object.values(value as Record<string, unknown>)) collectExportPaths(v, out);
}
