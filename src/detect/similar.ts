import { Node, SyntaxKind, type SourceFile } from "ts-morph";
import type { Program } from "../program/program.ts";

/** A function or component, reduced to what it does so near-copies can be compared. */
export interface Shape {
  node: Node;
  /** The statement to point at: `const f = () => …` rather than the arrow. */
  decl: Node;
  name: string | undefined;
  rel: string;
  line: number;
  grams: Set<string>;
}

const GRAM = 4;
/** Shorter than this, two functions look alike by accident. */
const MIN_TOKENS = 40;

/** Every function and component in the scanned files worth comparing, with its shape. */
export function shapes(program: Program): Shape[] {
  const out: Shape[] = [];
  for (const { sf, rel } of program.files) out.push(...shapesIn(sf, rel));
  return out;
}

export function shapesIn(sf: SourceFile, rel: string): Shape[] {
  const out: Shape[] = [];
  const fns = [
    ...sf.getFunctions(),
    ...sf.getDescendantsOfKind(SyntaxKind.FunctionExpression),
    ...sf.getDescendantsOfKind(SyntaxKind.ArrowFunction),
  ];
  for (const fn of fns) {
    const tokens = tokensOf(fn);
    if (tokens.length < MIN_TOKENS) continue;
    const grams = new Set<string>();
    for (let i = 0; i + GRAM <= tokens.length; i++) grams.add(tokens.slice(i, i + GRAM).join(" "));
    const decl = declarationOf(fn);
    out.push({ node: fn, decl, name: nameOf(decl), rel, line: sf.getLineAndColumnAtPos(decl.getStart()).line, grams });
  }
  return out;
}

/** How much of two shapes is the same, 0 to 1. */
export function similarity(a: Shape, b: Shape): number {
  if (!a.grams.size || !b.grams.size) return 0;
  let both = 0;
  for (const g of a.grams) if (b.grams.has(g)) both++;
  return both / (a.grams.size + b.grams.size - both);
}

/**
 * The function's tokens with its own parameters and locals renamed by order
 * of first use, and string, number and JSX text replaced by their kind. Names
 * from outside stay (imports, properties, JSX tags), so two bodies only match
 * if they do the same thing with the same things.
 */
function tokensOf(fn: Node): string[] {
  const lo = fn.getStart();
  const hi = fn.getEnd();
  const own = new Map<string, string>();
  const out: string[] = [];
  const walk = (n: Node) => {
    const kids = n.getChildren();
    if (kids.length) {
      for (const k of kids) walk(k);
      return;
    }
    const kind = n.getKind();
    if (kind === SyntaxKind.Identifier) {
      const decl = n.getSymbol()?.getDeclarations()[0];
      const local = decl && decl.getSourceFile() === fn.getSourceFile() && decl.getStart() >= lo && decl.getEnd() <= hi;
      if (local) {
        const name = n.getText();
        if (!own.has(name)) own.set(name, `$${own.size}`);
        out.push(own.get(name)!);
      } else out.push(n.getText());
    } else if (
      kind === SyntaxKind.StringLiteral ||
      kind === SyntaxKind.NoSubstitutionTemplateLiteral ||
      kind === SyntaxKind.TemplateHead ||
      kind === SyntaxKind.TemplateMiddle ||
      kind === SyntaxKind.TemplateTail
    )
      out.push("S");
    else if (kind === SyntaxKind.NumericLiteral) out.push("N");
    else if (kind === SyntaxKind.JsxText || kind === SyntaxKind.JsxTextAllWhiteSpaces) {
      if (n.getText().trim()) out.push("T");
    } else if (kind !== SyntaxKind.EndOfFileToken) out.push(n.getText());
  };
  walk(fn);
  return out;
}

function declarationOf(fn: Node): Node {
  if (Node.isFunctionDeclaration(fn)) return fn;
  const stmt = fn.getFirstAncestorByKind(SyntaxKind.VariableStatement);
  const only = stmt?.getDeclarations().length === 1 ? stmt.getDeclarations()[0] : undefined;
  if (stmt && only && (only.getInitializer() === fn || only.getInitializer()?.getDescendants().includes(fn) === true))
    return only.getInitializer() === fn || isWrapped(only.getInitializer()!, fn) ? stmt : fn;
  return fn;
}

/** `memo(() => …)` or `forwardRef(function … )`: the component is still the whole statement. */
function isWrapped(init: Node, fn: Node): boolean {
  return Node.isCallExpression(init) && init.getArguments().includes(fn as never);
}

function nameOf(decl: Node): string | undefined {
  if (Node.isFunctionDeclaration(decl)) return decl.getName();
  if (Node.isVariableStatement(decl)) return decl.getDeclarations()[0]?.getName();
  return undefined;
}
