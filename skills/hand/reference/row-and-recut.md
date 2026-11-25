# A card names its row, leaves when the row does, and a re-cut replaces it

A store-backup card once stood first on the owner's queue for three hours after the row it waited on had closed,
beside a second card about the same thing, and a re-cut elsewhere was done as two separate commands. The owner must
never review anything already settled, because that wastes the owner's time. Nothing read whether a
card's work had finished.

## Every post says which kind it is

`hand post` takes exactly one of:

- **`--row <slug>`** — the board row this step unblocks. The row must be on the home's board
  (`$SLOPWEAVER_HOME/handovers/<slug>.md`, live or archived), read whole, and not already done, cancelled or
  rejected; a typo is refused rather than pinning a card to the owner's queue for good. A board kept under
  `handover --dir` is not one a card can name.
- **`--standalone`** — no board row owns this step. Said out loud, because such a card can never leave on
  evidence; only `hand done` or `hand retract` takes it down.

Neither, or both, is a usage error naming the two flags. Nothing is inferred: `--by-session` is free text and
`--unblocks` is prose, so a guess would be wrong exactly when it mattered.

## A row's held question is not asked over the owner's answer

A `--row` whose run is waiting on the owner over a held question is refused while the owner has spoken over that
question's card (`ask:<slug>`) since it was asked, in any call written since, until every such utterance's anchor is
named in `--read-owner-words <call:<id>#<segment>,...>` (`src/handover/ownerWordsBeforeReask.ts`, hatch row
`held-question-owner-words`). Voice-opened cards and words the voice never judged an answer are listed too, since
only you can tell a greeting from "I have saved it". The check runs before the page look and again under the register lock; `handover park` checks again right before its journal append. A call
file that will not read, or one naming the card with a line that did not parse, refuses until its call id is named
as read by hand. It cannot see words said over no card: the measured miss behind it is a call whose
"I have saved it" the page wrote unstamped, and a note asking the owner to paste the password again the next day.

## It leaves on evidence

`hand list`, `hand show` and `hand push` reconcile before they read (`src/hand/reconcile.ts`): the owner's Done presses,
and every open step whose row now derives `done`, `cancelled` or `rejected` (`isTerminalDocStatus`, the board's
own vocabulary). Each is settled as `retracted by evidence — row <slug> is <status>, no hand touched it`, in the
same lock-held append, and its note is told to close. A step another writer settled between the pass's read and
its lock is skipped, never a refusal of the rest, and a marker that will not come off disk is reported, never
thrown. The console reads the queue through `hand list --json`, so the card is gone on the next poll.

The status comes from the row's doc and journal alone (`src/handover/rowState.ts`), the same `derivedRowState`
the board composes — never its probes or `blockedBy` closure. **A row that is missing, or did not read whole
(a doc that will not parse, one journal line that did not decode), settles nothing**: the step stays, stderr
says why, and `hand list --json` carries it on the step as `rowProblem`, because the console keeps stdout only.

**Settling a relay row over the card is a writer too.** `handover settle --card done` appends the card's settling
under this register's lock, naming the row and its witness, after re-reading that the card is still open; `--card
recut --card-new <id>` writes nothing and checks the re-cut's `settles` edge below, never a `did`'s words; and
`--card kept --card-why <why>` leaves the step open, its reason on the step as `keptReason` in `hand list --json`
and as `kept because` in the text list and on the card. A register with an unreadable line refuses all three.

## A re-cut is one line

`hand post --supersedes <open id>` writes the new posting carrying the old step's settling (`superseded by <new
id>`) as ONE register line under the register's lock, and closes the old note before raising the new one. Every
reader folds that line as the posting followed by the settling (`src/hand/row.ts`'s `rowsOfLine`), so a crash
leaves the re-cut whole or not written: a line cut short is a torn last line (below), and the old card stays alone
until the retry writes the re-cut again. The same settling then follows as a plain line, for a reader built before
`settles`: it folds one row per line and ignores the field, so to it a crash between the two lines leaves both cards
until the same re-cut is retried, which writes that plain settling alone, copied from the re-cut line rather than
stamped at the retry's instant: the one it finds on disk is carried by the re-cut line (told apart by identity,
`src/hand/multiAppend.ts`'s `retriedPlan`), not a line of its own. It refuses
an id that is not open, and a re-cut keeps its row in both directions: one naming a row stays on it, and a
`--standalone` card stays standalone, or a cut-short re-cut leaves a half evidence never reaches. Retract it and
post afresh if the work changed. A register an earlier build wrote a re-cut into as two lines, torn between them,
holds the posting without its settling: the same re-cut retried writes the settling alone, and the row is asked
about only by a write that opens the new card, so a row finished or gone since never strands that retry. A torn
one-line re-cut opens a new card when retried, so a finished row refuses it and evidence takes the old card down.
An exact retry of a completed re-cut is a no-op.

**One open card per row.** A posting naming a row another open step names is `ROW_ALREADY_OPEN`, whatever
writes it, unless it supersedes exactly that step. Any row-naming post, and any re-cut, is refused while the
register holds a line that did not read (`REGISTER_INCOMPLETE`): the skipped line may be the card it collides
with. **The one exception is a torn last line** — no newline, and it does not parse — which only a cut-short append
leaves: every append drops it first, and a last row that lost only its newline gets it, so nothing is ever glued
onto an interrupted write (`src/hand/tornTail.ts`). The dropped bytes are printed.

**The register lock is never taken from a live holder**, however long it has held it; a dead holder is recovered
at once. A holder is its pid AND that process's start time, so a pid the OS has since given another process
reads as dead (`src/admit/lockHolder.ts`) — as does a zombie, exited and not yet reaped, which still answers signal 0. A record carrying no start stamp — only one an earlier build left, because a process `ps` cannot stamp is
refused the lease rather than writing one — ages out on the ordinary 15-minute window instead, since its pid alone may be another process's. A writer suspended between its read and its append therefore cannot be overtaken by a second
card on its row.

## What this does not claim

- **Monitor cards are separate.** They name no row, settle when their own subject departs (`src/monitor/`),
  and are not deduplicated against a hand card about the same work — the store-backup pair was one of each.
- A step posted before `--row` existed names no row, so it leaves only by hand.
- A renamed row is a missing row: its card stays and says so. A re-cut keeps its row, so settle the old card
  with `hand done` and post a fresh one naming the new slug.
- A two-line re-cut an earlier build wrote and a crash tore between its lines leaves both cards open on the row
  until the retry completes it or the row finishes and evidence settles both. A cut inside an EARLIER line — not the last — is a skipped line the
  register cannot account for, and every row-naming post then waits for it to read clean.
