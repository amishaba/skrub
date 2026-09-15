import path from "node:path";
import { Node, SyntaxKind, ts, type ExportDeclaration, type ExportSpecifier, type SourceFile } from "ts-morph";
import { type Hunk, slug } from "../hunk.ts";
import { lastLine, offsetAt, sliceLines } from "../lib/lines.ts";
import type { KnipExport, KnipResult } from "../knip/knip.ts";
import { nodeHunk } from "./node-hunk.ts";
import { isEntry, type Program } from "../program/program.ts";

/**
 * Dead code, as knip finds it: unused files, and exports and types nothing
 * else imports. knip decides what is unused; this only turns each finding
 * into an edit. An export its own file still uses keeps its declaration and
 * loses the `export`. Unused imports are skrub's own: knip doesn't report them.
 */
export function unusedHunks(program: Program, knip: KnipResult): Hunk[] {
  const hunks: Hunk[] = [];
  const options = program.project.getCompilerOptions();
  const declarationEmit = !!(options.declaration || options.composite);
  const jsxFactory = classicJsxFactory(options);
  const started = startedByEntries(program);
  for (const { sf, rel } of program.files) {
    if (isEntry(rel, program.entries)) {
      hunks.push(...importHunks(sf, rel, jsxFactory));
      continue;
    }
    // Tool configs are loaded by name, and the config's entries start what they import; knip knows neither.
    if (knip.files.has(rel) && !CONFIG_FILE.test(rel) && !started.has(sf.getFilePath())) {
      hunks.push(unusedFileHunk(sf, rel));
      continue;
    }
    hunks.push(...importHunks(sf, rel, jsxFactory));
    const unused = knip.exports.get(rel);
    if (unused?.length) hunks.push(...exportHunks(sf, rel, unused, declarationEmit));
  }
  return hunks;
}

const CONFIG_FILE = /(^|\/)[^/]+\.config\.[cm]?[jt]sx?$/;

/**
 * Files the config's entries reach through static and `import()` imports. knip
 * finds its own entries; the ones a user lists for skrub (scripts run by path,
 * framework files) only skrub knows about.
 */
function startedByEntries(program: Program): Set<string> {
  const seen = new Set<string>();
  const queue = program.project.getSourceFiles().filter((sf) => isEntry(posix(program.cwd, sf.getFilePath()), program.entries));
  while (queue.length) {
    const sf = queue.pop()!;
    if (seen.has(sf.getFilePath())) continue;
    seen.add(sf.getFilePath());
    for (const decl of [...sf.getImportDeclarations(), ...sf.getExportDeclarations()]) {
      const target = decl.getModuleSpecifierSourceFile();
      if (target) queue.push(target);
    }
    for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      if (call.getExpression().getKind() !== SyntaxKind.ImportKeyword) continue;
      const arg = call.getArguments()[0];
      const target = arg && Node.isStringLiteral(arg) ? arg.getSymbol()?.getDeclarations()[0]?.getSourceFile() : undefined;
      if (target) queue.push(target);
    }
  }
  return seen;
}

function posix(cwd: string, abs: string): string {
  return path.relative(cwd, abs).split(path.sep).join("/");
}

/** With the classic JSX runtime, every element calls `React.createElement` (or the configured factory), so that import is in use. */
function classicJsxFactory(options: ts.CompilerOptions): string | null {
  if (options.jsxFactory) return options.jsxFactory.split(".")[0]!;
  return options.jsx === ts.JsxEmit.React ? "React" : null;
}

function importHunks(sf: SourceFile, rel: string, jsxFactory: string | null): Hunk[] {
  const hunks: Hunk[] = [];
  const text = sf.getFullText();
  const hasJsx = jsxFactory != null && /\.[jt]sx$/.test(rel);
  for (const imp of sf.getImportDeclarations()) {
    if (!imp.getImportClause()) continue;
    const names = importedIds(imp);
    if (names.length === 0) continue;
    if (hasJsx && names.some((id) => id.getText() === jsxFactory)) continue;
    if (names.some((id) => isReadInFile(id))) continue;
    hunks.push(
      nodeHunk({
        sf,
        rel,
        node: imp,
        text,
        kind: "unused_import",
        confidence: 0.95,
        reason: `Unused import from ${imp.getModuleSpecifierValue()}.`,
        safe: true,
        action: "delete",
        symbols: names.map((id) => id.getText()),
      }),
    );
  }
  return hunks;
}

