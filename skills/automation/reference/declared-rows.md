# Declared rows — how a DELETED schedule becomes loud

`automation due` reports the rows that are THERE. A row whose definition file is removed therefore reports as
nothing at all, and that silence is indistinguishable from a healthy install.

## The measurement

`live/recipe/lifecycle.jsonl` holds twenty-one records for `worktree-prune`, the last a `completed` for slot
`worktree-prune|<date>|04:00`. Its file then left
`$SLOPWEAVER_HOME/live/recipe/definitions/`. Seventeen days later the count stood at 767 worktree
registrations in slopweaver and 105 in acme-admin, on a volume at 93% — and `docs/worktree-prune/operations.md` still
asserted the row ran daily at 04:00. Nothing was broken; a row simply stopped existing, and no surface was
looking for one that was not there.

The definition store is outside the repository by construction (`live/automation/definition.ts` says why: a row
can carry a real workspace id, an identifier the hygiene gate refuses in a tracked file wherever
`IDENTIFIER_VERDICT` reads `refuse`). So the row cannot be a committed file. What is committed is the **declaration** that it must exist.

## The three pieces

- **`src/live/automation/standingRows.ts`** — `GENERIC_STANDING_ROWS`, one entry per row every install requires,
  each carrying the definition exactly as it should stand plus a `why`: what stops happening while it is gone, in
  the words a reader needs to judge the gap. A team repository's rows are not compiled in: `teamStandingRows`
  (`src/live/automation/teamStandingRows.ts`) builds them from a registration in
  `$SLOPWEAVER_HOME/live/recipe/team-repositories.json` ([team repository rows](team-repository-rows.md)). Nor are
  the two on this repository, derived from the declared checkout's `origin` ([own-repository rows](own-repository-rows.md)). `declaredStandingRows` resolves
  the whole declaration.
- **`automation due` compares rather than lists.** `absentStandingRows` (`src/live/automation/standingRowAbsence.ts`) subtracts what the store parsed from what
  the build declares, and an absence prints FIRST, above every rejected file and every live row, naming the
  `why` and the verb that fixes it. The tally gains `· N DECLARED row(s) MISSING`. Every supervisor pass
  already reads `automation due`, so an absence surfaces on the next pass.
- **A row an earlier build wrote reads `SUPERSEDED`.** `StandingRow.supersedes` lists every definition an
  earlier build declared for that id; a stored row still exactly one of them prints beside the absences, with
  both cadences, and the tally gains `· N DECLARED row(s) SUPERSEDED`.
- **`slopweaver automation register-standing`** writes back what is absent, and brings a superseded row forward. `--dry-run` reports without writing,
  `--json` for a machine, `--home` for a sandbox, `--repo <owner/name>` to register a team repository first. It
  exits non-zero when a declared row is neither present nor written, the team registry cannot be read or extended,
  or no single `slopweaver` checkout resolves.
- **A declared row this build's own reader refuses is never written.** Both writes parse the row with
  `parseRecipeDefinition` first, dry run included: an unregistered kind, an effect past its kind or a
  malformed shape is a per-row refusal naming the parse error, and no file is created or replaced.
  `GENERIC_STANDING_ROWS` is held to the same reader in `standingRows.test.ts`, the template in
  `teamStandingRows.test.ts`.
- **A `REJECTED … which this build does not register` line is relative to the build that printed it.** A
  newer build writes into the same `$SLOPWEAVER_HOME`, so a seat behind trunk rejects a row trunk reads.
  Re-run `slopweaver automation due` from a checkout current with `origin/main` before editing or deleting
  shared-home state; tick close stays fail-closed on the rejection, so the fix is a current seat, not a hatch.

## What it deliberately will NOT do

