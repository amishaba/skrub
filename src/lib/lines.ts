export function sliceLines(text: string, startLine: number, endLine: number): string {
  const start = offsetAt(text, startLine);
  const end = offsetAt(text, endLine + 1);
  return text.slice(start, end);
}

export function offsetAt(text: string, line: number): number {
  if (line <= 1) return 0;
  let current = 1;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "\n") {
      current++;
      if (current === line) return i + 1;
    }
  }
  return text.length;
}

/**
 * 1-based number of the last line that holds content. A trailing newline ends
 * the last line; it does not start an empty one — so a 6-line file is 1..6,
 * matching `wc -l`, editors, and GitHub's diff line numbers.
 */
export function lastLine(text: string): number {
  let n = 1;
  for (let i = 0; i < text.length - 1; i++) {
    if (text[i] === "\n") n++;
  }
  return n;
}
