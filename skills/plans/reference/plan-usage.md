# `plans usage`: each plan's recorded usage, asking no model host

```bash
slopweaver plans usage          # one line per registered plan
slopweaver plans usage --json   # the document the desktop menu bar draws, through the console's `plan-usage` read
```

For each registered plan, it prints:

- each weekly window's percentage, its reset, its source and when it was read;
- whether the plan's store needs a sign-in.

It asks no model host anything. It reads only what this machine already recorded (`src/plans/planUsageRead.ts`):

- **Claude:** the snapshot `claude gauge` or `claude watch` last wrote (`$SLOPWEAVER_HOME/live/claude-usage/<alias>.json`),
  and the probe records those reads filed.
- **Codex:** the newest rate-limit event in each store's own rollout logs, the store's `auth.json` read for its shape
  only, and the last filed live read of that store.

For a reading taken NOW, use the live reads, `claude gauge` and `codex route`.

## What a row may not say

The projection is `src/plans/planUsage.ts` (the sign-in verdicts `planUsageSignIn.ts`, the shapes
`planUsageTypes.ts`), and its header is the contract:

- **A missing reading is never 0%.** A window with nothing recorded is `no-reading`.
- **A reopened window drops its old number.** A window whose reset has passed since it was read is `no-reading`,
  and so is one with no recorded reset read more than a week ago, since a weekly window has reset since then.
- **An old Claude reading is never `measured`.** One older than the hour a reading stays evidence
  (`CLAUDE_USAGE_READING_FRESH_MS`) is `stale`: its number is kept, but labelled.
- **A Codex reading behind something unreadable is never `measured` either.** The rollout scan counts a file it
  reached and could not open, and every place its walk passes over in silence: a session directory of any age it
  cannot list or search, a symlinked directory, a directory nested inside a day directory, a rollout file above one,
  a refused link, an entry listed and gone a moment later (`CodexGaugeScan.filesUnreadable`), since any may hold a
  later reading; the window is then `stale`, or
  `no-reading` naming the count when nothing else held one.
- **Some plans carry no weekly number at all.** A paused plan does not, and neither does a monthly-spend plan,
  because nothing here measures monthly spend.
- **`ok` needs positive evidence about the store the row names now.** For Claude, that is a probe record for that
  store that last answered. For Codex, it is a live read filed against the same `auth.json` stamp.
- **A file existing proves nothing.** An `auth.json` that merely exists is `unknown`: it proves a sign-in happened,
  not that it is still accepted.

## Exits

- **0:** a report was printed.
- **3:** nothing is registered. That is an answer, and the console reads it as `NO_PLANS`.
- **1:** the register could not be read. No partial report is printed in that case.

One unreadable snapshot or probe store stays in the rows it feeds, and every other row still renders.

## Tests

- `src/__tests__/unit/plans/planUsage.test.ts` covers the projection, and `planUsageSignIn.test.ts` beside it the
  sign-in verdicts the projection's cases do not reach.
- `planUsageRead.test.ts` covers which stores get scanned, how an outage stays in its own rows, and the file readers.
- `src/__tests__/unit/cli/commands/plans/usageRun.test.ts` covers the verb shell, and `usageLines.test.ts` its lines.
