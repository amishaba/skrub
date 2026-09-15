import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { establish } from "../src/conventions/establish.ts";
import { stopHook } from "../src/agent/hook.ts";
import { detectProduct, productUnfilled } from "../src/product/product.ts";
import { project } from "./helpers.ts";

const FILE = ".claude/conventions.md";

function repo(files: Record<string, string>): string {
  const dir = project(files);
  const git = (...args: string[]) => execFileSync("git", args, { cwd: dir, stdio: "pipe" });
  git("init", "-q");
  git("add", "-A");
  git("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "init");
  return dir;
}

const AGENTDIFF_LIKE = {
  "package.json": JSON.stringify({
    name: "agentdiff",
    description: "Compare two versions of an AI agent and report how its behaviour changed.",
    bin: { agentdiff: "bin/agentdiff.mjs" },
    dependencies: { commander: "1", "@openai/agents": "1", "@mastra/core": "1", ai: "1" },
    devDependencies: { vite: "1", react: "1" },
  }),
  "action.yml": "name: agentdiff\n",
  "web/index.html": "<div id=root></div>\n",
  "src/index.ts": "export const run = () => 1;\n",
};

test("the product's facts come from the repo: what it says it is, its surfaces, and the AI it's built on", async () => {
  const facts = await detectProduct(project(AGENTDIFF_LIKE));
  assert.equal(facts.what, "Compare two versions of an AI agent and report how its behaviour changed.");
  assert.deepEqual(facts.surfaces, ["CLI (`agentdiff`)", "web app in web/ (Vite, React)", "GitHub Action"]);
  assert.deepEqual(facts.ai, ["OpenAI Agents SDK", "Mastra", "Vercel AI SDK"]);
});

test("a published package with no CLI or app is a library; the README says what it is when package.json doesn't", async () => {
  const facts = await detectProduct(
    project({
      "package.json": JSON.stringify({ name: "tiny-dates", exports: "./dist/index.js" }),
      "README.md": "# tiny-dates\n\n[![ci](x)](y)\n\nFormat and parse dates in **two** functions, with no dependencies.\n",
    }),
  );
  assert.deepEqual(facts.surfaces, ["library (`tiny-dates`)"]);
  assert.equal(facts.what, "Format and parse dates in two functions, with no dependencies.");
});

test("conventions get a product section the agent fills, kept as written through --write", async () => {
  const dir = repo(AGENTDIFF_LIKE);
  await establish(dir);
  const file = path.join(dir, FILE);
  const text = readFileSync(file, "utf8");
  assert.match(text, /## product\n[\s\S]*- surfaces: CLI \(`agentdiff`\); web app in web\/ \(Vite, React\); GitHub Action/);
  assert.ok(text.indexOf("## product") < text.indexOf("## from the code"), "product comes first");
  assert.ok(productUnfilled(text));

  const filled = text.replace(/- who uses it, and the job they're doing: \(to fill in\)/, "- who uses it, and the job they're doing: engineers reviewing a prompt change before merge");
  writeFileSync(file, filled.replaceAll("(to fill in)", "filled"));
  await establish(dir, true);
  const after = readFileSync(file, "utf8");
  assert.match(after, /engineers reviewing a prompt change before merge/);
  assert.ok(!productUnfilled(after));
});

test("init adds the product section to a conventions file written before it existed", async () => {
  const dir = repo(AGENTDIFF_LIKE);
  await establish(dir);
  const file = path.join(dir, FILE);
  writeFileSync(file, readFileSync(file, "utf8").replace(/## product\n[\s\S]*?(?=\n## from the code)/, ""));
  const report = await establish(dir);
  assert.ok(report.drift.some((d) => d.startsWith("product:")), "a plain run says it's missing");
  await establish(dir, false, true);
  assert.match(readFileSync(file, "utf8"), /## product\n/);
});

test("the stop hook asks once for the product section while it's unfilled; once it's filled, a clean change is said once", async () => {
  const dir = repo(AGENTDIFF_LIKE);
  await establish(dir);
  writeFileSync(path.join(dir, "src/index.ts"), "export const run = () => 2;\n");
  const first = await stopHook(dir, "s1");
  assert.match(first && "block" in first ? first.block : "", /doesn't say yet who this product is for/);
  assert.equal(await stopHook(dir, "s1"), null, "once per session");

  const file = path.join(dir, FILE);
  writeFileSync(file, readFileSync(file, "utf8").replaceAll("(to fill in)", "filled"));
  const passed = await stopHook(dir, "s2");
  assert.match(passed && "pass" in passed ? passed.pass : "", /^skrub checked this change \(\d+ files?\): nothing to clean up\.$/);
  assert.equal(await stopHook(dir, "s2"), null, "said once per session");
});

test("every session starts knowing the conventions; until the product is filled in, filling it comes first", async () => {
  const { sessionContext } = await import("../src/agent/session.ts");
  const dir = repo(AGENTDIFF_LIKE);
  assert.equal(await sessionContext(dir), null, "no conventions yet, nothing to say");
  await establish(dir);
  assert.match((await sessionContext(dir)) ?? "", /isn't filled in yet\. Before anything else this session, fill each "\(to fill in\)" line/);

  const file = path.join(dir, FILE);
  writeFileSync(file, readFileSync(file, "utf8").replace(/- who uses it, and the job they're doing: \(to fill in\)/, "- who uses it, and the job they're doing: engineers reviewing a prompt change").replaceAll("(to fill in)", "filled"));
  const context = (await sessionContext(dir)) ?? "";
  assert.doesNotMatch(context, /isn't filled in/);
  assert.match(context, /- who uses it, and the job they're doing: engineers reviewing a prompt change/);
});

test("init installs the SessionStart hook next to the others, and running it again doesn't add a second", async () => {
  const { addSessionStartHook } = await import("../src/agent/install.ts");
  const dir = project({});
  const file = path.join(dir, ".claude/settings.json");
  writeFileSync(path.join(dir, "x"), "");
  await addSessionStartHook(file, "node skrub.mjs session");
  await addSessionStartHook(file, "node skrub.mjs session");
  const settings = JSON.parse(readFileSync(file, "utf8")) as { hooks: { SessionStart: { hooks: { command: string }[] }[] } };
  assert.deepEqual(settings.hooks.SessionStart.flatMap((g) => g.hooks.map((h) => h.command)), ["node skrub.mjs session"]);
});
