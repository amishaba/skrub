import { createHash } from "node:crypto";
import { Node, SyntaxKind } from "ts-morph";
import type { Hunk } from "../hunk.ts";
import { nodeHunk } from "./node-hunk.ts";
import type { Program } from "../program/program.ts";

type Fn = import("ts-morph").FunctionDeclaration | import("ts-morph").FunctionExpression | import("ts-morph").ArrowFunction;
type IsNew = (rel: string, startLine: number, endLine: number) => boolean;

interface Copy {
  rel: string;
  node: Fn;
  text: string;
  isNew: boolean;
}

/**
 * A function the diff added whose body already exists in code the diff didn't
 * touch: same statements, with its own parameters and locals renamed. Agents
 * write `sortRows(rows, key)` without noticing `sortBy(items, field)`.
 */
export function dupHunks(program: Program, isNew: IsNew | null): Hunk[] {
  if (!isNew) return [];

  const byShape = new Map<string, Copy[]>();
  for (const { sf, rel } of program.files) {
    const text = sf.getFullText();
    const fns: Fn[] = [
      ...sf.getFunctions(),
      ...sf.getDescendantsOfKind(SyntaxKind.FunctionExpression),
      ...sf.getDescendantsOfKind(SyntaxKind.ArrowFunction),
    ];
    for (const fn of fns) {
      const body = fn.getBody();
      if (!body || body.getText().length < 80) continue;
      const start = sf.getLineAndColumnAtPos(fn.getStart()).line;
      const end = sf.getLineAndColumnAtPos(fn.getEnd()).line;
      const key = createHash("sha1").update(shape(fn)).digest("hex");
      const list = byShape.get(key) ?? [];
      list.push({ rel, node: fn, text, isNew: isNew(rel, start, end) });
      byShape.set(key, list);
    }
  }

  const hunks: Hunk[] = [];
  for (const copies of byShape.values()) {
    const original = copies.find((c) => !c.isNew);
    if (!original) continue;
    for (const c of copies.filter((c) => c.isNew)) {
      const sf = c.node.getSourceFile();
      const target = declaration(c.node);
      hunks.push(
        nodeHunk({
          sf,
          rel: c.rel,
          node: target,
          text: c.text,
          kind: "dup",
          confidence: 0.7,
          reason: `Same as ${describe(original)}. Use that one instead.`,
          safe: false,
          action: "delete",
        }),
      );
    }
  }
  return hunks;
}

/**
 * The body with whitespace collapsed and every identifier declared inside the
 * function (parameters, locals) replaced by its order of first appearance.
 * Names from outside — properties, imports, globals — stay, so two bodies
 * only match if they do the same thing to the same things.
 */
function shape(fn: Fn): string {
  const body = fn.getBody()!;
  const base = body.getStart();
  const lo = fn.getStart();
  const hi = fn.getEnd();
  const names = new Map<string, string>();
  const edits: [number, number, string][] = [];
  for (const id of body.getDescendantsOfKind(SyntaxKind.Identifier)) {
    const decl = id.getSymbol()?.getDeclarations()[0];
    if (!decl || decl.getSourceFile() !== fn.getSourceFile()) continue;
    if (decl.getStart() < lo || decl.getEnd() > hi) continue;
    const name = id.getText();
    if (!names.has(name)) names.set(name, `$${names.size}`);
    edits.push([id.getStart() - base, id.getEnd() - base, names.get(name)!]);
  }
  let src = body.getText();
  for (const [a, b, r] of edits.sort((x, y) => y[0] - x[0])) src = src.slice(0, a) + r + src.slice(b);
  return src.replace(/\s+/g, " ").trim();
}

/** The whole statement to delete: `const f = () => …` rather than just the arrow. */
function declaration(fn: Fn): Node {
  if (Node.isFunctionDeclaration(fn)) return fn;
  const stmt = fn.getFirstAncestorByKind(SyntaxKind.VariableStatement);
  if (stmt && stmt.getDeclarations().length === 1 && stmt.getDeclarations()[0]!.getInitializer() === fn) return stmt;
  return fn;
}

function describe(c: Copy): string {
  const line = c.node.getSourceFile().getLineAndColumnAtPos(c.node.getStart()).line;
  const name = Node.isFunctionDeclaration(c.node)
    ? c.node.getName()
    : c.node.getFirstAncestorByKind(SyntaxKind.VariableDeclaration)?.getName();
  return name ? `${name} in ${c.rel}:${line}` : `the function at ${c.rel}:${line}`;
}
