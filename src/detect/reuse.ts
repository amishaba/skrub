import { Node, SyntaxKind, type SourceFile } from "ts-morph";
import type { Hunk } from "../hunk.ts";
import { type DiffScope, wasMoved } from "../git/diff.ts";
import type { Program } from "../program/program.ts";
import { HTTP_CALLEE, sharedExports, type Shared } from "../program/usage.ts";
import { nodeHunk } from "./node-hunk.ts";
import { shapes, similarity, type Shape } from "./similar.ts";

type IsNew = (rel: string, startLine: number, endLine: number) => boolean;

/** Similar enough to say "this is that, again". */
const NEAR_COPY = 0.7;
/** With names that overlap too, this much alike is worth a look. */
const NAMED_COPY = 0.4;

/**
 * What new code rewrote instead of reusing: a near-copy of an existing
 * function or component, a fetch of an endpoint another file already calls,
 * and a tailwind class list another component already owns. Notes only; which
 * one stays is a judgment call.
 */
export function reuseHunks(program: Program, isNew: IsNew | null, diff: DiffScope | null = null): Hunk[] {
  if (!isNew) return [];
  // Code the diff only moved or reformatted isn't a new copy of anything.
  const moved = (node: Node) => !!diff && wasMoved(diff, node.getText());
  return [...nearCopies(program, isNew, moved), ...repeatedEndpoints(program, isNew, moved), ...repeatedClasses(program, isNew, moved)];
}


function nearCopies(program: Program, isNew: IsNew, moved: (node: Node) => boolean): Hunk[] {
  const all = shapes(program);
  const fresh = (s: Shape) => isNew(s.rel, s.line, s.node.getSourceFile().getLineAndColumnAtPos(s.node.getEnd()).line);
  const existing = all.filter((s) => !fresh(s));
  const shared = sharedExports(program);
  const hunks: Hunk[] = [];
  const freshNodes = new Set(all.filter(fresh).map((s) => s.node));
  for (const s of all.filter(fresh)) {
    // Only the outermost new function: a callback inside a new component is part of it.
    if (s.node.getAncestors().some((a) => freshNodes.has(a)) || moved(s.node)) continue;
    let best: { other: Shape; score: number } | undefined;
    for (const other of existing) {
      const score = similarity(s, other);
      if (!best || score > best.score) best = { other, score };
    }
    // Identical bodies are dup's to report, as a deletion.
    if (!best || best.score >= 0.999) continue;
    const named = s.name ? overlapping(s.name, shared) : undefined;
    const sameThing = best.score >= NEAR_COPY || (named && named.rel === best.other.rel && best.score >= NAMED_COPY);
    if (!sameThing) continue;
    const pct = Math.round(best.score * 100);
    const what = best.other.name ? `${best.other.name} in ${best.other.rel}:${best.other.line}` : `${best.other.rel}:${best.other.line}`;
    const users = named && named.rel === best.other.rel ? `, which ${named.importers} files already use` : "";
    hunks.push(
      nodeHunk({
        sf: s.node.getSourceFile(),
        rel: s.rel,
        node: s.decl,
        text: s.node.getSourceFile().getFullText(),
        kind: "reuse",
        confidence: 0.4 + best.score / 4,
        reason: `${pct}% the same as ${what}${users}. Reuse or extend that one instead of keeping a second version.`,
        safe: false,
        action: "comment",
      }),
    );
  }
  return hunks;
}

/** A shared component or hook whose name is a whole word of `name`: `StatusDropdown` and `Dropdown`. */
export function overlapping(name: string, shared: Shared[]): Shared | undefined {
  const words = name.split(/(?=[A-Z])/);
  return shared.find(
    (s) => s.name !== name && s.name.length >= 5 && (s.kind === "component" || s.kind === "hook") && containsWords(words, s.name.split(/(?=[A-Z])/)),
  );
}

function containsWords(words: string[], part: string[]): boolean {
  for (let i = 0; i + part.length <= words.length; i++) if (part.every((w, j) => words[i + j]!.toLowerCase() === w.toLowerCase())) return true;
  return false;
}

