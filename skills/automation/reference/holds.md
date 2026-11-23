# A hold — the off switch a re-enable cannot undo

`automation due` prints two kinds of OFF, and the difference is what it costs to reverse.

- **`OFF · disabled`** — `enabled: false`. `automation enable <id>` on the owner's anchored words resumes the row
  that night, `automation disable` pauses one, never a hand edit. A pause, not a deletion, and not a rail.
- **`OFF · HELD`** — a `hold` on the definition, which **outranks `enabled` entirely**. A row carrying an
  uncleared hold is never due however that boolean reads, so `automation enable` refuses it and changes nothing.
  `automation run-due` prints the refusal in place of `would run`. A row that does not belong on this install at
  all is neither: it is RETIRED ([retired rows](retired-rows.md)).

## What a hold is made of

```json
"hold": {
  "reason": "owner: the alert-channel digests are off until the owner approves new versions in the owner's private bot DM",
  "askedIso": "2001-01-01T03:00:00.000Z",
  "clearedBy": null
}
```

`clearedBy` is REQUIRED and nullable rather than optional. "Nobody has cleared this" is a value the row
STATES, because an omitted release and a forgotten one are indistinguishable, and a rail like this must never
guess which it is looking at. A malformed hold — a release missing its `ts`, an empty `dmChannel`, an empty
`reason` — refuses the whole definition, which parks the row. That is the direction it has to fail in.

## Who placed an owner hold

The owner's ruling: **an automation the owner approved is exempt from a later general steer unless the owner's words
name it**, and a hold on it carries the owner's words naming it. MEASURED: `vulnfix-topup-acme-admin` was held on "owner … chose 'Hold, discussion first'" when the
chair had pressed that option itself, carrying the owner's earlier general steer onto it. A chair keypress, a menu choice
or a seat's inference is never "owner chose". So an owner hold carries `placedBy`, and the row may declare `names`:

```json
"names": ["vulnfix topup"],
"hold": { "reason": "…", "askedIso": "…", "clearedBy": null,
  "placedBy": { "anchor": "talk:<turnId>", "words": "<the owner's exact words there, naming the vulnfix topup>" } }
```

`anchor` is an anchor on the owner's words (`talk:`, `call:`, `talk-call:`, `transcript:`, read by
`handover/hisWordsResolve.ts`); `words` is quoted from that record — matched after both are lowercased (`en-AU`, not full Unicode case folding)
and whitespace runs collapsed, so a line wrap or a capital does not refuse it — and must contain the `recipeId` or a
declared name WHOLE — no letter, mark, digit, connector or dash adjoining it, so `row-a` is not named by "pause
row-alpha". A name is a literal, unambiguous name for this automation, never a topic ("security"). The
AUDITED view (`automation due`, `automation status`; `live/automation/auditedDefinitionStore.ts`) judges each hold:
`anchored`, `unanchored` (no `placedBy`) or `unresolved` (with which check failed). The judgement is never on the
row: `ownerHoldPlacedByStateOf` answers only for the frozen `placedBy` the audit minted, for that row's names, so
a hand-built or copied one reads `unresolved`. Only an `anchored` the audit minted for that row reads as the owner's: a reader asks
`ownerHoldIsOwners` with the recipeId it is describing, never `kind`, so a spelled `{ kind: "anchored" }`, or one
carried over from another row, is not the owner's. Every other state, a held row with no state at all included, prints
**`UNOWNED`** (`!! UNOWNED` for a kind with no executor), after `BROKEN` and above `DUE`, tallied, and the
card puts the next step on the fleet: find the owner's word naming it and write `placedBy`; with none, ask on the owner's Queue,
once, whether to lift it. Never delete the hold unasked: a hold written before `placedBy` existed can still be the owner's.
**The hold stands in every state**; this changes the report, never the schedule.

## There is no hatch, and the refusal says so

