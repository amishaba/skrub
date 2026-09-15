import { promises as fs } from "node:fs";
import path from "node:path";
import { exists } from "../lib/fs.ts";

/**
 * What a repo is, as far as its files say: what it calls itself, the
 * surfaces people use it through, and the AI libraries it's built on. The
 * judgment (who uses it, the space it's in, whose patterns to follow) is
 * left for the agent, which reads the code anyway.
 */
export interface ProductFacts {
  what: string | null;
  surfaces: string[];
  ai: string[];
}

export const PRODUCT_HEADING = "## product";
/** What the agent replaces with its own read of the product. The stop hook checks for it. */
export const TO_FILL = "(to fill in)";

const AI_LIBS: Record<string, string> = {
  openai: "OpenAI",
  "@anthropic-ai/sdk": "Anthropic",
  ai: "Vercel AI SDK",
  "@mastra/core": "Mastra",
  "@openai/agents": "OpenAI Agents SDK",
  langchain: "LangChain",
  "@langchain/core": "LangChain",
  llamaindex: "LlamaIndex",
  "@modelcontextprotocol/sdk": "MCP",
  "@google/genai": "Gemini",
};
const API_LIBS = ["express", "hono", "fastify", "koa", "@nestjs/core", "elysia"];
const CLI_LIBS = ["commander", "yargs", "ink", "cac", "clipanion", "@oclif/core"];
/** Folders a web app's index.html or vite config usually sits in, besides the root. */
const APP_DIRS = [".", "web", "app", "client", "frontend", "site", "dashboard"];