// ---- endpoints ----------------------------------------------------------------

interface Call {
  sf: SourceFile;
  rel: string;
  node: Node;
  line: number;
  endpoint: string;
  /** The exported function this call is the body of, if it's a wrapper for the endpoint. */
  wrapper?: string;
}

function repeatedEndpoints(program: Program, isNew: IsNew, moved: (node: Node) => boolean): Hunk[] {
  const calls: Call[] = [];
  for (const { sf, rel } of program.files) calls.push(...endpointCalls(sf, rel));
  const hunks: Hunk[] = [];
  for (const c of calls) {
    if (!isNew(c.rel, c.line, c.line) || moved(c.node)) continue;
    const others = calls.filter((o) => o !== c && o.endpoint === c.endpoint && !isNew(o.rel, o.line, o.line));
    if (!others.length) continue;
    const wrapper = others.find((o) => o.wrapper);
    const where = others.slice(0, 2).map((o) => `${o.rel}:${o.line}`).join(" and ");
    const reason = wrapper
      ? `${wrapper.wrapper} in ${wrapper.rel}:${wrapper.line} already calls ${c.endpoint}. Call it instead of fetching here.`
      : `${c.endpoint} is also called in ${where}. Give it one typed function that every caller uses.`;
    hunks.push(
      nodeHunk({ sf: c.sf, rel: c.rel, node: c.node, text: c.sf.getFullText(), kind: "reuse", confidence: 0.55, reason, safe: false, action: "comment" }),
    );
  }
  return hunks;
}

function endpointCalls(sf: SourceFile, rel: string): Call[] {
  const out: Call[] = [];
  for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const callee = call.getExpression().getText();
    if (!HTTP_CALLEE.test(callee)) continue;
    const url = endpointOf(call.getArguments()[0]);
    if (!url) continue;
    const method = methodOf(callee, call.getArguments()[1]);
    const stmt = call.getFirstAncestor((a) => Node.isStatement(a)) ?? call;
    const fn = call.getFirstAncestor((a) => Node.isFunctionDeclaration(a) || Node.isArrowFunction(a) || Node.isFunctionExpression(a));
    out.push({ sf, rel, node: stmt, line: sf.getLineAndColumnAtPos(stmt.getStart()).line, endpoint: `${method} ${url}`, wrapper: fn ? wrapperName(fn) : undefined });
  }
  return out;
}

