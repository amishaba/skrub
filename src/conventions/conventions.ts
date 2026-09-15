import { promises as fs } from "node:fs";
import path from "node:path";
import { Node, SyntaxKind, type SourceFile } from "ts-morph";
import { exists } from "../lib/fs.ts";
import { isEntry, isIncluded, type Program } from "../program/program.ts";
import { sharedExports, type Shared } from "../program/usage.ts";
import { listFiles } from "../git/git.ts";
import { NAMED_AFTER, PREFIXED, USE_PREFIX, booleanNames, componentFileName, endpointVerbs, hookNames, namedFunctions } from "./names.ts";

/**
 * A repo's conventions, read from its own code. Only what can be checked
 * mechanically goes in the frontmatter, and only when the code agrees with
 * itself (80% of at least 4 examples); everything else is described, not
 * enforced. The file's "notes" section is for rules a tool can't see, and
 * survives every rewrite.
 */

export const CONVENTIONS_FILE = ".claude/conventions.md";

export type Rules = Partial<Record<RuleKey, string>>;
type RuleKey =
  | "file-names"
  | "component-files"
  | "tests"
  | "test-suffix"
  | "exports"
  | "barrels"
  | "import-extensions"
  | "functions"
  | "boolean-names"
  | "endpoint-verbs"
  | "hook-names"
  | "component-names";

interface Observation {
  key: RuleKey;
  /** The majority value, or null when the code is mixed. */
  value: string | null;
  /** How many examples agree with the majority, out of how many. */
  agree: number;
  total: number;
  /** For mixed observations: the counts, for the description. */
  counts: Record<string, number>;
}

export interface Mined {
  observations: Observation[];
  /** Source files read (the config's include, `src` by default). */
  sources: number;
  /** Top-level folders under the source roots, as a hint about layout. */
  folders: string[];
  /** What other files already import most: the first place to look before writing something new. */
  shared: Shared[];
}

/** How many shared exports the file lists; it stays short enough to read every session. */
const SHARED_SHOWN = 10;

const LABEL: Record<RuleKey, string> = {
  "file-names": "file names",
  "component-files": "component (.tsx) file names",
  tests: "tests",
  "test-suffix": "test file suffix",
  exports: "exports",
  barrels: "barrel files",
  "import-extensions": "relative import extensions",
  functions: "exported functions",
  "boolean-names": "functions that return a boolean",
  "endpoint-verbs": "verb for functions that call an endpoint",
  "hook-names": "functions that call hooks",
  "component-names": "component files",
};

const TEST_FILE = /\.(test|spec)\.[cm]?[jt]sx?$/;
const TEST_DIR = /(^|\/)(tests?|__tests__|spec)\//;
const CODE = /\.[cm]?[jt]sx?$/;
const SKIP_DIR = /(^|\/)(node_modules|dist|build|out|coverage|\.next|\.skrub|fixtures?)\//;

export function mine(program: Program): Mined {
  const all = repoFiles(program).filter((f) => CODE.test(f) && !SKIP_DIR.test(f) && !f.endsWith(".d.ts"));
  const tests = all.filter((f) => TEST_FILE.test(f));
  const source = program.files.filter(({ rel }) => !TEST_FILE.test(rel) && !TEST_DIR.test(rel));

  const observations: Observation[] = [];
  const nameCases = (files: string[]) => files.map((f) => caseOf(stem(f))).filter((c): c is string => c != null);
  observations.push(majority("file-names", nameCases(all.filter((f) => !/\.[jt]sx$/.test(f) && !TEST_FILE.test(f)))));
  observations.push(majority("component-files", nameCases(all.filter((f) => /\.[jt]sx$/.test(f) && !TEST_FILE.test(f)))));
  observations.push(majority("tests", tests.map((f) => (TEST_DIR.test(f) ? "separate-folder" : "next-to-source"))));
  observations.push(majority("test-suffix", tests.map((f) => `.${TEST_FILE.exec(f)![1]}`)));

  const modules = source.filter(({ rel }) => !isEntry(rel, program.entries));
  observations.push(
    majority(
      "exports",
      modules.flatMap(({ sf }) => {
        if (isBarrel(sf)) return [];
        if (sf.getDefaultExportSymbol()) return ["default"];
        return sf.getExportSymbols().length > 0 ? ["named"] : [];
      }),
    ),
  );
  // No barrels in four files proves nothing; in forty it is a choice.
  const barrels = source.filter(({ sf }) => isBarrel(sf)).length;
  const barrelRule = barrels >= 2 ? "yes" : barrels === 0 && source.length >= 10 ? "no" : null;
  observations.push({ key: "barrels", value: barrelRule, agree: barrels, total: source.length, counts: { barrels } });
  observations.push(majority("import-extensions", source.flatMap(({ sf }) => relativeImports(sf).map((i) => extensionOf(i.getModuleSpecifierValue())).filter((e): e is string => e != null))));
  observations.push(majority("functions", source.flatMap(({ sf }) => exportedFunctions(sf).map(([, style]) => style))));

  // Naming habits: a rule only for the habit worth keeping (is/has, use…, named after), any majority verb.
  const fns = source.filter(({ rel }) => !TEST_FILE.test(rel)).flatMap(({ sf }) => namedFunctions(sf));
  observations.push(only(PREFIXED, majority("boolean-names", booleanNames(fns).map(([, v]) => v))));
  observations.push(majority("endpoint-verbs", endpointVerbs(fns).map(([, v]) => v)));
  observations.push(only(USE_PREFIX, majority("hook-names", hookNames(fns).map(([, v]) => v))));
  observations.push(
    only(NAMED_AFTER, majority("component-names", source.flatMap(({ sf, rel }) => componentFileName(sf, rel)?.value ?? []))),
  );

  // "src/detect/unused.ts" → "src/detect/": the second level is where layout shows
  const folders = [...new Set(source.map(({ rel }) => rel.split("/")).filter((p) => p.length >= 3).map((p) => `${p[0]}/${p[1]}/`))].sort();
  return { observations, folders, sources: source.length, shared: sharedExports(program).slice(0, SHARED_SHOWN) };
}

