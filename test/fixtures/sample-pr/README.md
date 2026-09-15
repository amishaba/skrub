# sample-pr

The head of [amishaba/skrub-sample#1](https://github.com/amishaba/skrub-sample/pull/1),
the standing sample PR: a small report printer whose `main` skrub calls clean,
and a coding agent's CSV export on top. `pr.diff` is that PR's real diff
(`git diff -U0 main agent/csv-export`), so the scan sees exactly which lines
the agent added, and `.claude/conventions.md` is what `skrub conventions`
wrote from `main`.

`npm run demo:bake` runs skrub's `analyze()` here with that diff and writes
`web/scan.json`. The golden test recomputes it and fails if the shipped scan
drifts.
