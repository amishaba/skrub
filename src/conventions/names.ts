// How a repo names things, read from its code: the habits behind the naming
// rules in conventions.md. Each returns one value per example, for the 80%
// majority to settle.
import path from "node:path";
import { Node, SyntaxKind, type SourceFile } from "ts-morph";
import { callsEndpoint, rendersJsx } from "../program/usage.ts";

/** A named function: a top-level declaration, or `const f = () => …`. */
interface NamedFn {
  /** The statement, for its line and text. */
  node: Node;
  fn: Node;
  name: string;
}

export function namedFunctions(sf: SourceFile): NamedFn[] {
  const out: NamedFn[] = [];
  for (const f of sf.getFunctions()) {
    const name = f.getName();
    if (name) out.push({ node: f, fn: f, name });
  }
  for (const st of sf.getVariableStatements())
    for (const d of st.getDeclarations()) {
      const init = d.getInitializer();
      if (init && (Node.isArrowFunction(init) || Node.isFunctionExpression(init))) out.push({ node: st, fn: init, name: d.getName() });
    }
  return out;
}

const BOOLEAN_PREFIX = /^(is|has|have|can|should|was|were|will|did|does|needs?|allows?|supports?|includes|contains)[A-Z0-9_]/;
export const PREFIXED = "is/has prefix";
export const USE_PREFIX = "use prefix";
export const NAMED_AFTER = "named after the component";

const isComponentName = (name: string) => /^[A-Z]/.test(name);

/** A function that returns `boolean` (not a promise of one). */
function returnsBoolean(fn: Node): boolean {
  if (!(Node.isFunctionDeclaration(fn) || Node.isArrowFunction(fn) || Node.isFunctionExpression(fn))) return false;
  return fn.getReturnType().isBoolean();
}

function callsHooks(fn: Node): boolean {
  return fn.getDescendantsOfKind(SyntaxKind.CallExpression).some((c) => /^use[A-Z]/.test(c.getExpression().getText()));
}

const VERBS = new Set(["get", "fetch", "load", "read", "list", "find", "query", "post", "put", "patch", "create", "update", "delete", "remove", "save", "send", "submit", "request", "call"]);

/** `fetchInvoices` → `fetch`; null when the name doesn't start with a verb (`appFetch`). */
function verbOf(name: string): string | null {
  const word = /^([a-z]+)[A-Z0-9_]/.exec(name)?.[1];
  return word && VERBS.has(word) ? word : null;
}

/** Functions returning a boolean: is/has-prefixed or not. */
export function booleanNames(fns: NamedFn[]): [NamedFn, string][] {
  return fns.filter((f) => !isComponentName(f.name) && returnsBoolean(f.fn)).map((f) => [f, BOOLEAN_PREFIX.test(f.name) ? PREFIXED : "other"]);
}

/** Functions that call an HTTP endpoint: the verb they start with. */
export function endpointVerbs(fns: NamedFn[]): [NamedFn, string][] {
  return fns
    .filter((f) => !isComponentName(f.name) && !/^use[A-Z]/.test(f.name) && callsEndpoint(f.fn))
    .flatMap((f) => {
      const verb = verbOf(f.name);
      return verb ? [[f, verb] as [NamedFn, string]] : [];
    });
}

/** Functions (not components) that call React hooks: use-prefixed or not. */
export function hookNames(fns: NamedFn[]): [NamedFn, string][] {
  return fns.filter((f) => !isComponentName(f.name) && callsHooks(f.fn)).map((f) => [f, /^use[A-Z]/.test(f.name) ? USE_PREFIX : "other"]);
}

/** A .tsx/.jsx file exporting one component: named after it, or not. Null for anything else. */
export function componentFileName(sf: SourceFile, rel: string): { name: string; value: string } | null {
  if (!/\.[jt]sx$/.test(rel) || /^index\./.test(path.basename(rel))) return null;
  const components = namedFunctions(sf).filter((f) => isComponentName(f.name) && isExported(f.node) && rendersJsx(f.fn));
  if (components.length !== 1) return null;
  const flat = (s: string) => s.toLowerCase().replace(/[-_.]/g, "");
  const stem = path.basename(rel).replace(/\.[^.]+$/, "");
  return { name: components[0]!.name, value: flat(stem) === flat(components[0]!.name) ? NAMED_AFTER : "other" };
}

function isExported(node: Node): boolean {
  return (Node.isFunctionDeclaration(node) || Node.isVariableStatement(node)) && node.isExported();
}