/** Keep the rule only if the majority is the habit worth enforcing; "most names lack a prefix" is no rule. */
function only(value: string, o: Observation): Observation {
  return o.value === value ? o : { ...o, value: null };
}

function majority(key: RuleKey, values: string[]): Observation {
  const counts: Record<string, number> = {};
  for (const v of values) counts[v] = (counts[v] ?? 0) + 1;
  const [top, agree] = Object.entries(counts).sort((a, b) => b[1] - a[1])[0] ?? [null, 0];
  const total = values.length;
  const value = total >= 4 && agree / total >= 0.8 ? top : null;
  return { key, value, agree, total, counts };
}

export function rulesFrom(mined: Mined): Rules {
  const rules: Rules = {};
  for (const f of mined.observations) if (f.value) rules[f.key] = f.value;
  return rules;
}

// ---- the file ----------------------------------------------------------------

export function renderConventions(mined: Mined, notes: string): string {
  const rules = rulesFrom(mined);
  const front = Object.entries(rules).map(([k, v]) => `${k}: ${v}`);
  const described = mined.observations.filter((f) => f.total > 0).map(describe);
  if (mined.folders.length > 0) described.push(`- layout: ${mined.folders.slice(0, 12).join(", ")}`);
  return [
    "---",
    ...front,
    "---",
    "",
    "# conventions",
    "",
    "The settings above are checked on every change by `skrub` and were read from this repo's own code; " +
      "`skrub conventions` shows drift, `--write` refreshes them. Follow them in new code.",
    "",
    "## from the code",
    "",
    ...described,
    "",
    ...sharedSection(mined.shared),
    "## notes",
    "",
    notes.trim() ||
      "<!-- Rules a tool can't check: domain words, where things go, what reviewers keep asking for. " +
        "When the user corrects how something was written and it should hold next time, add one line here. " +
        "Merge, don't append duplicates; keep this whole file under 60 lines. -->",
    "",
  ].join("\n");
}

const SHARED_HEADING = "## use these first";

/** The list of shared exports, as the file shows it; empty when nothing is imported by two files. */
function sharedSection(shared: Shared[]): string[] {
  if (!shared.length) return [];
  return [
    SHARED_HEADING,
    "",
    "Before writing a component, hook, API call or helper, check this list and extend one of these instead of writing a near-copy. " +
      "Read from what the code imports; `skrub conventions` refreshes it.",
    "",
    ...shared.map((x) => `- \`${x.name}\`: ${x.kind} in ${x.rel}, used by ${x.importers} files`),
    "",
  ];
}

/** `text` with its shared-exports section replaced by `shared` (added before the notes if it had none). */
export function withSharedSection(text: string, shared: Shared[]): string {
  const section = sharedSection(shared).join("\n");
  const at = text.indexOf(`\n${SHARED_HEADING}\n`);
  if (at >= 0) {
    const next = text.indexOf("\n## ", at + 1);
    return text.slice(0, at + 1) + section + (next >= 0 ? `${section ? "\n" : ""}${text.slice(next + 1)}` : "");
  }
  const notes = text.indexOf("\n## notes\n");
  return notes >= 0 && section ? `${text.slice(0, notes + 1)}${section}\n${text.slice(notes + 1)}` : text;
}

