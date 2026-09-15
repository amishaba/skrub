import path from "node:path";
import { promises as fs } from "node:fs";
import { Project, type SourceFile } from "ts-morph";
import type { Config } from "../config.ts";
import { exists } from "../lib/fs.ts";
import { matches } from "./glob.ts";
import { listFiles } from "../git/git.ts";

const SRC_EXT = /\.[cm]?[jt]sx?$/;

export interface Program {
  cwd: string;
  /** The config's include roots: what this scan covers. */
  include: string[];
  project: Project;
  entries: Set<string>;
  files: { sf: SourceFile; rel: string }[];
}

export async function loadProgram(cwd: string, config: Config): Promise<Program> {
  const tsconfig = await findTsconfig(cwd);
  const project = tsconfig
    ? new Project({ tsConfigFilePath: tsconfig, skipAddingFilesFromTsConfig: false })
    : new Project({ compilerOptions: { allowJs: true, noEmit: true } });

  if (!tsconfig) {
    for (const inc of config.include) {
      const abs = path.join(cwd, inc);
      if (!(await exists(abs))) continue;
      project.addSourceFilesAtPaths(path.join(abs, "**/*.{ts,tsx,mts,cts}"));
    }
  }

  // TypeScript outside the tsconfig can still import from it: a web/ app with its
  // own tsconfig, scripts, examples. Load it so its references keep things alive;
  // only the include roots are reported on.
  for (const rel of repoTypeScriptFiles(cwd)) {
    const abs = path.join(cwd, rel);
    if (!project.getSourceFile(abs)) project.addSourceFileAtPath(abs);
  }

  const entries = await expandEntries(cwd, config.entries, config.include);
  const files: Program["files"] = [];

  for (const sf of project.getSourceFiles()) {
    if (sf.isDeclarationFile()) continue;
    const rel = posixRel(cwd, sf.getFilePath());
    if (rel.startsWith("node_modules/") || rel.includes("/node_modules/")) continue;
    if (!isIncluded(rel, config.include)) continue;
    if (config.exclude.some((p) => matches(rel, p))) continue;
    if (shouldSkipFile(rel)) continue;
    files.push({ sf, rel });
  }

  return { cwd, include: config.include, project, entries, files };
}

function repoTypeScriptFiles(cwd: string): string[] {
  return (listFiles(cwd) ?? []).filter((f) => /\.(ts|tsx|mts|cts)$/.test(f) && !f.endsWith(".d.ts") && !f.split("/").includes("node_modules"));
}

function posixRel(cwd: string, abs: string): string {
  return path.relative(cwd, abs).split(path.sep).join("/");
}

/** Tests, declarations, and examples are never reported on. */
export function shouldSkipFile(rel: string): boolean {
  const n = rel.split("\\").join("/");
  if (n.endsWith(".d.ts")) return true;
  if (/(^|\/)example(\/|$)/.test(n)) return true;
  if (/\.(test|spec)\.[cm]?[jt]sx?$/.test(n)) return true;
  return false;
}

export function isEntry(rel: string, entries: Set<string>): boolean {
  const noExt = rel.replace(SRC_EXT, "");
  for (const e of entries) {
    const en = e.replace(/^\.\//, "");
    if (en === rel) return true;
    if (en.includes("*") && matches(rel, en)) return true;
    if (en.replace(SRC_EXT, "") === noExt) return true;
  }
  return false;
}

export function isIncluded(rel: string, include: string[]): boolean {
  if (include.length === 0) return true;
  return include.some((p) => matches(rel, p));
}

/** Where a relative import of `base` can land: as written, `.js` written for `.ts`, an extensionless path, or a folder's index. */
function moduleCandidates(base: string): string[] {
  return [
    base,
    base.replace(/\.([cm]?)jsx?$/, ".$1ts"),
    base.replace(/\.jsx$/, ".tsx"),
    base + ".ts",
    base + ".tsx",
    base + ".mts",
    base + ".cts",
    path.join(base, "index.ts"),
    path.join(base, "index.tsx"),
  ];
}

async function findTsconfig(cwd: string): Promise<string | undefined> {
  let dir = cwd;
  for (;;) {
    const p = path.join(dir, "tsconfig.json");
    if (await exists(p)) return p;
    const parent = path.dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

async function expandEntries(cwd: string, entries: string[], include: string[]): Promise<Set<string>> {
  const out = new Set<string>();
  for (const e of entries) {
    const rel = e.replace(/^\.\//, "");
    out.add(rel);
    const abs = path.join(cwd, rel);
    if (!(await exists(abs))) {
      const source = await sourceOf(cwd, rel, include);
      if (source) out.add(source);
      continue;
    }
    if (!/\.[cm]?js$/.test(rel)) continue;
    const text = await fs.readFile(abs, "utf8");
    for (const spec of jsImports(text)) {
      if (!spec.startsWith(".")) continue;
      const resolved = await resolveExisting(path.resolve(path.dirname(abs), spec));
      if (resolved) out.add(posixRel(cwd, resolved));
    }
  }
  return out;
}

/**
 * A package entry that points at build output (`dist/index.js`, `distribution/index.d.ts`)
 * that isn't built yet: the source file it's built from, found by putting each
 * include root in place of the build folder.
 */
async function sourceOf(cwd: string, rel: string, include: string[]): Promise<string | null> {
  const [, ...rest] = rel.split("/");
  if (!rest.length || rel.includes("*")) return null;
  const base = rest.join("/").replace(/(\.d)?\.[cm]?[jt]sx?$/, "");
  for (const root of include) {
    if (root.includes("*")) continue;
    for (const ext of [".ts", ".tsx", ".mts", ".cts"]) {
      const candidate = `${root.replace(/\/$/, "")}/${base}${ext}`;
      if (await exists(path.join(cwd, candidate))) return candidate;
    }
  }
  return null;
}

function jsImports(text: string): string[] {
  const out: string[] = [];
  const re = /(?:from\s+|import\s*\(\s*|require\s*\(\s*)["']([^"']+)["']/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) out.push(m[1]!);
  return out;
}

async function resolveExisting(base: string): Promise<string | null> {
  for (const c of moduleCandidates(base)) {
    if (await exists(c)) return c;
  }
  return null;
}
