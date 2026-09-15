# Reorganizing code

A reorg makes the codebase easier to read without changing what it does. Reviewers should be able to trust that, so keep moves and behavior changes apart.

## Order

1. **Delete first.** Run `npx --yes github:amishaba/skrub fix` and handle what it leaves. Don't move code nobody uses.
2. **Colocate.** Move single-caller helpers into their callers; move files into the feature folder they serve ([colocation.md](colocation.md)).
3. **Collapse pass-through layers.** A function, class, or file that only forwards to another goes; callers call the real thing.
4. **Merge duplicates.** Keep the better-named, better-placed copy and point callers at it.
5. **Rename** ([naming.md](naming.md)).
6. **Only then change behavior,** in a separate commit.

## Rules

- **A move commit changes no behavior.** Typecheck and tests pass before and after, with the same results.
- **Update every import.** Use the editor or TypeScript rename and move refactors rather than search-and-replace when available.
- **No shims at old paths.** No `export * from "./new/place"` left behind, unless the old path is a published package entry point.
- **One concept per commit:** "move invoice helpers into invoices/", "rename user → account". A reviewer should be able to read each commit as a list of moves.
- **Plan big reorgs before doing them.** If it will touch more than about ten files, write the plan (what moves where, and why) and confirm it first.
- **Finish with `npx --yes github:amishaba/skrub check`** to confirm the reorg didn't leave anything orphaned.
