# The first real run

Part of [Reclaiming worktrees](../worktree-prune.md).

```text
before   335 registered worktrees (slopweaver 247, acme-admin 88), 65 GiB free of 926 GiB (93% full)
plan     194 merged (109.9 GB) · 33 pushed (144.3 GB) · 1 gone · 108 held
applied  the merged and interrupted classes only
after    138 registered worktrees, 167 GiB free — 102 GiB reclaimed
```

The full per-worktree table was written under `$SLOPWEAVER_HOME`; regenerate the live
version at any time with `slopweaver worktree prune --older-than 24h --json`.

## The first run after the deadline fix

The run that proved the deadline fix, and the one measurement that decides how this verb is scheduled from here.

```text
before   846 worktree directories (slopweaver 767, acme-admin 79), 166 GiB free of 926 GiB (82% full)
after    672 worktree directories (slopweaver 622, acme-admin 50), 243 GiB free (73% full)
```

Both repositories, planned and applied under `--scan-budget` 20–25m and a `--budget` of 90m and 180m:

| class                               | slopweaver planned | acme-admin planned |
| ----------------------------------- | -----------------: | -----------------: |
| `merged` (branch deleted)           |                601 |                  7 |
| `pushed` (branch kept)              |                 17 |                  5 |
| `detached` (recreatable from a sha) |                  6 |                  6 |
| `unpushed` (bundled, branch kept)   |                 68 |                 26 |
| `hold`                              |                 73 |                 45 |

acme-admin removed 33 of its 44 candidates; slopweaver removed 147 of its 692. Neither was cut short — each
reached its removal budget and said what it still owed, which is the behaviour the fix exists to produce.

**The measurement that matters more than either count: a removal costs over a minute, and no budget changes
that.** Both runs spent their whole removal budget: 147 removals in slopweaver's 180 minutes is 73s each, and
acme-admin's 33 in 90 minutes is 164s each, where each also bundled. The reason is per-FILE and not per-tree:
`find <worktree> | wc -l` over one slopweaver worktree counts **150,104** files, because every worktree
carries its own real `node_modules`. So one slot's inherited 15-minute
budget clears about a dozen slopweaver trees, and a backlog of hundreds is a deliberate long run rather than a
bigger slot.

## The hourly slot, and what it took to make it keep up