function describe(f: Observation): string {
  if (f.key === "barrels") {
    if (f.value === "yes") return `- barrel files: used (${f.agree}); import through them`;
    if (f.value === "no") return `- barrel files: none in ${f.total} files; don't add them`;
    return f.agree === 0 ? `- barrel files: none, but ${f.total} files is too few to call it a rule` : "- barrel files: one; not enforced";
  }
  if (f.value) return `- ${LABEL[f.key]}: ${f.value} (${f.agree} of ${f.total})`;
  if (f.total < 4) return `- ${LABEL[f.key]}: ${f.total} ${f.total === 1 ? "example" : "examples"}, too few to call it a rule`;
  const mix = Object.entries(f.counts).sort((a, b) => b[1] - a[1]).map(([v, n]) => `${n} ${v}`).join(", ");
  return `- ${LABEL[f.key]}: mixed (${mix}); not enforced`;
}

export async function readConventions(cwd: string): Promise<{ rules: Rules; notes: string } | null> {
  const file = path.join(cwd, CONVENTIONS_FILE);
  if (!(await exists(file))) return null;
  return parseConventions(await fs.readFile(file, "utf8"));
}

export function parseConventions(text: string): { rules: Rules; notes: string } {
  const rules: Rules = {};
  const front = /^---\n([\s\S]*?)\n---\n/.exec(text);
  for (const line of front?.[1]?.split("\n") ?? []) {
    const m = /^([a-z-]+):\s*(.+?)\s*$/.exec(line);
    if (m && m[1]! in LABEL) rules[m[1] as RuleKey] = m[2]!;
  }
  const notes = /\n## notes\n([\s\S]*)$/.exec(text)?.[1] ?? "";
  return { rules, notes };
}

// ---- checking new code ---------------------------------------------------------

interface Violation {
  file: string;
  line: number;
  key: RuleKey;
  message: string;
}

/**
 * What a change broke, given the recorded rules. `isNewFile` and `isAdded`
 * come from the diff: a file's name and place are checked only when the file
 * is new, and lines only when the diff wrote them.
 */
export function violations(
  program: Program,
  rules: Rules,
  isNewFile: (rel: string) => boolean,
  isAdded: (rel: string, line: number, text?: string) => boolean,
): Violation[] {
  const out: Violation[] = [];
  const say = (key: RuleKey, actual: string) => `${actual}; this repo's ${LABEL[key]}: ${rules[key]} (${CONVENTIONS_FILE}).`;

  for (const rel of repoFiles(program).filter((f) => CODE.test(f) && isNewFile(f) && !SKIP_DIR.test(f))) {
    const isTest = TEST_FILE.test(rel);
    const key: RuleKey = /\.[jt]sx$/.test(rel) && !isTest ? "component-files" : "file-names";
    const c = caseOf(stem(rel));
    if (rules[key] && c && c !== rules[key] && !isTest) out.push({ file: rel, line: 1, key, message: say(key, `"${path.basename(rel)}" is ${c}`) });
    if (isTest && rules.tests) {
      const where = TEST_DIR.test(rel) ? "separate-folder" : "next-to-source";
      if (where !== rules.tests) out.push({ file: rel, line: 1, key: "tests", message: say("tests", `this test is in a ${where === "separate-folder" ? "test folder" : "source folder"}`) });
    }
    if (isTest && rules["test-suffix"]) {
      const suffix = `.${TEST_FILE.exec(rel)![1]}`;
      if (suffix !== rules["test-suffix"]) out.push({ file: rel, line: 1, key: "test-suffix", message: say("test-suffix", `"${path.basename(rel)}" uses ${suffix}`) });
    }
  }

  for (const { sf, rel } of program.files) {
    if (TEST_FILE.test(rel)) continue;
    const added = (node: Node) => isAdded(rel, node.getStartLineNumber(), node.getText());
    if (rules.exports === "named" && !isEntry(rel, program.entries)) {
      for (const node of [...sf.getExportAssignments(), ...defaultExportDeclarations(sf)]) {
        if (added(node)) out.push({ file: rel, line: node.getStartLineNumber(), key: "exports", message: say("exports", "a default export") });
      }
    }
    if (rules["import-extensions"]) {
      for (const imp of relativeImports(sf)) {
        const ext = extensionOf(imp.getModuleSpecifierValue());
        if (ext && ext !== rules["import-extensions"] && added(imp)) {
          out.push({ file: rel, line: imp.getStartLineNumber(), key: "import-extensions", message: say("import-extensions", `"${imp.getModuleSpecifierValue()}" is ${ext === "none" ? "extensionless" : ext}`) });
        }
      }
    }
    const named = namedFunctions(sf).filter((f) => added(f.node));
    if (rules["boolean-names"])
      for (const [f, v] of booleanNames(named))
        if (v !== rules["boolean-names"]) out.push({ file: rel, line: f.node.getStartLineNumber(), key: "boolean-names", message: say("boolean-names", `"${f.name}" returns a boolean`) });
    if (rules["endpoint-verbs"])
      for (const [f, v] of endpointVerbs(named))
        if (v !== rules["endpoint-verbs"]) out.push({ file: rel, line: f.node.getStartLineNumber(), key: "endpoint-verbs", message: say("endpoint-verbs", `"${f.name}" calls an endpoint`) });
    if (rules["hook-names"])
      for (const [f, v] of hookNames(named))
        if (v !== rules["hook-names"]) out.push({ file: rel, line: f.node.getStartLineNumber(), key: "hook-names", message: say("hook-names", `"${f.name}" calls hooks`) });
    if (rules["component-names"] && isNewFile(rel)) {
      const c = componentFileName(sf, rel);
      if (c && c.value !== rules["component-names"]) out.push({ file: rel, line: 1, key: "component-names", message: say("component-names", `${c.name} is in "${path.basename(rel)}"`) });
    }
    if (rules.functions) {
      for (const [node, style] of exportedFunctions(sf)) {
        if (style !== rules.functions && added(node)) {
          out.push({ file: rel, line: node.getStartLineNumber(), key: "functions", message: say("functions", style === "arrows" ? "an exported arrow function" : "an exported function declaration") });
        }
      }
    }
  }
  return out;
}

