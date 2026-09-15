---
file-names: kebab-case
exports: named
import-extensions: .ts
functions: declarations
---

# conventions

The settings above are checked on every change by `skrub` and were read from this repo's own code; `skrub conventions` shows drift, `--write` refreshes them. Follow them in new code.

## from the code

- file names: kebab-case (4 of 4)
- exports: named (7 of 7)
- barrel files: none, but 8 files is too few to call it a rule
- relative import extensions: .ts (10 of 10)
- exported functions: declarations (11 of 11)
- functions that return a boolean: 1 example, too few to call it a rule
- verb for functions that call an endpoint: 1 example, too few to call it a rule
- layout: src/lib/

## notes

<!-- Rules a tool can't check: domain words, where things go, what reviewers keep asking for. When the user corrects how something was written and it should hold next time, add one line here. Merge, don't append duplicates; keep this whole file under 60 lines. -->
