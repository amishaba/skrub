/** A terminal someone can drive, with a size to draw in; some embedded terminals report 0 rows, and the review would be blank. */
export function isInteractiveTty(): boolean {
  return Boolean(process.stdout.isTTY && process.stdin.isTTY && process.stdout.rows > 0 && process.stdout.columns > 0);
}
