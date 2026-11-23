# Waking a park: its order, and a merged one's finish

The detail behind `handover wake`'s order and its merged-park shortcut. What a waking park is, and the rest of
the wake, is [parking-a-seat](parking-a-seat.md#its-own-landing-keeps-the-seat-a-clock-or-another-branchs-pull-request-parks-it).

## Longest-waiting first, inside the boot window's share

`src/handover/wakeOrder.ts`, `src/cli/commands/handover/wakeBootBudget.ts`.

- **Each capped pass** (reads, finish asks, reseats) serves the park waiting longest since its last turn there,
  or since it became due if it never had one: a clock wake from its instant, or from the park when that instant
  had passed; a checks wake from the park. The slug breaks a tie. So a park whose spawn keeps failing goes
  behind every park that waited longer, and fresh parks never hold back forever one tried long ago.
- **Reseats go in groups ahead of that.** A park on work still to land goes before one whose pull request merged
  or closed, because finished work not yet on main outranks settling a row. A park whose doc names no `repo:`
  goes last, since `cmux spawn` refuses it.
- **The order is fixed from the judging pass.** A checks park whose pull request had not merged is read once more
  at its turn, since an earlier reseat this run may have moved it. One no longer due there is not reseated. One
  that closed or merged meanwhile stays where it was ranked.
- **Rows REPORT in board order.**
- **The budget.** A run attempts half the boot window's hold (3), less the Claude sessions already booted inside
  its 180 seconds, so the chair's fill behind it is never starved. The rest read `due-deferred`, and a run that
  did nothing else over one exits 4. MEASURED: in slug order, 41 then 47 parks were due, and
  every reseat went to the front of the alphabet.
- **A spawn counts** only when the FIRST line to clear the park is `dispatched`, so a failed spawn stays parked
  and the next tick retries it.

## A merged pull request's park is offered to `handover finish` first, and spends no boot

`src/cli/commands/handover/wakeFinish.ts`.

- **The real verb.** The wake runs
  `handover finish <slug> --park-index <n> --parked-at <instant> --probed-repo <repo> --probed-tree <kind>` as a
  one-minute child with no `SLOPWEAVER_ALLOW_*` variable but the one a `landed` park gets (next section). A doc or tree that moved since the wake's proof
  refuses. It runs in the parked seat's recorded worktree, so its probes read that tree. Where they would read
  the doc's own repo instead, it runs only once that repo holds the merge on a clean tree; otherwise the park
  reseats. That proof streams git's index and status listings through a file, never one string, so a checkout of
  any size reads (`wakeMergeScan.ts`). At most six run a pass, under the park's wake claim, and only past the
  re-park guard: every gate still decides.
- **Before the boot window.** The finishes run BEFORE the boot window is read.
- **The turn snapshot.** Reads and asks are kept in a snapshot rewritten whole each run
  (`$SLOPWEAVER_HOME/ledgers/handover-wake-turns.json`), pruned to the waking parks the scan could judge. A
  `--retry`, whose board predates its wait, prunes nothing. A snapshot that will not read costs one run's order.
- **A parked run is released**, and `finish` alone may act on one while its park stands
  (`src/handover/parkedFinish.ts`). That is checked again on the `finished` append's own read, so a seat that
  took the run meanwhile is never closed underneath it, and the bound park refuses once that very event no
  longer stands.
- **What it reads as.** An exit 0 believed off a `finished` line reads `finished` (`would-finish` on a dry run,
  which asks `finish --dry-run`). Any other ending falls through to the reseat, an exit 0 the journal does not
  show included, and the row names the refusal finish printed on stderr, on one line, with a cut past 64 KiB
  named. The reseat re-reads the park first and prefixes its reason on the row.

## The reconcile: a park whose pull request ended is settled, or named as still owed

`src/handover/parkedLanding.ts`, `src/cli/commands/handover/wakeReconcile.ts`. MEASURED: 66 due parks
on the live board, every one merged or closed, and every finish refused on the lesson question, because the seat
that held the run's context closed itself on its own landing before answering it.

- **Before each finish ask, one head read** of the pull request, and the parked worktree's branch when it still
  exists, classify the park. **`landed`**: it merged, its head is one of the run's own branches (the doc's
  `branch:`, the branch recorded at `start`, the worktree's), and the park left no question and no drafts.
  **`hiding-step`**: a question, drafts, or somebody else's branch merged (the run's own work is next) — or a
  landed row's finish still refused. **`closed-unmerged`**: its own branch closed unmerged. **`unknown`**: the
  head did not read, or a foreign head while one own branch is unknown.