**Create-if-absent, and bring forward the build's own untouched write — nothing else.** The one rewrite is a
file that, re-read at the moment of writing, parses to exactly a `supersedes` entry: provably a build's own
row, so replacing it overrides nobody. Without it a changed cadence never reaches an install: `worktree-prune`
stayed `0 4 * * *` on the install the hourly declaration was written for. It is judged per FILE: an id standing
in two files, or under another file's name, with an earlier shape in any of them is reported with every file and
never written, because rewriting one canonical file beside a daily copy would never converge
(`live/automation/standingRowSupersession.ts`). No general update, no
ownership file, no adopt; retiring is `automation retire`'s, below. That is narrower
than `live/resync/registrationStore.ts`, on purpose: that registrar's complexity is earned by an OPEN roster
(an atlas joins by being registered, so it cannot know what it will be asked to write next) and by three
separate Codex-found overwrite holes. This roster is CLOSED and short, so the holes simply do not exist.

**It never writes over a path it cannot prove empty.** `occupantAt` treats only a definite `ENOENT` as
absent; a permission error, an I/O error or a directory in the way each answers "occupied", and the row is
left alone with the reason printed. Reading any of those as "nothing is there" is exactly the move that let a
create clobber an operator's file in the resync registrar.

**ABSENCE and an untouched earlier write, never a state.** A row that is present but disabled, held or hand-edited is somebody's
deliberate act — pausing must stay possible, a hold outranks every boolean, and an edit is not this build's
to judge. `automation due` already renders all three ([holds](holds.md)). A file the definition parser REFUSED is
not an absence either: the id is occupied by something, and reporting it as missing would invite a create
over a half-written file. The caller passes those ids as `unreadable`.

**A row RETIRED on this install is subtracted from the declaration**, so it is neither MISSING nor written back
([retired rows](retired-rows.md)).

## Adding a row to the declaration

Add a `StandingRow` to `GENERIC_STANDING_ROWS` (or, for a row every team repository carries, to
`teamStandingRows`) with the definition and a `why` that says what stops happening. Keep
the `params.argv` minimal so the row inherits its verb's own measured defaults rather than freezing today's
numbers into a file nothing reviews — `worktree-prune` names no `--older-than`, `--budget` or `--repo` for
exactly that reason, and `--repo` would also undo the verb's round-robin across both checkouts. Unscoped, the
row sweeps the DECLARED checkouts only; an undeclared one is a manual `--repo <path> --no-salvage` run, never a row.

**Name a flag when the flag is the POINT, not a default.** `bump-drive-slopweaver` names `--repo <owner/name>`,
which is the opposite of the paragraph above and is right for the opposite reason: `github bump-drive` presses
"Merge when ready" on whatever it selects, and the owner draws the line at this repository. Inherited, the
row would resolve the seated checkout's `origin` and could land something team-facing from a schedule nobody is
watching. The test to apply is whether the value is **today's measured default** (omit it — the next measurement
should move it) or **a bound on blast radius** (name it — a schedule is not the place to discover which repository
it was pointing at).

**That value is an install's fact, so it is derived, never compiled in**: the one declared main checkout whose `origin`
repository is named `slopweaver`, whatever its owner ([own-repository rows](own-repository-rows.md)).

**`slack-owed-daily` is SEATED, kind `owed-reply`, and names `--write`.** `slack owed` computes the followed
Slack threads whose last word is somebody else's and, without the flag, writes nothing
([owed.md](../../slack/reference/owed.md)). `automation seat` opens a visible session that parks one reply draft as
the owner per row that asks the owner something, or names why it has none, then runs the row LAST
([owed-reply](owed-reply.md)). Seated because a file only a briefing reads answers nobody: a
question under the owner's own post sat 38 hours listed in it. The declaration `supersedes` the earlier `verb-run` shape,
so an untouched install row is brought forward. `read`, because the drafts are the seat's and a hand-edited argv naming a sending verb is then
refused. `55 8 * * *` sits after the 08:00 Slack resync as ordering intent only — the seat re-reads each thread
live — and `onMissed: "skip"`: a missed morning is the same questions a day older.

