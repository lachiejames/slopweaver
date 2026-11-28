# Parking a seat on the owner's steer

**Every running seat is on the highest priority.** A seat that cannot
proceed without the owner's steer is parked: its question is on the owner's Queue, the seat is closed in cmux with
its worktree, branch, last screen read and Queue question named on its board row, and the owner's answer reseats
it. The freed capacity goes to the next ready row that has the owner's steer.

```bash
slopweaver handover ask <slug> --question "…" --problem "…" --options "…" --lean "…"   # first: the Queue card
slopweaver handover park <slug>                       # the seat on the run's writer worktree, else your own
slopweaver handover park <slug> --workspace <ref>      # name it when the worktree holds two
```

## A park is half a move: the fill is the other half

Closing a waiting seat only helps if the slot is filled. An owner who finds basically no sessions running except
the supervisor asks where the capacity is maxed. At any given moment the owner should be able to walk in, see
what is being worked on, and agree these are the best things the fleet could be working on right now. So the chair parks and spawns in the SAME tick,
and names each freed slot's new row, or the ceiling (`machine capacity`'s `ceilings.lowest`) that left it
empty. A fleet of parked rows with only the chair running is this defect, however tidy each park was.

## What the one act does

1. Picks the seat: a named `--workspace` standing in the writer's recorded worktree, else the ONE live workspace
   in it (the journal's last seat worktree if the writer recorded none). With no worktree at all, only the
   caller's own (`CMUX_WORKSPACE_ID`). Two in that worktree, or none, is refused, never guessed.
2. Reads its screen. The pinned chair is refused. A FOREIGN seat closes only on proof that it is at rest.
   The run's CURRENT writer recorded `claude-code` or `codex` as its host, and the screen classifies `idle`
   under THAT host's measured patterns (`src/cmux/turnState.ts`): Claude Code's footer under its `❯`, or
   Codex's `›` composer over its footer with no `• Working (` line, as measured. Anything else is
   refused through the hatch `SLOPWEAVER_ALLOW_PARK_RUNNING_SEAT`: a running turn, a queued line, a Codex
   background terminal, a hostless journal, or a reseat that never claimed (its seat recorded no host). A
   seat parking itself is exempt bar a line QUEUED behind its own park, a relay the close would drop.
3. Re-reads the screen and judges step 2 again, then re-reads the journal's writer, with nothing
   asynchronous between that read and the append. Then it journals a `parked`
   event — worktree, branch, the open question, the fresh screen's last 40 lines — BEFORE the close,
   because a seat parking itself does not outlive its own close. cmux has no atomic check-and-close, so
   a turn starting in the milliseconds between that re-read and the close is stated residue.
4. Closes the workspace and reaps its worktree's leftover processes, keeping the worktree and branch. cmux
   0.65.2 refuses any workspace with a live process unforced, so its OWN seat (and a hatch-forced one) closes
   with force — the parking session is that process. A foreign seat closes unforced, then forces once only on a
   fresh screen proving Claude Code or Codex idle; otherwise it is held open, journalled parked, and exits 1
   (`parkCloseMode`, `src/handover/parkPolicy.ts`).

The `parked` event **releases** the run. That is load-bearing: `handover reap` orphans a waiting run whose
writer is dead, which would close the cycle and hide the checkpoint; a released run has no writer to be dead.

## Where it shows, and how it comes back

- The board row reads `parked, seat closed (<ref>; <worktree> on <branch>)` beside the question, and
  `handover list --json` carries a `parked` field (`src/handover/boardEvidence.ts`, `listJson.ts`).
- `handover resume <slug>` prints a `PARKED` block: worktree, branch, the question, the last screen.
- The owner's answer arrives by `handover rule` or on the Queue. `cmux spawn <slug>` then reopens the parked worktree
  (its journalled path, then its branch, over the doc's declared one, `src/cmux/plan.ts`); another row's spawn there
  is refused (`src/cmux/treeOccupancy.ts`). A tree older than the `parked` kind cannot claim until it pulls the base.
- The park stays ACTIVE until the owner answers, the question is withdrawn or replaced, the run ends, or a spawn or
  session takes it back. A ruling leaves it: a ruling is what a reseat is for. A `park-wake-suspended` line
  holds only its WAKE ([why](waking-a-park.md#a-merged-park-waiting-only-on-the-owners-open-question-has-its-wake-suspended)).

## `session close-done` parks every at-rest seat itself

No parked seat stays in the fleet: parked sessions are closed, their state is tracked somewhere, and they resume
when wanted. So the chair need not
remember `handover park`: every `session close-done` sweep treats a live seat on an open run whose row shows no
done or drifted evidence as a PARK CANDIDATE (`src/sessions/parkSeat.ts`,
`src/cli/commands/session/closeDonePark.ts`), and parks it in the same order as the verb above:

1. **Identify the seat**, failing closed: exactly ONE Claude Code session in the workspace's process tree,
   its registry record live by `procStart` and reading `idle`. A refused registry file in the tree, two
   sessions, a recycled pid or a `busy`/`shell` status keeps the seat, and says why unless it was simply working.
   With NO Claude session in the tree, a Codex seat qualifies only on positive evidence
   (`src/sessions/codexParkSeat.ts`): Codex's own idle composer, and exactly one thread the run's current cycle
   launched or claimed under `codex` held by a process inside the tree. A thread no process is seen holding is
   UNMEASURED and keeps the seat — absence never reads as idle.
2. **Decide what it is.** The run's current writer is that session → journal a `parked` event and close;
   a writer that RELEASED the run qualifies only when its process started before the release — its FIRST
   release or park since it last took the run, so a second let-go line of its own never admits a later boot.
   The run is parked already and that session's own last journal line let it go — the park itself, or a
   `released` before it — after its process started → close only, journal nothing (a predecessor seat left
   open; a `cmux reseat` of the same session starts later, so it is kept), and only when that park carries
   every draft the seat still holds, else `drafts-unrecorded` keeps it. Anything else keeps it: a writer
   that is another session, one taken over with no release, no writer and no checkpoint, an
   ownership-ambiguous journal line.
3. **Re-read the screen and the journal**, as the verb does: the screen must still end in its host's at-rest
   composer with no background work, and the writer must not have moved — the same host, id, pid and process start.4. **Copy the drafts.** The checkpoint carries every unsent message the seat holds — the open question's
   drafted action and every HELD Slack draft on its row (`src/handover/parkDrafts.ts`). A copy it cannot call
   complete (an unreadable register line) keeps the seat rather than parking it without them.
4. **Close and reap**, keeping the worktree and branch — after one last read, in order: the screen at rest,
   the same idle session, then the journal still resting on that checkpoint with no ownership-ambiguous line
   and carrying every held draft. A close refused or failed after the journal append says so, with the
   checkpoint named as journalled.

`handover park` stays for parking a seat that is not at rest yet: the seat parks itself after its ask.
`--dry-run` prints `would park` and writes nothing. The Fleet page's cards are the working seats only; a row
waiting on the owner is the Queue's to show, and one parked on CI or a clock is counted under the working count.

## A standing session is never parked, and is reseated if it is

The one exception to "no parked seat stays in the fleet" is a seat the owner keeps talking to:
close-done once parked the owner's dedicated session at rest between the owner's turns, and waiting for
the owner is that seat's intended state. Record it on the row:

```bash
slopweaver handover rule <slug> --anchor <where> --words "<the owner's words>" --standing-session [--standing-until <iso>]
```

- **close-done keeps it**, as `kept (standing-session)`, both at planning and on its last look before the close.
  Done evidence still makes it a close candidate: a standing seat whose work is over closes like any other.
- **`handover park` refuses it** before journalling anything, on the last read before the append, and on one more
  read after it, right before the close. The hatch is `SLOPWEAVER_ALLOW_PARK_STANDING_SESSION=1`, for an early
  close the owner said that is not yet recorded. Residue: the journal takes no lock, so a ruling landing between the
  append's own read and its write still leaves a `parked` line; the read-back refuses it and every later look
  reads the ruling first, so the seat stays open.
- **The chair's reconcile reads a parked standing row as ready** (`standingSessionNeedsReseat`,
  `src/cli/commands/handover/reconcileStanding.ts`), so the next fill seats it by a visible `cmux spawn` — a park by
  an older checkout's close-done, a crash or a hatch is put back on sight. The lift passes the trunk-moved hold,
  since the reseated seat is the session that rechecks it. A row with no `repo:` stays held as blocked with its
  `handover set-repo` line, because `cmux spawn` cannot seat a repoless row. A live seat occupies its row from
  anywhere under its worktree, read by the recipe-failure filter too (`src/cli/commands/handover/seatName.ts`), so a
  seat is never doubled.
- **What ends it**: its `--standing-until`, or a LATER standing-session ruling whose `--standing-until` is already
  past. An ordinary ruling leaves it standing, since talking to the seat is what produces rulings on its row. A
  reconstruction (`backfilledFrom`) can neither make nor end one: the schema and decoder refuse the field there
  (`src/handover/standingSession.ts`).

## Its own landing keeps the seat; a clock or another branch's pull request parks it

**Waiting on its own pull request's CI, rebasing, fixing red CI and landing are the work**: a session that does ninety-nine percent of the work, reaches the last one percent and
then says goodbye is a massive bug. The seat waits in ONE bounded background `slopweaver github checks --number <n> --repo <r> --wait` (`--until
merge` once queued), whose completion resumes it; close-done keeps a seat with a background shell, so it stays, as does
an idle one holding for a lap GO: its run's pull request open, or GitHub unread (`ownPullRequestKeep`).
MEASURED, when told to park on CI instead: one seat parked itself on its own checks seven times in 25 hours,
each reseat two to six hours behind a nine-minute lap, and each found main moved and rebased again. So `handover
park --wake-on-checks` **refuses** a pull request that is open on a branch the run may own (its `start` branch, its
worktree's current one, or the one the directory the park runs in has out), a head it cannot read, and an open
head it cannot rule out because a current branch is unknown (no worktree recorded, a failed read, a detached HEAD
mid-rebase, or a branch that changed during the head read), before touching cmux (`src/handover/ownLandingPark.ts`,
hatch `SLOPWEAVER_ALLOW_PARK_OWN_LANDING`). `handover park --wake-at` asks close-done's own question through
close-done's own read (`ownPullRequestKeep`): an OPEN pull request on the run's branches (the doc's `branch:`, its
journal's `start` branch, the slug) or a read that fails refuses it, under the same hatch, so the seat's clock park and
the sweep never disagree about one seat. A question-only park reads nothing.

What still parks is a wait the seat would sit genuinely idle through (there should never be a session that is not doing work) — a repair seat sleeping to a recipe's next firing, a
seat waiting on another branch's pull request:

```bash
slopweaver handover park <slug> --wake-on-checks acme/acme-admin#<n>    # ANOTHER branch's CI, merge or close
slopweaver handover park <slug> --wake-at <UTC instant ending in Z>         # a clock, with no own pull request open; UTC, ending in Z
slopweaver handover wake [--dry-run] [--json]                               # the tick's ONE reading that reseats
slopweaver handover wake --retry <nonce>                                    # one deferred reseat, once the backoff opens
```

- **Either flag lets an ACTIVE run park** with no open question; the two are mutually exclusive, and a question
  may stand beside one. The checkpoint carries the wake (`src/handover/parkWake.ts`); the row reads `parked
until <iso>` or `parked on CI for <repo>#<n>`. A checks park journalled on a seat's own pull
  request by an older build still wakes as below; the reseated seat is told to keep its seat and does.
- **`handover wake` reseats a due one by a visible `cmux spawn <slug> --model opus`** — the `supervisor tick`
  reading right after close-done. A checks wake is due once every check is terminal, RED included (a failed
  build is what the seat comes back to fix), or the pull request merged or closed. A failed or truncated read (a context
  that did not decode included) is UNKNOWN and never wakes, and so is a read cut at 30 seconds or one the run's
  two-minute judging window closed before it started — reads run six at a time, longest-waiting first (below), so a
  park the window shut out is read next tick (`src/cli/commands/handover/wakeJudge.ts`). Neither does a journal with
  a line this build cannot read, a slug two docs share, or ANY park while a board doc will not read (its slug is
  unknowable) — that last exits 1 naming the doc.
- **Longest-waiting first, inside the boot window's share**: work still to land, then ended pull requests, then
  docs naming no `repo:`, each group longest-waiting first; at most three reseats a run, fewer while boots are in
  flight ([waking-a-park](waking-a-park.md#longest-waiting-first-inside-the-boot-windows-share)).
- **A merged pull request's park is offered to `handover finish` first, and spends no boot**: the real verb, bound
  to that park, every gate still deciding
  ([waking-a-park](waking-a-park.md#a-merged-pull-requests-park-is-offered-to-handover-finish-first-and-spends-no-boot)).
- **Wake runs once a tick, and every wake shares one journal** (`$SLOPWEAVER_HOME/ledgers/handover-wake.jsonl`,
  `src/handover/wakeJournal.ts`). Each reseat appends what it acted on BEFORE `cmux spawn` runs: the park's index
  and instant, and the observation — the instant, or the pull request's state with its head and a digest of every
  check run on it. A seat re-parked on the condition the wake that last reseated it, this run cycle, already acted
  on is HELD, read `not-due`, until a new head, a re-run, a merge, a close or a new instant; MEASURED, a second wake on one tick booted a
  seat that had just re-parked on the green head it had enqueued. A per-park claim, held across the spawn, makes a
  wake reaching a park another wake is reseating read `reseat-in-flight`, do nothing and exit 4, since that spawn
  may still fail. An unreadable journal
  reseats nothing and exits 1 on any tick with a waking park, due or not, until it is repaired, since any line may
  be a reseat already made.
- **A backoff deferral prints its own retry.** A `spawn-deferred` row carries `attemptNonce` and `retryAfterIso`,
  the text output `retry: slopweaver handover wake --retry <nonce> (backoff opens <iso>)`. Run exactly that, as a
  background job: it waits for the backoff and judges that one park again, or exits 4 when the opening is more than
  fifteen minutes off, was never read, or the attempt never settled, and the next tick's reading takes it. A `--dry-run` never waits and never
  reseats, so over a deferral still owed it always exits 4.
- **A park `cmux spawn` refuses forever is CLEARED, never attempted** — a settled ask, a finished or shipped run, a
  terminal row (`src/handover/permanentRefusal.ts`, the predicate both share). Before any clock or check is read,
  the wake appends `park-cleared` bound to that park's journal position: no seat opens, no phase moves, no spawn
  is spent, and `--dry-run` reads `would-clear` and writes nothing. A PAUSED row's park is `paused-skipped` and
  kept, since unpausing is the owner's decision — unless the row is also refused forever, which no unpause lifts. Measured: two settled asks took two of every wake's three
  spawns and deferred nine live parks.
- **Residue, stated:** a clock wake is as punctual as the next tick; a wake spawn goes through the fleet spawn
  backoff, so a held machine defers it (exit 4): the row reads `spawn-deferred`, every later due row that run
  `due-deferred`, each park stays due for the next wake, and the wake itself exits 4 whatever else came up;
  a seat already holding a background wait keeps it until it is respawned. The re-park guard tells a re-run with no run id
  (a legacy commit Status, another app's Check Run) by the instant GitHub dated it, so it cannot tell one GitHub
  dated nothing that also has no URL, and a re-park on the same merged
  pull request or the same instant stays held by design; the retry instant ignores the boot-burst hatch, so it can
  only wait longer than it had to. The claim orders wakes only: a seat `cmux spawn` boots for another reason
  between a wake's last park read and its spawn is not excluded, since `cmux spawn` refuses no park already cleared.