function importedIds(imp: ReturnType<SourceFile["getImportDeclarations"]>[number]) {
  const ids = [];
  const d = imp.getDefaultImport();
  if (d) ids.push(d);
  const ns = imp.getNamespaceImport();
  if (ns) ids.push(ns);
  for (const n of imp.getNamedImports()) ids.push(n.getAliasNode() ?? n.getNameNode());
  return ids;
}

/** Whether the file reads this imported name: an identifier outside the imports that is the same symbol, not a local that shadows it. */
function isReadInFile(id: Node): boolean {
  if (!Node.isIdentifier(id)) return true;
  const symbol = id.getSymbol();
  if (!symbol) return true;
  const local = id.getText();
  return id
    .getSourceFile()
    .getDescendantsOfKind(SyntaxKind.Identifier)
    .some((n) => {
      if (n === id || n.getText() !== local || n.getFirstAncestor(Node.isImportDeclaration)) return false;
      // `{ foo }` and `export { foo }` name the import through a symbol of their own; they still read it.
      const p = n.getParent();
      if (p && (Node.isShorthandPropertyAssignment(p) || Node.isExportSpecifier(p))) return true;
      return n.getSymbol() === symbol;
    });
}

/**
 * One edit per unused export. knip points at the name it saw: a name in an
 * `export { … }` list is taken out of the list (the whole statement goes when
 * nothing in it is left); a declaration with its own `export` keyword is
 * deleted, or keeps everything but the keyword if its file still uses it.
 */
function exportHunks(sf: SourceFile, rel: string, unused: KnipExport[], declarationEmit: boolean): Hunk[] {
  const text = sf.getFullText();
  const hunks: Hunk[] = [];
  const lists = new Map<ExportDeclaration, ExportSpecifier[]>();
  const declared = new Set<string>();

  for (const item of unused) {
    const at = sf.getDescendantAtPos(item.pos);
    const spec = at?.getFirstAncestorByKind(SyntaxKind.ExportSpecifier);
    if (spec) {
      const decl = spec.getExportDeclaration();
      lists.set(decl, [...(lists.get(decl) ?? []), spec]);
    } else declared.add(item.name);
  }

  for (const name of declared) hunks.push(...declarationHunks(sf, rel, name, text, declarationEmit));
  for (const [decl, specs] of lists) hunks.push(...listHunks(sf, rel, decl, specs, text));
  return hunks;
}

/** An export declared with its own `export` keyword, or a default export with what it names. */
function declarationHunks(sf: SourceFile, rel: string, name: string, text: string, declarationEmit: boolean): Hunk[] {
  const decls = (sf.getExportedDeclarations().get(name) ?? []).filter((d) => !Node.isSourceFile(d) && d.getSourceFile() === sf);
  if (decls.length === 0) return [];
  const uses = decls.map((d) => usesOf(d, null));
  if (uses.includes("elsewhere")) return [];
  if (uses.includes("here")) {
    // A value only read in types (a schema behind `z.infer<typeof Schema>`) stays exported: unexported, linters call it unused.
    if (decls.length === 1 && onlyReadInTypes(decls[0]!)) return [];
    const edit = decls.length === 1 ? needlessExportHunk(sf, rel, decls[0]!, name, declarationEmit) : null;
    return edit ? [edit] : [];
  }

  const nodes: Node[] = [];
  for (const d of decls) {
    const n = Node.isVariableDeclaration(d) ? d.getVariableStatement() : d;
    if (n) nodes.push(n);
  }
  if (nodes.some((n) => Node.isVariableStatement(n) && n.getDeclarations().length !== 1)) return [];
  if (name === "default") nodes.push(...sf.getExportAssignments());
  if (!nodes.every((n) => ownsLines(sf, n))) return [];
  return contiguousRanges(sf, nodes).map((range): Hunk => ({
    id: slug(["unused-export", rel, String(range.start), name]),
    file: rel,
    startLine: range.start,
    endLine: range.end,
    kind: "unused_export",
    confidence: 0.85,
    reason: `Exported ${name} is never referenced.`,
    text: sliceLines(text, range.start, range.end),
    safe: true,
    action: "delete",
    symbols: [name],
  }));
}