// ---- reading code --------------------------------------------------------------

/**
 * The files this scan covers (the include roots), plus top-level test folders,
 * tracked or untracked. Another app in the same repo (a `web/` with its own
 * tsconfig) has its own conventions and isn't counted.
 */
function repoFiles(program: Program): string[] {
  const files = listFiles(program.cwd);
  if (!files) return program.files.map((f) => f.rel);
  return files.filter((f) => isIncluded(f, program.include) || /^(tests?|__tests__|spec)\//.test(f));
}

function stem(rel: string): string {
  return path.basename(rel).replace(TEST_FILE, "").replace(CODE, "");
}

/** The case of a multi-word name, or null when one word can't tell. */
export function caseOf(name: string): string | null {
  if (name === "index" || !/^[A-Za-z][A-Za-z0-9_.-]*$/.test(name)) return null;
  if (/^[a-z0-9]+(-[a-z0-9]+)+$/.test(name)) return "kebab-case";
  if (/^[a-z0-9]+(_[a-z0-9]+)+$/.test(name)) return "snake_case";
  if (/^[A-Z][a-z0-9]+([A-Z][a-z0-9]*)+$/.test(name)) return "PascalCase";
  if (/^[a-z][a-z0-9]*([A-Z][a-z0-9]*)+$/.test(name)) return "camelCase";
  if (/^[A-Z][a-z0-9]+$/.test(name)) return "PascalCase";
  return null;
}

function isBarrel(sf: SourceFile): boolean {
  if (!/^index\.[cm]?[jt]sx?$/.test(sf.getBaseName())) return false;
  const statements = sf.getStatements();
  return statements.length > 0 && statements.every((s) => Node.isExportDeclaration(s) && s.getModuleSpecifier() != null);
}

function relativeImports(sf: SourceFile) {
  return sf.getImportDeclarations().filter((i) => i.getModuleSpecifierValue().startsWith("."));
}

/** ".ts", ".js", "none" for code imports; null for assets (".css", ".json", …). */
function extensionOf(specifier: string): string | null {
  const ext = /\.([a-z]+)$/.exec(specifier)?.[1];
  if (!ext || specifier.endsWith("/")) return "none";
  if (["ts", "tsx", "mts", "cts"].includes(ext)) return ".ts";
  if (["js", "jsx", "mjs", "cjs"].includes(ext)) return ".js";
  return null;
}

function defaultExportDeclarations(sf: SourceFile): Node[] {
  return sf.getStatements().filter((s) => (Node.isFunctionDeclaration(s) || Node.isClassDeclaration(s)) && s.isDefaultExport());
}

function exportedFunctions(sf: SourceFile): [Node, "declarations" | "arrows"][] {
  const out: [Node, "declarations" | "arrows"][] = [];
  for (const s of sf.getStatements()) {
    if (Node.isFunctionDeclaration(s) && s.isExported() && !s.isDefaultExport()) out.push([s, "declarations"]);
    if (Node.isVariableStatement(s) && s.isExported()) {
      const init = s.getDeclarations()[0]?.getInitializer();
      if (init && (init.isKind(SyntaxKind.ArrowFunction) || init.isKind(SyntaxKind.FunctionExpression))) out.push([s, "arrows"]);
    }
  }
  return out;
}