/** `/api/invoices/${id}?full=1` → `/api/invoices/:param`. Null for anything that isn't a path. */
function endpointOf(arg: Node | undefined): string | null {
  if (!arg) return null;
  let text: string;
  if (Node.isStringLiteral(arg) || Node.isNoSubstitutionTemplateLiteral(arg)) text = arg.getLiteralValue();
  else if (Node.isTemplateExpression(arg)) text = arg.getText().slice(1, -1).replace(/\$\{[^}]*\}/g, ":param");
  else return null;
  const path = text.replace(/^https?:\/\/[^/]+/, "").replace(/^:param(?=\/)/, "").split(/[?#]/)[0]!.replace(/\/+$/, "");
  return path.startsWith("/") && path.length > 1 ? path : null;
}

function methodOf(callee: string, options: Node | undefined): string {
  const fromCallee = /\.(get|post|put|patch|delete|head)$/.exec(callee)?.[1];
  if (fromCallee) return fromCallee.toUpperCase();
  if (options && Node.isObjectLiteralExpression(options)) {
    const m = options.getProperty("method");
    const init = m && Node.isPropertyAssignment(m) ? m.getInitializer() : undefined;
    if (init && Node.isStringLiteral(init)) return init.getLiteralValue().toUpperCase();
  }
  return "GET";
}

/** The exported function's name when it exists to make this call: short, not a component, and the call is in it. */
function wrapperName(fn: Node): string | undefined {
  const decl = Node.isFunctionDeclaration(fn) ? fn : fn.getFirstAncestorByKind(SyntaxKind.VariableDeclaration);
  if (!decl) return undefined;
  const exported = Node.isFunctionDeclaration(decl) ? decl.isExported() : decl.getVariableStatement()?.isExported();
  const name = decl.getName();
  if (!exported || !name || /^[A-Z]/.test(name)) return undefined;
  const body = Node.isFunctionDeclaration(fn) || Node.isArrowFunction(fn) || Node.isFunctionExpression(fn) ? fn.getBody() : undefined;
  if (!body) return undefined;
  return !Node.isBlock(body) || body.getStatements().length <= 4 ? name : undefined;
}

// ---- tailwind classes -------------------------------------------------------

interface ClassList {
  sf: SourceFile;
  rel: string;
  node: Node;
  line: number;
  key: string;
  component?: string;
}

/** Fewer classes than this repeat by accident (`flex items-center`). */
const MIN_CLASSES = 4;

function repeatedClasses(program: Program, isNew: IsNew, moved: (node: Node) => boolean): Hunk[] {
  const lists: ClassList[] = [];
  for (const { sf, rel } of program.files) if (/\.[jt]sx$/.test(rel)) lists.push(...classLists(sf, rel));
  const hunks: Hunk[] = [];
  // One note per component copied into a new place, at the first element that copies it.
  const said = new Set<string>();
  for (const c of lists) {
    if (!isNew(c.rel, c.line, c.line) || moved(c.node)) continue;
    const owner = lists.find((o) => o.key === c.key && !isNew(o.rel, o.line, o.line) && o.component && o.component !== c.component);
    if (!owner) continue;
    const pair = `${c.rel}#${c.component ?? ""}>${owner.rel}#${owner.component}`;
    if (said.has(pair)) continue;
    said.add(pair);
    hunks.push(
      nodeHunk({
        sf: c.sf,
        rel: c.rel,
        node: c.node,
        text: c.sf.getFullText(),
        kind: "reuse",
        confidence: 0.5,
        reason: `Same classes as <${owner.component}> in ${owner.rel}:${owner.line}. Use that component instead of copying its styles.`,
        safe: false,
        action: "comment",
      }),
    );
  }
  return hunks;
}

function classLists(sf: SourceFile, rel: string): ClassList[] {
  const out: ClassList[] = [];
  for (const attr of sf.getDescendantsOfKind(SyntaxKind.JsxAttribute)) {
    const name = attr.getNameNode().getText();
    if (name !== "className" && name !== "class") continue;
    const classes = classesOf(attr.getInitializer());
    if (classes.length < MIN_CLASSES) continue;
    const element = attr.getFirstAncestor((a) => Node.isJsxOpeningElement(a) || Node.isJsxSelfClosingElement(a)) ?? attr;
    out.push({
      sf,
      rel,
      node: element,
      line: sf.getLineAndColumnAtPos(element.getStart()).line,
      key: [...new Set(classes)].sort().join(" "),
      component: componentOf(attr),
    });
  }
  return out;
}

/** The class names in `className="…"`, `className={"…"}` or `className={cn("…", …)}`: the literal parts. */
function classesOf(init: Node | undefined): string[] {
  if (!init) return [];
  const literals = Node.isStringLiteral(init)
    ? [init]
    : init.getDescendants().filter((d) => Node.isStringLiteral(d) || Node.isNoSubstitutionTemplateLiteral(d));
  return literals.flatMap((l) => (l as unknown as { getLiteralValue(): string }).getLiteralValue().split(/\s+/)).filter(Boolean);
}

/** The PascalCase function the JSX is in: the component that owns these classes. */
function componentOf(node: Node): string | undefined {
  for (const fn of node.getAncestors()) {
    if (Node.isFunctionDeclaration(fn) && /^[A-Z]/.test(fn.getName() ?? "")) return fn.getName();
    if (Node.isArrowFunction(fn) || Node.isFunctionExpression(fn)) {
      const v = fn.getFirstAncestorByKind(SyntaxKind.VariableDeclaration);
      if (v && /^[A-Z]/.test(v.getName())) return v.getName();
    }
  }
  return undefined;
}
