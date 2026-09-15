# skrub — TUI spec

Ink terminal app that reviews TypeScript slop hunk-by-hunk. You keep or delete. It never rewrites and it is not a chat agent.

Claude Code’s *craft* (Ink, keyboard, stay in the terminal). Not Claude Code’s *product* (no prompt, no agent loop, no cloned chrome).

The engine already exists (`src/detect`, `src/scan`, `src/patch`, `src/llm`, `src/commands/comment.ts`). Do not rebuild it. Render hunks, write `decisions.json`, call apply.

## One-liner

`npx skrub` scans, then a full-screen TUI. **d** delete · **k** keep · **n/p** next · **a** apply · **q** quit.

## Commands

| Command | What |
| --- | --- |
| `skrub` / `skrub scan` | Scan, then open the TUI on that scan (default) |
| `skrub view` | TUI on the latest scan (no rescan) |
| `skrub apply` | Apply accepted hunks (also **a** in the TUI) |
| `skrub comment` | Unchanged: GitHub PR quality notes |
| `skrub --json` | Scan only, print summary, no TUI |

`--against`, `--staged`, `--cwd`, `--no-llm` stay as they are. `skrub view --web` may keep the HTML page; default view is the TUI.

## Screen

```
skrub    12 hunks    340 lines    3 accepted    llm gemini-2.5-flash
────────────────────────────────────────────────────────────────
 src/types.ts:77     unused_export · safe
 Exported Grade is never referenced.

 export type Grade = z.infer<typeof GradeSchema>;
────────────────────────────────────────────────────────────────
[d] delete  [k] keep  [n/p] next  [a] apply  [q] quit
```

- Header: brand, KPIs, llm/mechanical, current index (`3/12`)
- Body: `file:line`, kind tag, one-sentence reason, the hunk text
- Footer: keys only. No mouse requirement.
- Optional left list of hunks (`·` pending, `×` delete, `·` keep) if the terminal is wide; skip if `< 100` cols.
- Spinner (“scanning TypeScript graph…”) until `runScan` returns. If view-only, skip spinner.

Keep / Delete maps to `decisions.json`: delete → `accept`, keep → `skip`. Persist on each keypress (same as `POST /api/decision`).

## Stack

- `ink` + `react` (Ink 5 / React 18, ESM — already `type: "module"`)
- `ink-spinner` or a one-line custom spinner
- No Ink UI kit, no chat input, no markdown agent transcript
- `src/tui/App.tsx` + small components. Commander still owns flags.

Non-TTY (`--json`, CI, piped stdout): print the existing scan summary and exit. Do not render Ink.

## Non-goals

- Not a chat agent / “talk to skrub”
- Not a Claude Code skin
- Not a rewriter, formatter, or Bugbot
- Do not reimplement detectors, patch, or GitHub comment
- Do not add Python, VS Code, or a pass/fail score

## Definition of done

- `npx skrub` in a TTY opens the TUI after scan
- Keys work; decisions survive `q` and reload via `skrub view`
- **a** runs apply and shows “N hunks” / “nothing accepted”
- `npx skrub --json` still prints JSON with no Ink
- `npx tsc --noEmit` green
- README: three commands, mention the TUI, no pass/fail language