**`call-assessment-daily` is SEATED, kind `call-assessment`.** The session classifies each owner passage of every call
whose current words have no verdict, via `talk assessment-record` ([call-assessment](call-assessment.md)). Its argv,
`talk assessment-due --check`, runs LAST, prints counts only and exits deferred while a call is due, so an unfinished
firing is seated again. `read`; `30 21 * * *`; `onMissed: "skip"` loses nothing, as the worklist is every unassessed call.

**`thread-chase-daily` is the inverse of `slack-owed-daily`, and SEATED too.** Its argv is `slack awaiting --write` — the threads whose last
human word is the owner's ask, quiet two business days — but the kind is `thread-chase`, so `automation seat` opens a visible
session that parks one tagged chase draft per thread for the owner's yes, then runs the row LAST
([thread-chase](thread-chase.md)). `read`, because the drafts are the seat's and a hand-edited argv naming a sending
verb is then refused; not held, because every chase already waits on the owner's yes. `30 9 * * 1-5`, `onMissed: "skip"`:
weekday mornings, a missed one a day older.

**No inbox row is declared by this build.** Whether an install's mailbox is triaged, and when, is the install's
choice, so its rows are definition files it writes itself, never a generic declaration. An inbox-triage row runs argv
`gmail triage --write` under kind `inbox-triage`, so `automation seat` opens a visible session that cards each group on
the owner's Queue, acts only under the install's declared policy, then runs the row LAST
([inbox-triage](inbox-triage.md)); `effect: "read"`, so a hand-edited argv naming `gmail archive` is refused. A
meeting-notes row is a plain `verb-run` of `gmail clear-meeting-notes`, run in the tick with no seat
([clear-meeting-notes](../../gmail/reference/clear-meeting-notes.md)); `effect: "read-write"`, because the verb's effect
is the archive, and exit 1 — a mail the next pass must repair — is the signal the row is watched by.

**`meeting-prep-hourly` puts each meeting the owner will talk in on the board.** Its argv is `calendar prep-due`, run in the
tick with no seat: it reads the next four hours of the owner's primary calendar and registers one `--dispatch` row,
`meeting-brief-<instance id>`, per meeting of at most ten people with no row and no tagged page yet. A visible seat
briefs it, `page publish`es and `page tag`s it, and the `meeting-prep-due` monitor floats the page
([calendar](../../calendar/SKILL.md) § prep-due). It exists because an owner's session once started unbriefed. `read`, because the verb only reads Google and writes local rows.
`5 * * * *`, `onMissed: "skip"`: a missed hour is the same calendar read an hour later; exit 3, nothing owed, stamps.

**`linear-briefing-daily` is the same shape over the owner's Linear.** Its argv is `cycle reconcile --verify --write` —
`--verify` because bronze learns of a write only after a refresh, and a stale read would propose one the owner already
made — and the kind is `linear-briefing`, so `automation seat` opens a visible session that briefs every write the owner
should make into Linear (comments, state changes, project updates, superseded, stale to backlog) as ONE page and ONE
Queue card, then runs the row LAST ([linear-briefing](linear-briefing.md)). `read`, because a hand-edited argv naming
a Linear write is then refused; not held, because every write already waits on the owner's yes. `30 17 * * *`, weekends
too, `onMissed: "skip"`: the briefing is cumulative from the last fully applied one, so a missed evening loses nothing.

**`alignment-briefing-weekday` briefs the owner's morning against what the owner's manager will look for.** Its argv is `handover
currency --json` — every ask waiting on the owner, each re-checked — and the kind is `alignment-briefing`, so `automation
seat` opens a visible session that publishes ONE dated page and ONE Queue card, sending nothing, then runs the row
LAST ([alignment-briefing](alignment-briefing.md)). `read`, because the verb's manifest declares `external-read` and
a hand-edited argv naming a sending verb is then refused; a `local-state` verb is still admitted, as for every `read`
row. `0 8 * * 1-5`, `onMissed: "skip"`: weekday mornings, and a missed one is the same sources a few hours older.