A `worktree-prune` row runs `worktree prune --apply` at the top of every hour, fired by the first tool call of
the hour ([two triggers](#two-triggers-and-neither-waits-for-a-supervisor-pass)). The apply prints its plan before
it acts, the outcome of each tree, and what it still owes. A tree whose removal left anything at its path prints
`FAILED` with the path and the run exits non-zero, while the row fires again the next hour regardless
([the owner's word](classes.md#the-owners-word-work-committed-nowhere-is-never-destroyed)).

**Hourly, because deletion is filesystem-bound and a day's inflow does not fit one slot.** Measured
on a morning the owner expected 300 GB free and read 95: one acme-admin `git worktree remove` took 7m45s.
That tree held 545k entries, 429k of them its hardlinks-local `node_modules`, and a parallel `rm` on the same
volume was no faster (60k files: 23 s serial, 22–26 s two at once). A single daily slot under the 15-minute
apply budget therefore reclaims about two acme-admin trees, against around nine retired a day. Twenty-four slots
are six hours of removal against roughly seventy minutes of steady-state work, so a firing with nothing owed
is one scan. **One `--apply` per `$SLOPWEAVER_HOME` at a time**: the verb holds an operation lock
(`worktree-prune-apply`) for the whole run. The slot and the threshold trigger pass `--if-idle`, so meeting a
holder they remove nothing and exit 3; any other run WAITS for the holder, up to its own budgets — a
480-minute drain was once refused by a fifteen-minute threshold run (`src/cli/commands/worktree/pruneApplyLock.ts`).
No one preempts a holder mid `git worktree remove`. A dead holder's lock is taken over at once (unless its pid
was reused, which reads as alive) and a live one's after twelve hours; an apply whose `--budget` plus
`--scan-budget` passes eleven hours is refused before it starts. A takeover is unfenced, so a holder stopped past the
lease and resumed reads its lock before every removal, again after any salvage push, and before its scan cursors and
its tail, and once one reads it lost the run ENDS — no further back-off, cursor or removal
(`src/cli/commands/worktree/pruneScanPhase.ts`). Each read is a check, never a fence: a takeover landing between one
and the act it guards still runs that act, and only a fencing token on the operation lock would close that. A salvage push is stopped at fifty minutes
(`writeGit`, `src/admit/gitTransport.ts`), and git's ref refusals still stand between two holders. A backlog larger than a slot is a
deliberate long run: `slopweaver worktree prune --apply --budget 480m`.

**An apply that cannot read the live registers removes nothing.** A tree in use is indistinguishable from a
cold one without them, so a cmux workspace list that does not answer within its socket timeout or carries a row
it cannot decode (the STRICT inventory, so a malformed row fails the read rather than vanishing), a
process table `lsof` cannot read, or a GitHub list of the owner's open pull requests (which keeps a WARM tree on a
pull request's branch, never a cold one) that fails or does not add up refuses the whole run, naming each failed read.
A day on which cmux never answers at the top of an hour drains nothing, by design: the refusal is the safety,
never a thing to route around. **How it exits decides whether the hourly row comes back.** When the ONLY failed
read is cmux not answering the inventory's `window.list` or `workspace.list` in time (its own `timeout` frame, or the client's bound — `cmuxDidNotAnswer`,
`src/cmux/errors.ts`), the apply exits `EXIT_DEFERRED` (4): the scheduler gives the attempt back and the row
stays due, retried at the next hour's launch rather than the same hour. Any other failed read exits 1, and a
failed firing holds the row on a p0 finding. A cmux that stays hung is therefore not a p0 at once: each deferral is
recorded on the slot ledger with its reason (the verb's closing stderr as `· why:`, `rowRunners.ts`), and a row deferring two hourly slots running reads `DEFERRED` in
`silentRows.ts` and surfaces through the `recipe-stopped` monitor. A threshold launch's exit 4 lands only in its
detached log. Exit 4 belongs to the FIRST read alone, the one before any scan: a register failing on the
per-tree re-read during the apply keeps that tree, counts no removal failure, and the run can still exit 0
having removed nothing (`heldForRemoval`, `pruneLiveState.ts`). One
slot was a 10-second cmux stall that exited 1 and held hourly pruning until its fix.

**A slot that fires is not a slot that reclaims.** Audited, six consecutive slots all reached
`completed` while free space fell by roughly 200 GB that week. Four properties keep a firing productive:

1. **`pushed` is applied.** Clean, fully-backed, cold trees are the owner's own rule: untouched over 24 hours,
   not a live session's cwd, no uncommitted or unpushed work. Left out of the applied set they accumulate
   forever, so `pushed` is applied and keeps its BRANCH, the only part of it that is not recreatable.
2. **The apply stops rather than being killed.** A 20-minute `spawnSync` timeout around the whole sweep fires
   whenever more than about fifteen trees are due, at roughly one `git worktree remove` a minute
   (`ETIMEDOUT` in the slot records), and a kill lands mid-removal, which is exactly how a
   gutted `interrupted` tree is minted. `--budget` stops the run BETWEEN removals and prints what it still
   owes.
3. **Every repository is reached.** Swept in profile order, every bounded run spends itself inside the first
   repository: one slot removed 54 slopweaver trees and touched none of acme-admin's sixteen candidates.
   The apply goes round-robin across repositories, the same argument the disk budget makes about measurement.
4. **The SCAN never spends the removal budget**. The scan is serial git work
   at roughly 0.38 s a worktree, so a deadline of `now + --budget` set BEFORE scanning was spent across 754 slopweaver
   and 90 acme-admin registrations, and the run removed **zero** trees while exiting 0 (two
   consecutive slot records in `$SLOPWEAVER_HOME/live/recipe/slot-attempts/`, 929.8 s and 982.4 s of wall
   against a 900 s budget, both `exitCode: 0`). So the removal deadline is counted from when the
   scan ENDED (`applyDeadlineMs`, `src/worktree/pruneSweep.ts`), and the scan itself is bounded by
   `--scan-budget` (default 15m, measured against a full 855-worktree census) and ordered round-robin across repositories, coldest tree first inside
   each. A scan that runs out reports per repository how many it never looked at, because a partial census
   that does not announce itself reads as a whole one, and the next `--apply` resumes past the last (mtime, path) it
   classified (`worktree-bundles/scan-cursors.json`), so a prefix of holds wider than the budget cannot starve
   the trees behind it hour after hour. The cursor counts the runs its repository waited with nothing
   classified, and the longest-waiting repository leads the next run, so neither can one repository starve another.
   An apply narrowed with `--repo` rewrites only the cursors of the repositories it queued and keeps every other
   one, so a scoped run never sends another repository back to its coldest tree. A repository the profile
   declares twice, under any spelling, is swept once, so no tree is queued, or tried after being kept, twice.
   The cursors and the apply memory are ordering hints, never prerequisites, keyed by the repository as declared:
   while `worktree-bundles` cannot be written, or once a declaration is respelled (a symlink for its physical
   path), a run restarts that repository coldest-first and may retry a kept tree ahead of a fresh one, reports an
   unwritable directory, and goes on removing. The
   apply LOCK is the one prerequisite: a state home that cannot take its few bytes (a full disk) stops the apply
   before it scans, because two applies at once is the hazard the lock exists for.
   The apply half remembers too (`worktree-bundles/apply-memory.json`): a tree it attempted and had to keep —
   a salvage whose push stalled past the budget, say — goes behind every never-attempted tree next run, and
   the rotation starts from the repository attempted longest ago, so one slow decline cannot spend every
   hourly budget. Each attempt is recorded before it starts, so one that never returns counts too, and a kept
   tree is remembered until it stops being a worktree of its repository — not merely until a bounded scan
   skips it — while a path another repository registers afresh counts as never attempted there. The apply
   re-lists every repository after clearing stale registrations and forgets what git no longer registers then,
   so a tree whose directory was already gone leaves the memory the same run. Each record is merged into the
   memory as it stands on disk at that moment, so an apply whose lease lapsed mid-salvage writes back no older
   copy over what the apply that took the lease over recorded — short of both reading the file before either
   writes it, when the later write loses the other's record and only a later run's order suffers. Either file
   torn to bytes that are not JSON reads as empty, the same as a malformed record, rather than failing every hourly run.

## Two triggers, and neither waits for a supervisor pass

**The owner's ruling, P0: the prune runs on TWO conditions, a schedule AND a
threshold — free disk never under 100 GB — without a supervisor pass noticing.** The hourly row
once read 389 unrun slots against 168 recorded (`automation status --json`), `df` read 49 GB free and
the fleet held on disk. Both halves had one cause: the row ran only when a supervisor tick ran `automation
run-due` for it, and the disk remedy only when a tick saw a `disk` hold, so a quiet chair meant no prune. A
`KILLED_BY_SIGNAL` failure hold then held the row for 2.7 days on top.

- **The threshold.** Every production disk read (`src/live/machine/read.ts`, behind `machine capacity`,
  `machine watch`, `cmux spawn`'s capacity wait, `cmux reseat` and the perf read) reads `df` FIRST and hands it
  to the trigger before counting a worktree. Under the prune floor (`worktreePruneFloorGb`,
  `src/worktree/pruneFloor.ts`: the higher of the owner's 100 GB and the floor `machine capacity` holds spawns
  at, 100 GB today, judged on the raw KiB) it backgrounds `worktree prune --apply --if-idle`
  DIRECTLY — past a stamped slot and past a failure hold, which is exactly when the disk still needs it. At most
  one launch per ten-minute window; one launched while an apply runs steps aside and exits 3.
- **The schedule.** `hooks/pretooluse.ts` asks on every tool call in every session. Once the hour has
  launched that costs one `stat`; the first call of a new hour backgrounds `automation run-due --recipe
worktree-prune`, so the slot ledger still decides whether the hour is owed and records it exactly once. A
  held row stays held there — the threshold is what reclaims past one.

**Only a caller inside cmux claims a window, for either cause.** The launched verb is reparented to launchd,
so cmux answers it only when it presents the `CMUX_SOCKET_CAPABILITY` it inherited; without one the apply
cannot read the live workspace list and refuses. Once a session started outside
cmux won the hour that way and the row was held on a failure finding. A caller with no token now answers
`cannot-serve` and writes no marker, so the next tool call from a session inside cmux claims the same window.
The residue is conservative: a cmux not in `cmuxOnly` mode would have answered a tokenless child, and it is
skipped anyway.

Neither is a clock: both fire off an event already happening. A home declaring no
main checkout launches nothing and writes nothing, which keeps every test home on this volume untouched. The
launch is a `spawnSync` of `/bin/sh` backgrounding the verb from the state home, so the caller never waits,
and every value reaches the shell as an argument (`src/worktree/pruneTriggerLaunch.ts`). The verb it launches
is the FIRST declared main checkout's own `bin/slopweaver`, with `SLOPWEAVER_CLI_DIR` pointed at that checkout,
never the firing seat's: the launcher resolves its code from the plugin root a seat's hook inherits, so the
launcher path alone still ran the seat's build. MEASURED: nine hourly runs had refused as a stale
build of whichever seat fired them. The bundled one runs when that launcher is not an executable file, or when the
main checkout's build is stale and the bundled build is fresh — `checkout sync` moves its source but rebuilds no CLI, so a stale main build
would otherwise refuse every hour — and the log's `launcher:` line says which (`choosePruneLauncher`). Either way the child's `SLOPWEAVER_CLI_DIR` and
`PLUGIN_ROOT` both name that launcher's own tree and `CLAUDE_PLUGIN_ROOT` is dropped (`pruneLaunchEnv`), so no
root a seat inherited outranks the one the log names. It holds a 100 GB floor
apart from [the seat HOLD floor](../../skills/supervisor/reference/disk-floor.md), which still answers only
"is one more seat safe".

**What each launch did is in `$SLOPWEAVER_HOME/worktree-bundles/auto-prune.log`**, each run headed by its
cause and the free disk it launched at, and the window markers in `worktree-bundles/auto-trigger/`. The
threshold launch writes no slot record, by design; the log is its record. Prove it on the machine: `df -k
"$SLOPWEAVER_HOME"`, `slopweaver machine capacity`, the log's new `cause=threshold` heading and the apply's own
`free space rose` line, then `df -k` again.

**Every apply ends on one `prune-progress` line, and that line is the evergreen proof.** It carries the
candidates the run found, how many it removed, how many it still owes, and whether its scan was complete —
every repository read and none cut short (`src/worktree/pruneProgress.ts`). An hourly run with
hundreds of trees still remaining means something is wrong. So the property is a series, never one run: across consecutive `cause=schedule` runs `owedAfter`
falls, and reaches 0 on a run whose `scanComplete` is true. `grep "^prune-progress" auto-prune.log` reads it; an
incomplete scan's zero proves nothing.

**A slot that stops firing is still read off `automation due`.** `automation due` reports every row and how
late it is against its own cadence, plus `live/recipe/resync-state/<recipeId>.json` for whether the last
attempt actually achieved anything; a held row or a machine nobody is using shows there.

## The hole that left, and the declaration that closes it

`automation due` reports the rows that are THERE. So a row that is DELETED reports as nothing at all, and that is
the failure that actually happened. `live/recipe/lifecycle.jsonl` holds twenty-one records for this row, the
last a `completed` for its final slot. Then its file left
`$SLOPWEAVER_HOME/live/recipe/definitions/` and every surface went quiet in exactly the way a healthy
install is quiet. Seventeen days later the count stood at 766 registrations in slopweaver and 105 in
acme-admin, on a volume at 93%.

The definition store is outside the repository by construction, so the row cannot be a committed file. What
is committed instead is the **declaration** that it must exist: `src/live/automation/standingRows.ts`'s
`GENERIC_STANDING_ROWS`, the rows every install carries. Three things follow from it, and together they are the mechanism:

- **`automation due` compares, rather than lists.** A declared row the store does not hold prints FIRST, above
  every other line, naming what stops happening while it is gone and the verb that writes it back. Every
  supervisor pass already reads `automation due`, so an absence surfaces on the next pass.
- **`slopweaver automation register-standing` writes back what is missing** — `--dry-run` first, and it REFUSES
  any path it cannot prove empty rather than writing over somebody's work. It rewrites a present row only when
  that file is still exactly an earlier build's declaration: the daily `0 4 * * *` row is brought forward to
  hourly that way, and `automation due` prints it as `SUPERSEDED` until it is. A row that is present but
  disabled, held or hand-edited is somebody's deliberate act and is left exactly as it is. The file is read
  again immediately before the atomic rename; an edit landing between that read and the rename is overwritten,
  a window no rename can close.
- **The row's argv stays minimal** (`worktree prune --apply --if-idle`), so it inherits this verb's own measured
  defaults and its round-robin over every declared main checkout. A row naming `--older-than`, `--budget` or
  `--repo` would freeze today's numbers into a file nothing reviews, and `--repo` would starve every other
  repository (property 3 above).

Every close reclaims its own seat besides, which is the mechanism and this row the backstop:
[the close reclaims its own seat](seat-close.md).

## A removed worktree's plugin mirror goes with it

Every seat's SessionStart copies the hook surface into `~/.claude/plugins/data/<plugin>/mirror/by-root<plugin
root>/`, two ~100 MB slots per root (`scripts/plugin-mirror-sync.sh`), and that script frees a root only once it
has gone seven days without a boot. At a worktree per seat that window holds hundreds of roots: once,
with 2.6 GiB free, 533 removed worktrees still held 770 slots, about 77 GB — the single largest thing on the
disk, ahead of every worktree and the reclaim trash together.

`slopweaver worktree mirror-prune` plans, and with `--apply` frees, the mirror of every root that is a worktree
of a declared main checkout, does not exist, carries no FRESH build lock (one older than the script's own
120s `LOCK_STALE_SECONDS` belongs to a build that died), and is held by no live register on its
path. A gone root has no branch to check, but the pass still refuses on any register it could not read,
GitHub's included, because it shares the apply's live state.
The hourly `worktree prune --apply` runs the same pass after its removals, with a two-minute floor of its own
(`mirrorPassDeadlineMs`), so the tree it just removed loses its mirror the same hour. Under disk pressure the
pass drops its four-root cap and its load gate, as the removals do, because a gone root's ~0.13 GB is unique
bytes (a sampled root: 14,508 files, 0.126 GB, every one single-linked). A root anywhere else stays
under the script's age rule. `src/worktree/pluginMirrors.ts` carries the criterion.

**The reclaim trash is not where the disk is.** Its `node_modules` are hardlinks into yarn's shared store — a
sampled file carried 87–631 links, and three batches held **zero** bytes no other checkout also links
(`find <batch> -type f -links 1`). `du` over one batch reads 1.5–2.8 GB because it counts each inode once per
call, which is exactly the trap: emptying a batch frees inodes, almost never bytes.

## The briefing says what is registered

`slopweaver machine capacity` reports the volume's own fill and the worktree registrations per declared main
checkout (`src/live/machine/diskFootprint.ts`), and the supervisor's capacity fold carries both. The count is
REGISTRATIONS rather than directories on disk, because a registration is what this verb can clear — the two
differ, and acme-admin held 105 registrations against fewer live directories. Neither number
holds or alerts on its own: the seat HOLD is [its own derived floor](../../skills/supervisor/reference/disk-floor.md),
and the row, the close and the 100 GB trigger are what act on the disk.