/**
 * Names taken out of one `export { … }` list. A local declaration the list
 * exported goes too, when nothing else in its file uses it.
 */
function listHunks(sf: SourceFile, rel: string, decl: ExportDeclaration, specs: ExportSpecifier[], text: string): Hunk[] {
  if (!ownsLines(sf, decl)) return [];
  const names = specs.map((s) => s.getAliasNode()?.getText() ?? s.getName());
  const all = specs.length === decl.getNamedExports().length;
  const reexport = decl.hasModuleSpecifier();
  const start = sf.getLineAndColumnAtPos(decl.getStart(true)).line;
  const end = sf.getLineAndColumnAtPos(decl.getEnd()).line;
  const lines = sliceLines(text, start, end);
  const out: Hunk[] = [
    {
      id: slug(["unused-export", rel, String(start), ...names]),
      file: rel,
      startLine: start,
      endLine: end,
      kind: reexport || all ? "unused_export" : "needless_export",
      confidence: 0.85,
      reason: `${names.join(", ")} ${names.length === 1 ? "is" : "are"} never referenced${all ? "" : `; drop ${names.length === 1 ? "it" : "them"} from the export list`}.`,
      text: lines,
      ...(all ? {} : { replacement: withoutSpecifiers(lines, offsetAt(text, start), specs) }),
      safe: true,
      action: "delete",
      symbols: names,
    },
  ];
  if (reexport) return out;

  for (const spec of specs) {
    const local = spec.getLocalTargetDeclarations().filter((d) => d.getSourceFile() === sf);
    if (local.length !== 1) continue;
    const target = local[0]!;
    if (usesOf(target, decl) !== "nowhere") continue;
    const node = Node.isVariableDeclaration(target) ? target.getVariableStatement() : target;
    if (!node || (Node.isVariableStatement(node) && node.getDeclarations().length !== 1) || !ownsLines(sf, node)) continue;
    const s = sf.getLineAndColumnAtPos(node.getStart(true)).line;
    const e = sf.getLineAndColumnAtPos(node.getEnd()).line;
    if (s <= end && e >= start) continue;
    const name = spec.getName();
    out.push({
      id: slug(["unused-export", rel, String(s), name]),
      file: rel,
      startLine: s,
      endLine: e,
      kind: "unused_export",
      confidence: 0.85,
      reason: `${name} is only exported, and never referenced.`,
      text: sliceLines(text, s, e),
      safe: true,
      action: "delete",
      symbols: [name],
    });
  }
  return out;
}

/** The statement's lines with these specifiers (and a comma each) cut out. */
function withoutSpecifiers(lines: string, base: number, specs: ExportSpecifier[]): string {
  let out = lines;
  for (const spec of [...specs].sort((a, b) => b.getStart() - a.getStart())) {
    let from = spec.getStart() - base;
    let to = spec.getEnd() - base;
    const lineStart = out.lastIndexOf("\n", from - 1) + 1;
    const ownLine = /^[ \t]*$/.exec(out.slice(lineStart, from)) && /^[ \t]*,?[ \t]*\n/.exec(out.slice(to));
    if (ownLine) {
      // Alone on its line: the line goes, and a trailing comma on the line above stays valid.
      from = lineStart;
      to += /^[ \t]*,?[ \t]*\n/.exec(out.slice(to))![0].length;
    } else {
      const after = /^\s*,[ \t]*/.exec(out.slice(to));
      if (after) to += after[0].length;
      else {
        const before = /,\s*$/.exec(out.slice(0, from));
        if (before) from -= before[0].length;
      }
    }
    out = out.slice(0, from) + out.slice(to);
  }
  return out;
}

/** Where a declaration is used: from another file, only from its own, or nowhere. Mentions inside `ignore` (its own export list) don't count. */
function usesOf(decl: Node, ignore: Node | null): "elsewhere" | "here" | "nowhere" {
  if (!Node.isReferenceFindable(decl)) return "elsewhere";
  const declFile = decl.getSourceFile().getFilePath();
  const start = decl.getStart();
  const end = decl.getEnd();
  let here = false;
  for (const r of decl.findReferencesAsNodes()) {
    const file = r.getSourceFile().getFilePath();
    const pos = r.getStart();
    if (file !== declFile) return "elsewhere";
    if (pos >= start && pos < end) continue;
    if (ignore && pos >= ignore.getStart() && pos < ignore.getEnd()) continue;
    if (r.getParent() && Node.isExportSpecifier(r.getParent()!) && !ignore) continue;
    if (r.getParent() && Node.isExportAssignment(r.getParent()!)) continue;
    here = true;
  }
  return here ? "here" : "nowhere";
}

