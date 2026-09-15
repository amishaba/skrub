import path from "node:path";
import { Node, SyntaxKind, type SourceFile } from "ts-morph";
import type { Program } from "./program.ts";

/** What a shared export is, as an agent would go looking for one. */
type SharedKind = "component" | "hook" | "api call" | "helper";

/** An export other files already lean on: the first place to look before writing a new one. */
export interface Shared {
  name: string;
  rel: string;
  line: number;
  kind: SharedKind;
  /** Files that import it, not counting its own. */
  importers: number;
}

/** `rel#name` → the files that import that name from that file. Type-only imports count only with `types`. */
export function importers(program: Program, opts: { types?: boolean } = {}): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const sf of program.project.getSourceFiles()) {
    const from = rel(program, sf);
    if (from.includes("node_modules/")) continue;
    for (const decl of sf.getImportDeclarations()) {
      if (decl.isTypeOnly() && !opts.types) continue;
      const target = decl.getModuleSpecifierSourceFile();
      if (!target || target === sf) continue;
      const to = rel(program, target);
      const names = [
        ...decl.getNamedImports().filter((n) => opts.types || !n.isTypeOnly()).map((n) => n.getName()),
        ...(decl.getDefaultImport() ? ["default"] : []),
      ];
      for (const name of names) {
        const key = `${to}#${name}`;
        const set = out.get(key) ?? new Set<string>();
        set.add(from);
        out.set(key, set);
      }
    }
  }
  return out;
}

/** Functions, components, hooks and classes two or more files import, most used first. */
export function sharedExports(program: Program, min = 2): Shared[] {
  const used = importers(program);
  const out: Shared[] = [];
  for (const { sf, rel: file } of program.files) {
    for (const [name, decls] of sf.getExportedDeclarations()) {
      const count = used.get(`${file}#${name}`)?.size ?? 0;
      if (count < min) continue;
      const decl = decls.find((d) => d.getSourceFile() === sf);
      const kind = decl && kindOf(name === "default" ? nameOf(decl) ?? name : name, decl);
      if (!kind) continue;
      out.push({
        name: name === "default" ? (nameOf(decl!) ?? path.basename(file).replace(/\.[^.]+$/, "")) : name,
        rel: file,
        line: sf.getLineAndColumnAtPos(decl!.getStart()).line,
        kind,
        importers: count,
      });
    }
  }
  return out.sort((a, b) => b.importers - a.importers || a.name.localeCompare(b.name));
}

/** The function behind a declaration: itself, or the arrow/function a `const` holds. */
function functionOf(decl: Node): Node | undefined {
  if (Node.isFunctionDeclaration(decl) || Node.isClassDeclaration(decl)) return decl;
  if (Node.isVariableDeclaration(decl)) {
    const init = decl.getInitializer();
    if (init && (Node.isArrowFunction(init) || Node.isFunctionExpression(init))) return init;
    // forwardRef(...), memo(...): the component is the function passed in.
    if (init && Node.isCallExpression(init) && /(^|\.)(memo|forwardRef|observer|lazy)$/.test(init.getExpression().getText()))
      return init.getArguments().find((a) => Node.isArrowFunction(a) || Node.isFunctionExpression(a));
  }
  return undefined;
}

function kindOf(name: string, decl: Node): SharedKind | undefined {
  const fn = functionOf(decl);
  if (!fn) return undefined;
  if (/^use[A-Z]/.test(name)) return "hook";
  if (/^[A-Z]/.test(name) && rendersJsx(fn)) return "component";
  if (Node.isClassDeclaration(fn)) return "helper";
  if (callsEndpoint(fn)) return "api call";
  return "helper";
}

function nameOf(decl: Node): string | undefined {
  if (Node.isFunctionDeclaration(decl) || Node.isClassDeclaration(decl)) return decl.getName();
  if (Node.isVariableDeclaration(decl)) return decl.getName();
  return undefined;
}

export function rendersJsx(node: Node): boolean {
  return (
    node.getFirstDescendantByKind(SyntaxKind.JsxElement) != null ||
    node.getFirstDescendantByKind(SyntaxKind.JsxSelfClosingElement) != null ||
    node.getFirstDescendantByKind(SyntaxKind.JsxFragment) != null
  );
}

/** Calls that reach an HTTP endpoint: fetch, axios and the like, given a URL as text. */
export const HTTP_CALLEE = /^(fetch|\$fetch|ky|got|axios|request|http|api|client)(\.(get|post|put|patch|delete|head|request))?$/;

export function callsEndpoint(fn: Node): boolean {
  return fn.getDescendantsOfKind(SyntaxKind.CallExpression).some((c) => HTTP_CALLEE.test(c.getExpression().getText()));
}

function rel(program: Program, sf: SourceFile): string {
  return path.relative(program.cwd, sf.getFilePath()).split(path.sep).join("/");
}
