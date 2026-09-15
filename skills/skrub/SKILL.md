---
name: skrub
description: Build like a product engineer, follow and maintain this repo's conventions while writing TypeScript, and leave no dead code behind. Use when starting work in a repo, before building a feature, before saying a change is done, when a skrub hook lists findings, when the user corrects how code was written, or when asked to clean up or reorganize code.
---

# skrub

The rules a tool can check live in `.claude/conventions.md` and are checked for you. This file is only about when to do what.

**Starting in a repo.** Read `.claude/conventions.md`; it is short. If it doesn't exist, run `npx --yes @amishaba/skrub conventions` to write it from the code. Repo docs (AGENTS.md, CLAUDE.md) win over it; if they disagree, tell the user.

**Knowing the product.** The `## product` section of `.claude/conventions.md` says what this product is and whose patterns to follow. If any line says `(to fill in)`, fill it before other work: read the README, package.json, routes and UI, then write who uses it and the job they're doing, the space with two or three products those users already know, and what to copy from them for this repo's surfaces (CLI output, dashboard layout, API shapes, onboarding). Keep each line short. Claude Code asks the user before edits under `.claude/`; that approval is their chance to correct it. If they turn it down, put the lines in your reply instead, and update the section whenever they correct you.

**Before building a feature.** Read [product.md](references/product.md): find the problem behind the ask, look at how the leading products in this space do it, reuse what already exists, and pick the smallest change that works end to end.

**While writing.** Follow the conventions file and the nearest similar code. Before writing a component, hook, API call, or helper, check **use these first** in the conventions file, then search; extend what exists instead of copying it. If skrub stops a new file because something like it exists, reuse that, or write the file again and say in a line why it's different.

**When the user corrects you.** If the correction should hold next time (a name, a place, a pattern), add one line to the notes in `.claude/conventions.md`. Merge with an existing line rather than adding a near-duplicate, and keep the file under 60 lines.

**Before finishing.** The stop hook runs skrub on your change and lists what it finds. Run `npx --yes @amishaba/skrub fix` for the ones marked safe, then fix or keep the rest with a one-line reason. Without the hook, run `fix` yourself.

**Only when the task calls for it.** Don't preload these; read one when you reach that kind of work:

- reorganizing or refactoring: [reorg.md](references/reorg.md), then [colocation.md](references/colocation.md)
- endpoints, API shapes, return values: [apis.md](references/apis.md)
- code that crosses server and client: [boundaries.md](references/boundaries.md)
- unsure about a name or a comment: [naming.md](references/naming.md), [comments.md](references/comments.md)
