# The seat lane: what a working seat runs before handback

Part of [Toolchain](../toolchain.md), beside [the two lanes](rebaseline-and-lanes.md).

`slopweaver dev lint --lane seat` is the one lane a seat runs, and `whole-tree-check-guard` lets it through
where it refuses every other. It exists because the diff gates judge a branch against its base, and a seat that
ran them by hand had no base to give: `host-wording` once read clean in a seat and red on the lap for the same
branch. `src/devLint/seatLint.ts` carries the rest; what it does, in order:

- **It resolves the base itself** — `git merge-base HEAD origin/main` — prints the full SHA, and hands it to
  every gate as `SLOPWEAVER_COVERAGE_BASE_SHA` through that gate's own `env`.
- **It refuses a stale fetch.** It prints how long ago origin/main was last fetched, proven from a FETCH_HEAD
  naming its commit or a last reflog entry a fetch wrote (never the file's mtime, which a hand `update-ref`
  moves too), and refuses past fifteen minutes with `git fetch origin main` as the fix. A refusal, not a
  warning, because a warned PASS against the wrong commit is the hazard; the bound and its measurement are on
  `SEAT_FETCH_MAX_AGE_MS`. It never fetches for you.
- **It narrows `oxlint` to the changed files** — committed since the base, changed in the working tree, or
  untracked — and never runs it with no paths, which would lint the whole tree. No eligible file, no oxlint.
- **It runs that oxlint LAST and ALONE, and withholds it while a lap holds this machine.** Narrowing the file
  list barely narrows the memory (the figure and its repro are on oxlint's row), so nothing runs beside it.
  At the moment it would spawn the lane reads the lap lock as `github lap-seat show` does; a live lap means
  oxlint is not spawned, its refusal names the lap and the re-run command, the rest of the lane's result
  stands, and the verdict reads `INCOMPLETE` with exit 4 when everything that ran passed — never a PASS.
- **It leaves out every whole-project gate and NAMES each on every run, PASS or FAIL**: `named-object-params`,
  `prettier`, `knip`, whole-tree oxlint and the typecheck. `internal-exports` runs knip's resolution too, yet is
  IN: its measured peak sits under the bespoke-gate slot, and the figure and its repro are on its row. Those
  are CI's, or the lap's where hosted Actions are off.
- **A failing run prints the narrowed re-check, and a fixed gate is re-checked with it**: above the verdict,
  one command per line, `git fetch origin main` and then `slopweaver dev lint --lane seat --only <gate>[,...]`
  naming the gates that ran and failed, never a withheld one. The fetch comes first so a fix that outlasts the
  fetch bound is not refused as stale, and the merge-base of an unmoved HEAD is the same commit after it. The
  two are never chained: a long failure list would push the chain past the raw-Bash gate's two-command budget. The whole lane is the expensive half: MEASURED, one no-diff run on a 10-CPU Mac
  cost 855 CPU-seconds in 173s of wall time (reproduce with `time slopweaver dev lint --lane seat`), while one
  gate costs the seconds its summary line prints. Several seats re-running it whole after each fix held the
  machine on CPU and stopped every new seat. A narrowed PASS is not the whole bar, and says so; CI runs that.

It is a projection over `lintChecks`, never a second list, so a new gate joins it by default and a new
`exclusive` gate is named as not covered without anyone editing the lane. A seat run's seconds are not recorded
into the schedule's history, because its oxlint is not the whole-tree oxlint the next full run schedules.