## The two morning hygiene rows

Each publishes one document under `$SLOPWEAVER_HOME/live/hygiene/`, whose contract is
[hygiene documents](hygiene-documents.md). Both are `read-write` on `local-atlas`, `onMissed: "skip"`:
each reads current state, so a backfilled morning would only publish stale evidence twice.

| Row                 | Cadence      | Runs                                                         | Publishes                                         |
| ------------------- | ------------ | ------------------------------------------------------------ | ------------------------------------------------- |
| `sweep-board-daily` | `0 7 * * *`  | `sweep board --write --queue --settle-ended --close-shipped` | `sweep-board.jsonl` and `sweep-board-census.json` |
| `hygiene-sweep`     | `15 7 * * *` | the `hygiene-sweep` kind, in ONE seated session              | `github-landing.json`                             |

The order is the point: the seat at 07:15 opens with the board document already fresh. Neither sends to Slack,
comments on or closes a pull request, or changes Linear. The board row's only board writes are its daily Queue card,
the settles retiring its own earlier cards, and the capped `PR_ENDED` settles and `SHIPPED` closes
([sweep](../../sweep/SKILL.md)); its one external read is GitHub's state of each
pull request a live ask's question names. `cycle-reconcile.json` is published by
`linear-briefing-daily`'s own run, above. `hygiene-sweep` carries empty
params because its read is fixed in `src/live/automation/hygieneSweep.ts`; what the seated session does with the
packet is [§ A hygiene-sweep row](../SKILL.md#a-hygiene-sweep-row).

**`bump-fix-slopweaver` names `--dry-run` inside its argv, and is seated like `hygiene-sweep`.** Its kind is
`bump-fix`, spawn-shaped like `resync`, because the work its worklist names — a rebase, a red leg read and
fixed — is a visible session's. `--dry-run` makes the row's own run the worklist and nothing else: a real
`bump-drive` pass registers a board row per bump it seats, and a second session could take one up while this
seat works the same pull request. `15 8 * * *` is 08:15 install-local, after the 08:00 four-hourly drive. The
seated session works the list FIRST and runs the claimed `run-due` LAST ([bump-fix](bump-fix.md)).

## The nightly fleet import

`store-import-fleet-nightly` (`30 2 * * *`, `read-write`, `onMissed: "backfill"`) runs `store import-fleet` in
the tick, every leg, half an hour before the 03:00 backup dumps the store. It is what makes a restore on
another machine bring back last night's board, run journals, boot files and Claude auto-memory rather than
whatever was last imported by hand ([new machine](../../../docs/store/new-machine.md)). A file the authored leg
refuses as a credential — a mirrored memory file included — makes the run exit 1 while every other row still lands; that is recorded against the row, and a
row that keeps running is not `recipe-stopped`'s card. The row never carries `--adopt-unmatched-door-lines`: a door
line appended after the import marker is a one-shot operator repair, `store import-fleet --only door
--adopt-unmatched-door-lines`, never a schedule ([why](../../../docs/store/fleet-state-and-measurements.md)).

## The hourly fleet-capacity survival read

`claude-survival-forecast` (`17 * * * *`, `read-write`, `onMissed: "skip"`) runs `monitor check --only
fleet-runs-dry --fire` in the tick. Its recipe id is a legacy storage key, kept so an installed row keeps its
stamps; the definition is unchanged, so it supersedes nothing. It raises a floating note only when the latest
filed `machine capacity` reading proves every routable Claude and Codex plan spent until a reset, and a clear pass posts
nothing: never a note on a schedule. `--only` keeps it from settling any other monitor's card. The monitor:
[the monitors](../../monitor/reference/the-monitors.md#fleet-runs-dry-a-note-only-when-no-claude-or-codex-plan-can-start-a-seat).

## The daily publication audit

`publication-audit-daily` re-reads what the fleet published and fires the leak monitor; it is declared OFF until the
owner says: [the publication audit row](publication-audit-row.md).
