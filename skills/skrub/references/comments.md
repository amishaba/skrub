# Comments

The code says what happens. A comment earns its place by saying something the code can't: why, what must stay true, what was tried and failed, what to watch for.

## Keep

- **Why this approach:** `// Poll instead of a webhook: the vendor drops webhooks during deploys.`
- **Invariants and constraints:** `// Must run before migrations; it creates the schema they assume.`
- **Workarounds with an exit condition:** `// Remove once ts-morph >= 28 ships the fix for #1432.`
- **Surprises:** `// Compare in whole points: 5/5 → 4/5 is exactly 20, not 19.999…`
- Public API docs (JSDoc) that add meaning beyond the types: units, ranges, side effects, errors.

## Delete

- **Narration:** `// Loop over the users`, `// Return the result`, `// Convert the rows to CSV`.
- **Restating the name:** `// Escape a cell.` over `escapeCell`.
- **Changelog lines:** `// Changed to use the new API`, `// New:`, `// Updated per review`, `// First pass, replaced by csv.ts`. History belongs in git.
- **Notes to the reviewer of this change:** `// Fixed the bug you mentioned`. Put that in the commit message or PR.
- **Commented-out code.** Git has it.
- **TODOs without a condition or owner.** `// TODO: add CSV export` next to a CSV export is stale. Keep a TODO only if it says what blocks it.
- **Section banners** (`// ===== Helpers =====`) in files short enough to scroll.
- **JSDoc that repeats the signature:** `@param id the id`.

## Before writing one

If you need a comment to explain *what* a block does, rename a variable or extract a well-named function instead. When you change code, update or delete the comments it makes wrong.
