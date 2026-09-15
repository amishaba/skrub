import { git, isGitRepo } from "./git.ts";

/** What a diff touched: the files, the line ranges it added per file, and the text it removed. */
export interface DiffScope {
  files: string[];
  /** 1-based inclusive ranges of added lines, or "all" for a file that is new. */
  added: Map<string, [number, number][] | "all">;
  /** Every removed line, joined. A symbol mentioned here lost a reference in this diff. */
  removed: string;
}

/** Whether the diff added any of lines start..end of `file`; every line of a new file counts. */
export function addsLines(diff: DiffScope, file: string, start: number, end = start): boolean {
  const ranges = diff.added.get(file);
  return ranges === "all" || !!ranges?.some(([a, b]) => start <= b && end >= a);
}

/** A line as a formatter would leave it: no whitespace, one kind of quote, no trailing comma or semicolon. */
function normalized(line: string): string {
  return line.replace(/\s+/g, "").replace(/['`]/g, '"').replace(/[;,]+$/, "");
}

const removedText = new WeakMap<DiffScope, { lines: Set<string>; joined: string }>();

/**
 * Whether `text` is code the diff only moved or reformatted: most of its lines
 * (80%) were removed somewhere else in the same diff, or all of it was, wrapped
 * differently. A reorg or a formatter pass rewrites lines without anyone
 * writing new code.
 */
export function wasMoved(diff: DiffScope, text: string): boolean {
  let removed = removedText.get(diff);
  if (!removed) {
    const lines = diff.removed.split("\n").map(normalized).filter(Boolean);
    removed = { lines: new Set(lines), joined: lines.join("") };
    removedText.set(diff, removed);
  }
  const lines = text.split("\n").map(normalized).filter(Boolean);
  if (!lines.length || !removed.lines.size) return false;
  if (lines.filter((l) => removed!.lines.has(l)).length / lines.length >= 0.8) return true;
  const joined = lines.join("");
  return joined.length >= 20 && removed.joined.includes(joined);
}

/**
 * The working-tree diff against a ref (untracked files count as wholly added,
 * since that is where an agent's new files live), or the staged diff.
 */
export async function diffScope(cwd: string, against?: string, staged?: boolean): Promise<DiffScope | null> {
  if (!(await isGitRepo(cwd))) return null;
  if (!staged && !against) return null;
  // --text: a source file with a stray control byte in a string literal is
  // still source; without it git reports "Binary files differ" and no lines.
  const out = await git(
    ["diff", "-U0", "--text", "--no-color", "--no-ext-diff", "--no-renames", ...(staged ? ["--cached"] : [against!])],
    cwd,
  );
  const scope = parseUnifiedDiff(out);
  if (!staged) {
    const untracked = await git(["ls-files", "--others", "--exclude-standard", "-z"], cwd);
    for (const file of untracked.split("\0").filter(Boolean)) {
      if (file.split("/").includes(".skrub")) continue;
      scope.added.set(file, "all");
    }
  }
  scope.files = [...scope.added.keys()];
  return scope;
}

export function parseUnifiedDiff(diff: string): DiffScope {
  const added = new Map<string, [number, number][] | "all">();
  const removed: string[] = [];
  let file: string | null = null;
  let isNew = false;
  for (const line of diff.split("\n")) {
    if (line.startsWith("diff --git ")) {
      file = null;
      isNew = false;
    } else if (line.startsWith("new file mode")) {
      isNew = true;
    } else if (line.startsWith("+++ ")) {
      file = line === "+++ /dev/null" ? null : line.slice(4).replace(/^b\//, "");
      if (file) added.set(file, isNew ? "all" : (added.get(file) ?? []));
    } else if (line.startsWith("@@") && file) {
      const m = /\+(\d+)(?:,(\d+))?/.exec(line);
      const ranges = added.get(file);
      if (!m || ranges === "all" || !ranges) continue;
      const start = Number(m[1]);
      const count = m[2] == null ? 1 : Number(m[2]);
      if (count > 0) ranges.push([start, start + count - 1]);
    } else if (line.startsWith("-") && !line.startsWith("--- ")) {
      removed.push(line.slice(1));
    }
  }
  return { files: [...added.keys()], added, removed: removed.join("\n") };
}