interface Pkg {
  name?: string;
  description?: string;
  private?: boolean;
  bin?: string | Record<string, string>;
  main?: string;
  exports?: unknown;
  engines?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

export async function detectProduct(cwd: string): Promise<ProductFacts> {
  const pkg = await readPkg(path.join(cwd, "package.json"));
  const deps = new Set([...Object.keys(pkg?.dependencies ?? {}), ...Object.keys(pkg?.devDependencies ?? {})]);
  for (const dir of ["web", "app", "client", "frontend", "dashboard"]) {
    const sub = await readPkg(path.join(cwd, dir, "package.json"));
    for (const d of [...Object.keys(sub?.dependencies ?? {}), ...Object.keys(sub?.devDependencies ?? {})]) deps.add(d);
  }

  const surfaces: string[] = [];
  const bins = typeof pkg?.bin === "string" ? [pkg.name ?? "cli"] : Object.keys(pkg?.bin ?? {});
  if (bins.length) surfaces.push(`CLI (${bins.map((b) => `\`${b}\``).join(", ")})`);
  else if (CLI_LIBS.some((d) => deps.has(d))) surfaces.push("CLI");

  const web = await webApp(cwd, deps);
  if (web) surfaces.push(web);
  const api = API_LIBS.find((d) => deps.has(d));
  if (api) surfaces.push(`HTTP API (${api})`);
  else if (deps.has("next") && ((await exists(path.join(cwd, "app/api"))) || (await exists(path.join(cwd, "src/app/api"))) || (await exists(path.join(cwd, "pages/api"))))) {
    surfaces.push("HTTP API (Next.js route handlers)");
  }
  if (deps.has("react-native") || deps.has("expo")) surfaces.push("mobile app (React Native)");
  if (pkg?.engines?.vscode) surfaces.push("VS Code extension");
  if (deps.has("@modelcontextprotocol/sdk")) surfaces.push("MCP server");
  if ((await exists(path.join(cwd, "action.yml"))) || (await exists(path.join(cwd, "action.yaml")))) surfaces.push("GitHub Action");
  if (!bins.length && !web && !pkg?.private && (pkg?.exports || pkg?.main)) surfaces.push(`library${pkg?.name ? ` (\`${pkg.name}\`)` : ""}`);

  const ai = [...new Set([...deps].filter((d) => d in AI_LIBS || d.startsWith("@ai-sdk/")).map((d) => AI_LIBS[d] ?? "Vercel AI SDK"))];
  return { what: pkg?.description?.trim() || (await readmeLine(cwd)), surfaces, ai };
}

async function webApp(cwd: string, deps: Set<string>): Promise<string | null> {
  if (deps.has("next")) return "web app (Next.js)";
  const ui = ["react", "vue", "svelte", "solid-js", "preact", "@angular/core"].find((d) => deps.has(d));
  const stack = [deps.has("vite") ? "Vite" : null, ui ? { react: "React", vue: "Vue", svelte: "Svelte", "solid-js": "Solid", preact: "Preact", "@angular/core": "Angular" }[ui] : null].filter(Boolean).join(", ");
  for (const dir of APP_DIRS) {
    const has = (await exists(path.join(cwd, dir, "index.html"))) || (await exists(path.join(cwd, dir, "vite.config.ts"))) || (await exists(path.join(cwd, dir, "vite.config.js")));
    if (has) return `web app${dir === "." ? "" : ` in ${dir}/`}${stack ? ` (${stack})` : ""}`;
  }
  if (deps.has("@remix-run/react") || deps.has("astro")) return `web app (${deps.has("astro") ? "Astro" : "Remix"})`;
  return null;
}

/** The README's first plain sentence or two: what the project says it is. */
async function readmeLine(cwd: string): Promise<string | null> {
  for (const name of ["README.md", "readme.md", "Readme.md"]) {
    const file = path.join(cwd, name);
    if (!(await exists(file))) continue;
    const text = await fs.readFile(file, "utf8");
    for (const para of text.split(/\n\s*\n/)) {
      const t = para.trim();
      if (!t || /^(#|!\[|\[!\[|<|```|---|\|)/.test(t)) continue;
      const plain = t
        .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
        .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
        .replace(/[`*_]/g, "")
        .replace(/\s+/g, " ")
        .trim();
      if (plain.length < 12) continue;
      return plain.length > 220 ? plain.slice(0, 220).replace(/\s+\S*$/, "") + "…" : plain;
    }
  }
  return null;
}

async function readPkg(file: string): Promise<Pkg | null> {
  try {
    return JSON.parse(await fs.readFile(file, "utf8")) as Pkg;
  } catch {
    return null;
  }
}

/** The section as conventions.md shows it: the facts, then what the agent fills in. */
export function productSection(facts: ProductFacts): string[] {
  return [
    PRODUCT_HEADING,
    "",
    `<!-- skrub wrote the first lines from the repo. The agent fills each ${TO_FILL} on its first session, from the README, routes and UI, and confirms them with the user in one line. Kept as written after that; correct them here. -->`,
    `- what it is: ${facts.what ?? TO_FILL}`,
    `- surfaces: ${facts.surfaces.length ? facts.surfaces.join("; ") : TO_FILL}`,
    ...(facts.ai.length ? [`- built on: ${facts.ai.join(", ")}`] : []),
    `- who uses it, and the job they're doing: ${TO_FILL}`,
    `- the space, and two or three products to model on: ${TO_FILL}`,
    `- what to copy from them for these surfaces: ${TO_FILL}`,
    "",
  ];
}

/** The product section as written in `text`, or null when there is none. */
export function productText(text: string): string | null {
  const at = text.indexOf(`\n${PRODUCT_HEADING}\n`);
  if (at < 0) return null;
  const next = text.indexOf("\n## ", at + 1);
  return text.slice(at + 1, next >= 0 ? next + 1 : undefined);
}

/** Whether the section still has lines for the agent to fill. */
export function productUnfilled(text: string): boolean {
  const section = productText(text);
  return section != null && section.split("\n").some((l) => l.startsWith("- ") && l.includes(TO_FILL));
}

/** `text` with a product section added before the first `## ` heading, if it has none. */
export function withProductSection(text: string, section: string[]): string {
  if (productText(text) != null) return text;
  const at = text.indexOf("\n## ");
  const block = section.join("\n") + "\n";
  return at >= 0 ? `${text.slice(0, at + 1)}${block}${text.slice(at + 1)}` : `${text.trimEnd()}\n\n${block}`;
}