A hold has **no escape hatch and no environment override** (`.claude/rules/error-handling.md` § "A `hold` has
no hatch, and says so"). The line names the absence rather than staying quiet about it,
because silence reads as a forgotten hatch and sends the next session hunting for a `SLOPWEAVER_ALLOW_*` that
does not exist.

## Lifting one

**Ask the owner on the Queue, never in the owner's DM** (a question like this belongs on the Queue, not in a DM). Record the question with `slopweaver handover register --ask …`
(or `handover ask <slug>` on a run of yours); a bot post to the owner's DM that asks is refused
(`src/outbound/slack/ownerDmAsk.ts`). Once the owner has answered, write that run into `clearedBy`:

```json
"clearedBy": { "runSlug": "<the row the owner answered>", "atIso": "<when>" }
```

The run's journal carries the owner's `answered` event (`slopweaver handover resume <slug>`). If the owner volunteered the
approval in the owner's DM instead, that message counts too:

```json
"clearedBy": { "dmChannel": "<the owner's bot DM>", "ts": "<the message ts>", "atIso": "<when>" }
```

Each arm is a strict object, so a release naming both is refused. Either names ONE word a reader can go and
read. That is an **anchor, not an authentication**: per
[cross-session-messages.md](../../../.claude/rules/cross-session-messages.md) § "Anchoring an authority", a
post under the owner's identity and a `handover answer` are attributable and never proof, because this system can write both.
What a recorded anchor buys is narrower and is the whole point — a wrong one is visible, and a
missing one refuses. Same bar as a [journalled grant](../../../.claude/rules/journalled-grants.md): ORIGIN,
not authority.

## A failure hold — placed by the store, lifted by the fix

A row whose firing fails is paused until its fix lands, never cooled and fired again to fail the same way. Measured:
nine rows had failed every firing for days, each retry filing its own finding, so one broken Vanta sync stood behind five findings.

**A FIRST `KILLED_BY_SIGNAL` is not the row failing**: something outside the firing ended it, so it is retired and
stamped and the NEXT slot fires, with no hold and no finding; a second consecutive kill, or an unreadable runs file,
holds as below (`live/automation/signalKillGrace.ts` carries why, and the overlap it does not cover).

So a failed firing — `failed` at any attempt, or `dead` for any other reason — holds the row, and the hold names ONE
p0 finding (the fleet spins up its own p0 seats to fix broken integrations), `recipe-failing-<recipeId>-<slot>-a<attempt>` (`live/automation/failureHold.ts#failureFindingSlug`):

```json
"hold": {
  "reason": "held by the store: <recipeId>'s <slot> firing failed on attempt 1 (<how>); … the fix is board row <finding>",
  "askedIso": "<when>",
  "clearedBy": null,
  "finding": "recipe-failing-<recipeId>-<slot>-a1"
}
```

- **One finding per broken row.** A failure hold that already stands is never replaced: a second failure
  while the first finding is open files nothing. The owner's own hold outranks a failure hold and is never replaced
  either, but it names no finding, so a firing admitted before the owner held the row and failing after files its own
  finding beneath the owner's hold: a paused row is still a broken integration. If the hold does not write, the finding
  still files and the line says `NOT held`; one that does not land is owed exactly as below, since a dry run fires
  nothing and a healed firing files nothing, and a second failure meanwhile files its own slug — a duplicate
  rather than a silence. Whether a finding landed is read off the BOARD — a row that reads as
  that exact slug, live or archived, the same read the hold lifts on — never `handover register`'s exit code:
  that is non-zero on a mirror failure over a row it wrote, and a 0 with no row is not filed. A path holding
  something else (a directory, another slug's doc) has not landed. A finding that is not on the board keeps the hold — a held `write` recipe must not run its
  effect again — and is recorded OWED in `$SLOPWEAVER_HOME/live/recipe/finding-debt/<finding>.json`
  (`live/automation/findingDebt.ts`), argv and all: every `automation run-due` retries it, clears it once the
  row exists (an archived one included, so finished work is never re-registered), and FAILS while it is still
  owed, or while the debt directory will not list. If the debt will not write either, `run-due` still FAILS on
  the failure hold itself, naming a slug no row carries and no debt owes — on every tick, a `--recipe` one too,
  since these read the whole roster. Beneath the owner's own hold, which names no finding, the failure's own
  slot-ledger row (settled after the owner's `askedIso`) is read back instead (`live/automation/ownerHeldFailures.ts`). A hold like that is otherwise invisible, since no supervisor tick reads a
  held recipe. One window stays open: a hold of the owner's asked between the failure's settlement and its
  classification, with the register AND the debt write both failing, is read back by nothing after the one
  tick that printed it, which fails naming the by-hand `handover register` — the owner's hold is hand-written JSON, so
  no lock orders it against the settlement. A failure whose hold, row and debt ALL fail to write is caught the
  same way, by the one tick that printed it, saying nothing durable names it.
- **The finding names its `repo:`**, the declared main checkout (`checkoutForRunningRepo`), so `cmux spawn`
  can seat it. A repoless row is held off RUN NOW and the spawn refuses it: the Notion resync's finding sat
  that way for hours until the owner saw it, so the recovery must be self-healing and structurally impossible to
  recur. If no checkout resolves, the finding files without one, the line reports `failed`,
  and the diagnostic names `slopweaver handover set-repo <finding> --repo <main checkout>`. The chair cannot
  skip it either: `supervisor tick-record` and `tick close` REFUSE a tick that read a `recipe-failing-*` row
  with no live seat, no completed spawn and no `hold-rationale` naming it, in every standing EXCEPT
  `waiting-on-owner` and `paused`, whose row already records its reason, the owner's open question or the person its
  `pausedOn:` names, in a standing nothing but that record reaches (hatch `SLOPWEAVER_ALLOW_UNSEATED_RECIPE_FAILURE`,
  `supervisor/recipeFailureGate.ts`). It judges the board the tick OPENED on, as every sibling gate does, so a
  finding filed mid-tick, or a seat that died after its spawn, is the next tick's to refuse. A workspace on a
  `recipe-failing-*` row seats it only while a pid in its cmux process tree is an interactive Claude Code session
  registered in `~/.claude/sessions` whose `procStart` still matches `ps` — the identity rule `fleet resume` binds
  by (`fleet/liveSeat.ts`): a shell or a `vim` left by an exited agent or a reboot, a pid a dead session's file
  shares with a later process, or a read that failed, seats nothing, so the row is RUN NOW again and the gate
  refuses it; a seat on another host is named in a `hold-rationale` (`cli/commands/handover/recipeFailureSeats.ts`).
  Three qualifications are stated rather than closed: the hatch is ambient, as every non-outbound policy hatch is
  (`.claude/rules/error-handling.md`); a completed spawn answers the tick that made it, and its seat is proven or
  refused on the next; and that identity rule's own limit — a pid reused within the same second, or between the
  `ps` and tree reads — is shared with every verb that binds by it. A fourth sits under every tick gate alike: `tick
close` reads the `reconcile.json` the tick directory holds, which a process writing `$SLOPWEAVER_HOME` could
  replace before close — the local-writer residue [journalled grants](../../../.claude/rules/journalled-grants.md)
  states. A finding slug two live docs claim — never
  written by `handover register`, only by hand — makes the gate refuse until one is renamed or archived, since
  one seat on it would answer both (`reconcile --json`'s `duplicateRecipeFailures`).
- **It lifts on the fix, read off the board**: the finding settled `answered` (the fix is its witness), or
  settled `filed` as a row that is `done` — followed ONE step, since lifting on the filing alone restarts a
  job with no fix in it. Settled `declined`, only `clearedBy` lifts it, exactly as the owner's own hold. Unsettled,
  missing or unreadable, it stands, and the line says which.
- **`findingState` is derived, never stored.** The LIFTED view (`automation due`, `run-due`, `seat`) reads the
  board and carries `hold.findingState`; the STORED view (`board: null`) does not, and a failure hold with no
  `findingState` stands. The schema strips a stored one. A lifted row is due again on its own cadence.
- **Every writer of a hold takes one lock**, `RECIPE_DEFINITION_HOLDS_LOCK_KEY`
  (`live/automation/failureHoldStore.ts`), and writes only the `hold` key; `register-resyncs` re-reads the hold
  under it, so a re-register keeps a hold placed a moment earlier.
- **A take asks again.** `rowHeldNow` reads the file and the board at the moment of a take and a seat's
  claim, so a row a sibling's failure held since the roster was read is skipped rather than fired. A take also
  walks back over the row's last 48 firings and every whole hour of the last 48 (`live/automation/strandedAttempt.ts`):
  a run that started there and died with nothing judging it — even after a successor stamped past it, or a
  re-derived cadence stopped firing on its instant — is judged now, and holds the row before the new firing runs — unless it was TAKEN before the row's lifted failure hold was placed, which its fix or the owner's `clearedBy` already answered (MEASURED: one outage re-held `resync-corpus-github` on its older death 13 minutes after the newer one's finding was answered). A dead firing is held BEFORE its watermark moves. One window stays open: the
  ledger's `dead` or `failed` write lands a moment before the hold, and a second dispatcher taking the newer
  firing inside it fires the row once more — whose own failure then files nothing, the hold standing.
- **The silent-row monitor still sees it.** `live/automation/silentRowReader.ts` sets a failure hold aside before
  judging, so a held row that is missing its firings still reports `MISSED` where the owner reads — the hold pauses
  the row, it never hides it.

**A failure hold is the fleet's to lift, on sight.** `automation due` prints it as `OFF · HELD by the store — <the
finding's board state>` (the lifted view's `findingState` line, so a `declined` finding says only the owner's word lifts
it), and the owner's own hold as `lifted only by the owner's recorded approval`. They print apart because, MEASURED on one shared line, six resync rows sat held for days
because it read as blocked on the owner. The standing rule: repairing a stopped automation, corpus resync
or atlas resync never needs the owner's ask. So a seat takes it (`automation repair <id> --row <slug>`), runs the `explain`
it prints for an unwatched failure, fixes the cause or proves it transient with a green `automation resync`, and settles the finding `answered --witness <the fix>` —
[monitor](../../monitor/SKILL.md) § recipe-stopped.

**A row held on a failure prints FIRST, marked `BROKEN`, and the tally counts it** (`live/automation/dueReportLines.ts`).
MEASURED: `resync-corpus-notion` sat OFF on its finding for a day, printed 34th of
the roster, and the owner saw Notion failing on the owner's sidebar before the chair did. An `UNOWNED` hold prints next; the owner's
anchored hold and a disabled row stay in roster order. The chair's `tick open` joins each `BROKEN` row to its finding's seat and prints the command that
seats it ([derived-narrative](../../supervisor/reference/derived-narrative.md#recording-a-tick)).

A failure hold's row is the canonical `<recipeId>.json`; a definition under any other file name cannot be
held, and its failure files the finding and says `NOT held`.

## Why a decision of the owner's is a hold, never `enabled: false`

The case: the bot's messages in the alert channels were noisy, so the owner wanted them deleted and the rows kept
from posting again until the owner approved new versions in the private bot DM. The `*-critical` rows carried
`enabled: false` and no hold, so the sweep that enumerated live rows never looked at their channels — and the
owner found a digest still up in `#alerts-platform-p1`. One boolean is not a record of a decision; a hold is. Which
rows carry one is install state: read `slopweaver automation due --json` (`offReason: "held"`), never a doc.