- **Only `landed` changes anything.** Its finish child carries `SLOPWEAVER_ALLOW_NO_LESSONS=1` and nothing else,
  which journals the lesson question as `forced: true`, unanswered and loud, never as "nothing learned". Finish
  writes that forced line only after its own `finished` append succeeded, so a run still owing a probe or a page
  keeps its question.
  Once that finish is believed, the wake records `handover close` with the pull request and its merge commit, so the row
  derives `done` rather than standing as AWAITING SHIP. Every other class keeps the path it always had, and the
  row carries `reconciliation` naming why. A closed-unmerged row still reseats: the seat coming back decides it.
- **A tick reconciles at most six**, inside the reading's budget. `handover wake --settle-only` lifts that cap,
  reconciles the closed parks too and reseats nothing, for draining a backlog in one visible run; it refuses
  `--retry`.

## A merged park waiting only on the owner's open question has its wake suspended

`src/cli/commands/handover/wakeQuestionPass.ts`, `src/handover/parkWakeSuspension.ts`. MEASURED: a park
whose own pull request merged with the question still open reseated, booted, and closed again with nothing to do.

- **Every due row, before the finish pass, outside its cap.** A MERGED checks park whose run holds an open question
  NOW (`heldQuestion`, never the park's own `question` snapshot) is classed by the reconcile with that question set
  aside, and its drafts too: a held Slack draft is released by the chair's pass once the owner says yes
  (`slack draft approve`), never by the seat. A two-minute window opens on the pass's first journal read; no journal
  is read past it, and each batch of six is read and written as soon as it is prepared, so a slow prefix still
  settles what it prepared every tick, and the supervisor's wake reading budget, which counts a last batch's
  readiness children as one and its eighteen branch and worktree reads as serial, covers the pass. Only `landed`
  suspends, and only when the fresh head read says `MERGED` too, the pull request and its head both live in the repository the doc's `repo:` checkout
  names as `origin`, every branch the run names (the doc's `branch:`, the branch its park and its cycle's `start`
  recorded, the branch its worktree has out) is that one head, the worktree's `HEAD` NAMES that branch and stands clean on the merged head's
  COMMIT (`wakeWorktreeCommit.ts`, the merge proof's config-pinned status and index read, again under the claim, on
  a dry run too), and the finish a landed park with
  no question would get passes as a `--dry-run --beside-question`: the owner-wait gate set aside, the lesson question
  forced loud as the reconcile forces it, and every probe, page and check still read (a dry run then re-reads the
  journal as the append's precondition would, so an owner word during that child never reads `would-suspend`): a closed pull request can reopen, a stack parent's merge leaves the seat's own work (even one the run started
  on before moving to the child), a same-named branch in another repository or a fork is not the run's, a branch
  name outlives its merge so a commit past the head is new work, a detached `HEAD` is a rebase or bisect the seat has
  to finish, a failing probe is work the question is not, and a head, origin or worktree that did not read proves
  nothing. `--beside-question` is refused without `--dry-run`. An answer, withdrawal, ruling or
  `said` line after the park is the owner's word, which only a reseat delivers, so it never suspends either. Each of
  those stays due and takes its finish or reseat.
- **`park-wake-suspended`, never `park-cleared`.** The park stays ACTIVE and on the owner; the line names the park's
  journal position and the open question, and the append re-checks both, the park's instant and the owner's word
  on its own read, refusing any lifting line that landed during the head read. The line carries the journal length
  the wake judged at, and the projection voids it over any lifting line past that point, before it or after, since
  the append's read and write are not atomic.
  The append holds the park's wake claim, the one a reseat holds from its last park read through `cmux spawn`, so
  it cannot land between that read and the spawn; a claim another wake holds keeps the row due
  (`wakeQuestionSuspend.ts`). A row leaves the due set only once a suspension of that park stands on the journal,
  read back when the append failed, since a second wake running at once may have written one; otherwise it stays
  due, with one diagnostic. A reseat or finish re-reads the park first and stands down on a suspension another wake
  wrote (`parkMoved`).
- **It lifts with no line of its own.** Any later question, correction, reshape, offer, reconfirmation, withdrawal,
  answer, ruling or `said` line lifts it, so the wake is live again and already due. A correction back to the
  same text re-judges rather than re-arming the old line. The row reports `wake-suspended` (`would-suspend` on a
  dry run), counted as `suspended` and never as cleared or finished; a suspended park shows no wake on the board.
