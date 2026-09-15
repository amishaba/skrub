import { Node, SyntaxKind, type FunctionDeclaration, type MethodDeclaration, type SourceFile } from "ts-morph";
import { type Hunk, slug } from "../hunk.ts";
import { lastLine, sliceLines } from "../lib/lines.ts";
import { isEntry, type Program } from "../program/program.ts";
import { nodeHunk } from "./node-hunk.ts";

const BARREL = /(?:^|\/)(?:index|utils|helpers)\.[cm]?[jt]sx?$/;

/** `flagBarrels: false` when the repo uses barrels on purpose (its conventions say so). */
export function glueHunks(program: Program, opts: { flagBarrels: boolean }): Hunk[] {
  const hunks: Hunk[] = [];
  for (const { sf, rel } of program.files) {
    if (isEntry(rel, program.entries)) continue;
    const text = sf.getFullText();
    if (BARREL.test(rel) && isBarrelOnly(sf)) {
      if (!opts.flagBarrels) continue;
      const endLine = lastLine(text);
      hunks.push({
        id: slug(["glue-barrel", rel]),
        file: rel,
        startLine: 1,
        endLine,
        kind: "glue",
        confidence: 0.8,
        reason: "Barrel/utils file that only re-exports.",
        text: sliceLines(text, 1, endLine) || text,
        safe: false,
        action: "delete",
      });
      continue;
    }
    for (const fn of functionsAndMethods(sf)) {
      if (!isPassThrough(fn)) continue;
      const name = fn.getName() ?? "anonymous";
      hunks.push(
        nodeHunk({
          sf,
          rel,
          node: fn,
          text,
          kind: "glue",
          confidence: 0.75,
          reason: `${name} only forwards to another function.`,
          safe: false,
          action: "delete",
        }),
      );
    }
  }
  return hunks;
}

function functionsAndMethods(sf: SourceFile): (FunctionDeclaration | MethodDeclaration)[] {
  return [
    ...sf.getFunctions(),
    ...sf.getDescendantsOfKind(SyntaxKind.MethodDeclaration),
  ];
}

function isBarrelOnly(sf: SourceFile): boolean {
  const stmts = sf.getStatements();
  if (stmts.length === 0) return false;
  return stmts.every((s) => {
    if (Node.isExportDeclaration(s) && s.getModuleSpecifier()) return true;
    if (Node.isImportDeclaration(s)) return true;
    return false;
  });
}

function isPassThrough(fn: FunctionDeclaration | MethodDeclaration): boolean {
  // `isKnown(id): id is Known` narrows the type at every call site; that is work, not forwarding.
  if (Node.isTypePredicate(fn.getReturnTypeNode())) return false;
  const body = fn.getBody();
  if (!body || !Node.isBlock(body)) return false;
  const stmts = body.getStatements();
  if (stmts.length !== 1) return false;
  const stmt = stmts[0]!;
  if (!Node.isReturnStatement(stmt)) return false;
  let expr = stmt.getExpression();
  if (!expr) return false;
  if (Node.isAwaitExpression(expr)) expr = expr.getExpression();
  if (!Node.isCallExpression(expr)) return false;
  const callee = expr.getExpression();
  if (callee.getText() === "super") return false;
  // A method called on a value names a lookup on that data: `get(id) { return
  // this.jobs.get(id); }`, `isKnown(id) { return KNOWN.includes(id); }`. Only a
  // plain function, or one reached through an import, is being forwarded to.
  if (Node.isPropertyAccessExpression(callee) && !isImported(callee.getExpression())) return false;
  const params = fn.getParameters().map((p) => p.getName());
  const args = expr.getArguments().map((a) => a.getText());
  if (params.length === 0 || params.length !== args.length) return false;
  return params.every((p, i) => args[i] === p);
}

/** `fs` in `fs.readFile(p)` when `fs` is an import: the call goes to another module's function. */
function isImported(node: Node): boolean {
  if (!Node.isIdentifier(node)) return false;
  return (node.getSymbol()?.getDeclarations() ?? []).some(
    (d) => Node.isNamespaceImport(d) || Node.isImportClause(d) || Node.isImportSpecifier(d),
  );
}