/** A value (not a type) whose every use in its file is inside a `typeof` in a type. */
function onlyReadInTypes(decl: Node): boolean {
  if (Node.isInterfaceDeclaration(decl) || Node.isTypeAliasDeclaration(decl) || !Node.isReferenceFindable(decl)) return false;
  const name = Node.hasName(decl) ? decl.getNameNode() : null;
  const refs = decl.findReferencesAsNodes().filter((r) => r !== name && !(r.getParent() && Node.isExportSpecifier(r.getParent()!)));
  return refs.length > 0 && refs.every((r) => !!r.getFirstAncestorByKind(SyntaxKind.TypeQuery));
}

/**
 * Used in its own file and nowhere else: keep the declaration, drop the
 * `export`. Only for a plain `export` keyword on a single declaration; a
 * default export or overloads are left alone. With declaration emit on, a
 * type can't go private if an exported signature names it, so types are
 * skipped there.
 */
function needlessExportHunk(sf: SourceFile, rel: string, decl: Node, name: string, declarationEmit: boolean): Hunk | null {
  const holder = Node.isVariableDeclaration(decl) ? decl.getVariableStatement() : decl;
  if (!holder || !Node.isExportable(holder) || !holder.hasExportKeyword() || holder.isDefaultExport()) return null;
  if (Node.isVariableStatement(holder) && holder.getDeclarations().length !== 1) return null;
  const isType = Node.isInterfaceDeclaration(decl) || Node.isTypeAliasDeclaration(decl) || Node.isClassDeclaration(decl) || Node.isEnumDeclaration(decl);
  if (declarationEmit && isType) return null;
  const keyword = holder.getExportKeyword()!;
  const { line, column } = sf.getLineAndColumnAtPos(keyword.getStart());
  const text = sliceLines(sf.getFullText(), line, line);
  const at = column - 1;
  const after = text.slice(at + "export".length).replace(/^[ \t]+/, "");
  return {
    id: slug(["needless-export", rel, String(line), name]),
    file: rel,
    startLine: line,
    endLine: line,
    kind: "needless_export",
    confidence: 0.85,
    reason: `${name} is only used in this file; it doesn't need \`export\`.`,
    text,
    replacement: text.slice(0, at) + after,
    safe: true,
    action: "delete",
    symbols: [name],
  };
}

/** The node's lines hold nothing else: deleting them whole takes no neighbouring code with it. */
function ownsLines(sf: SourceFile, node: Node): boolean {
  const text = sf.getFullText();
  const start = sf.getLineAndColumnAtPos(node.getStart(true)).line;
  const end = sf.getLineAndColumnAtPos(node.getEnd()).line;
  const from = offsetAt(text, start);
  const to = offsetAt(text, end + 1);
  const rest = text.slice(from, node.getStart(true)) + text.slice(node.getEnd(), to);
  return /^[\s;]*(\/\/[^\n]*)?\s*$/.test(rest);
}

function contiguousRanges(sf: SourceFile, nodes: Node[]): { start: number; end: number }[] {
  const ranges = nodes
    .map((n) => ({
      start: sf.getLineAndColumnAtPos(n.getStart(true)).line,
      end: sf.getLineAndColumnAtPos(n.getEnd()).line,
    }))
    .sort((a, b) => a.start - b.start);
  const out: { start: number; end: number }[] = [];
  for (const r of ranges) {
    const last = out[out.length - 1];
    if (last && r.start <= last.end + 1) last.end = Math.max(last.end, r.end);
    else out.push({ ...r });
  }
  return out;
}

function unusedFileHunk(sf: SourceFile, rel: string): Hunk {
  const text = sf.getFullText();
  const endLine = lastLine(text);
  return {
    id: slug(["unused-file", rel]),
    file: rel,
    startLine: 1,
    endLine,
    kind: "unused_file",
    confidence: 0.9,
    reason: "File is never imported and is not an entry.",
    text: sliceLines(text, 1, endLine) || text,
    safe: true,
    action: "delete",
    symbols: [sf.getBaseNameWithoutExtension()],
  };
}
