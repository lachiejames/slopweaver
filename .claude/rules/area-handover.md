---
paths:
  - "src/handover/**"
  - "src/cli/commands/handover/**"
---

# Working in `src/handover/`

The orchestration board and the run journal. Scoped to this tree so a session working anywhere else never
pays for it; the doctrine it implements is `AGENTS.md` § "If an orchestration run is open".

## The four claims this tree exists to hold

- **One composer, not three readers.** `boardState.ts` combines authored status, repository probe evidence
  and the run journal once, by an ordered precedence list that stops at the first match — the list is
  `boardEvidence.ts`, the `blockedBy` pass after it is `boardDependencies.ts`, and both read the vocabulary
  in `boardTypes.ts`. Before it, three
  callers each interpreted a slice and the board could say `RUN NOW` for work `start` itself refused. Any
  question about whether status and the journal disagree goes to `consistencyOf`, never to a second
  hand-rolled equivalent.
- **A probe downgrades confidence; it never flips a doc.** `probe.ts` proves a SYMPTOM is absent, which is
  not the scope having shipped. Auto-completing on a green probe would be this repository's silent-failure
  class again: state reported true because a proxy for it was true. An unreadable file is never a PASS.
- **The ledger is append-only and lives on disk**, because a context window losing itself must not lose the
  run. Sorted by durability: a file survives compaction and session death, a hook survives because the
  harness re-injects it, prose in a doc survives only while it is in the window.
- **One shared home, many vintages of the reader — so an unknown KIND is not corruption.** Every checkout on
  the machine writes into the one `$SLOPWEAVER_HOME`, so the journal format is read by as many decoders as
  there are worktrees. `parseLedger` reports a well-formed line whose kind a build has no case for in BOTH
  `unreadable` (unchanged meaning) and `unknownKind`, and the OWNERSHIP guards take `ownershipAmbiguousLines`
  — everything unreadable except an unknown kind declaring no `sessionId`. Adding a kind to `RunEvent` without
  naming it in `KNOWN_KINDS` fails to compile. Phase-sensitive and correctness guards keep reading the whole
  set: an old build can still fold a phase wrongly over a future terminal kind, which is stated residue. A
  refusal that DOES survive names the word it could not decode and tells the session to pull; its hatch is
  `SLOPWEAVER_ALLOW_STALE_JOURNAL_READER=1` (`src/handover/staleReader.ts`).
- **An ask about a MESSAGE carries the message, and its options are DERIVED from it.** `askAction.ts` holds
  the drafted body, its mentions and its one to three destinations; `askActionDestination.ts` holds one
  place's own rules; `askActionOptions.ts` turns the destinations into the options, in order, with HOLD
  last. `--options` is refused beside `--action` at the verb (`cli/commands/handover/askOffer.ts`) because
  the options ARE the destinations — a caller allowed to author both could record "post it to #delivery" beside
  a draft addressed somewhere else, and the card would print the owner's choice over the wrong message. **That
  refusal is only half the guarantee**, because the journal is a hand-editable file every checkout shares:
  `questionLineDecode.ts` therefore DERIVES the options on the way in and ignores the ones a line stored, so
  the two cannot disagree whoever wrote it. And at the console boundary a destination that will not read
  invalidates the WHOLE action (`site/components/live/readAction.ts`) rather than leaving the survivors — a
  subset offers the owner two places for a message the row says goes to three, reading exactly as complete. **A
  draft present and unreadable is a THIRD state carrying no options at all** on both sides (`optionsOf`,
  `site/lib/queueRows.ts`'s `askedOptions`): it is not an ask with no draft, and its stored list describes
  destinations that no longer read. **Dropping the bad action is only half of THAT**, because a row with no
  action reads as one that never offered a draft and `listJson.ts` then fills the options from the doc's own
  front matter — so `actionUnreadable` travels as its own field from `ledger.ts` through `openQuestion.ts`
  and `boardTypes.ts` to the published row, and `readAction.ts` answers `invalid` off it. **What turns that
  fallback off is `offeredADraft`, the OFFER rather than the defect**: a readable action whose journal line
  carries no `lean` has no journalled shape either, and suppressing only the broken case published the
  #delivery action beside the doc's "DM Tobias". **What the row then publishes is derived from the ACTION**
  (`optionsFor`, same `actionOptions` the verb and decoder call) rather than read off the shape, which on
  that same line would be an EMPTY list beside a good draft — a message with no way to send it. All six
  found by this change's own r1 review, each with a
  counterexample that ran. The caps
  bite HERE rather than in the console, because a fold would hide half of a message about to be posted at
  full length. `question-offered` is its own kind rather than a second `question` for the same reason
  `question-corrected` is: re-asking would reset the instant every surface reads to say how long the owner has had
  it, so an offer replaces the action and the shape together and touches neither the text nor the clock. It
  is inert in `ledger.ts`'s phase fold and projected by `openQuestion.ts`, which is the fold a card reads.

- **A recorded question is a legitimate ending — unless the owner has already answered it.** `waiting-on-owner` is
  success, not failure, and it is what separates this from a loop that wakes forever to report it still
  cannot proceed. The exception is a stop on standing doctrine: `preApprovedStop.ts` classifies one, the
  board labels the row instead of printing an ordinary pause, and `../../src/devLint/registerHygiene.ts`
  reports it on every push. The class it holds today is cassette recording
  ([testing.md](testing.md#recording-a-cassette-is-pre-approved--never-stop-to-ask)); the next ruling of that
  kind lands as a ROW in that module, never as a second gate. The owner's words since the ask are the other way it
  stops being one: `ownerWordsBeforeReask.ts` lists every utterance over the run's own `ask:<slug>` card since
  `askedIso`, read from the call records, and `hand post --row` and `handover park` refuse until each anchor is named
  as read. Same card, exact anchor: words over no card need the voice's judgement, never a name match here.

## A `command:` probe names itself, and its child launcher stays quiet

A probe's verdict is printed as ONE line, so that line has to carry both which probe it was and how it
ended. `commandProbeRunner` returns a `CommandProbeOutcome` — an exit status, a signal, a launch
failure, or the runner's own timeout (read off `ETIMEDOUT`, never the status a child that trapped `SIGTERM` chose),
never a boolean — and `commandProbeNote` prints the whole command beside it. The shell runs under
`src/worktree/shell.ts`'s supervisor, so a probe that hits its bound takes every process it started with it, and a
command killed by a signal arrives as the supervisor's 128-plus status. Truncating the
command would produce a line that reads perfectly and identifies nothing, which is the defect rather than
a smaller version of it.

The budget is also named where the probe is WRITTEN. `checkWholeSuiteGateProbes` (`src/handover/check.ts`,
reached by `handover check`, not by `lint`) reports a `command:` probe that runs a `yarn`/`npm`/`pnpm` script
with nothing after the script name — a whole
named script is weak evidence at any speed, and spends an unbounded lap against `COMMAND_PROBE_TIMEOUT_MS`.
The criterion is that grammar and not a list of slow command names, which would go stale and could not travel
to another repository; one narrowing token exempts a segment, a `$(…)` silences the whole command, and it is a
finding rather than a refusal because the run-time reading is already honest. It states the budget as a RISK
and never claims a timeout it cannot time: `yarn hygiene` is flagged and runs in 5.4s.

The runner hands its child `SLOPWEAVER_LAUNCHER_QUIET=1` (`src/lib/launcherEnv.ts`), which suppresses the
advisories `bin/slopweaver` prints to stderr before running a verb. MEASURED: a probe written
as `… 2>&1 | head -1 | grep -q '<verdict>'` read the cross-worktree warning as line one and reported a
failure no hand re-run reproduced, because a plain shell exports no `PLUGIN_ROOT` and so warns about
nothing. Scrubbing that variable instead was tried and refuted — the `slopweaver` on `PATH` is the plugin
mirror, so a bare-`slopweaver` probe would have silently stopped testing the session's own branch.

## The finding gate, and why it is exact

`findingGate.ts` decides whether a branch belongs to a row the owner has never ruled on, and the doors that
reach a teammate refuse on anything but `clear`. A branch finds its row by three EXACT matches — the row's
declared `branch:`, the branch its journal recorded at `handover start`, or the slug itself. Name similarity
is the fuzzy matching this repository forbids; a branch matching none of these is simply not a finding's
branch, and the door stays open. That is the honest failure direction.

## A ruling gate is the SECOND run-time read of a ruling, and it is deliberately blunt

`findingGate.ts` asks one question of a ruling: has the owner ruled on this branch's row. `rulingGate.ts` asks a
different one — does a ruling they recorded REFUSE the verb about to run — and the answer is read at the CLI
dispatch boundary, ahead of every verb, by a session that may never have heard of the ruling. That placement
is the whole mechanism: the failure it closes is a recorded DM-only ruling carried from
the turn that heard it to the verb that violated it by nothing but one chair's memory, across an
auto-compaction.

Three things here are the design rather than notes, and each has a witness:

- **The projection is a CACHE and it fails OPEN.** `$SLOPWEAVER_HOME/ruling-gates.json` exists because a
  board scan costs 6.4s against a 4.1s bare CLI start (`rulingGateIndex.ts` carries the measurement and its
  repro). The journals stay the source of truth, `handover gate rebuild` reprojects, and `handover gate
check` reports divergence without repairing it. An unreadable file lets the verb RUN — a corrupt cache
  bricking every verb on the machine is a worse outcome than a missed refusal, and pretending otherwise
  would be the silent-failure class this tree already names.
- **`UNGATEABLE` is frozen and held on BOTH sides.** `handover rule`, `handover gate` and `handover list`
  cannot be gated, because a gate on any of them leaves no verb able to record a ruling, lift a gate or read
  the board. `parseGateSelectors` refusing the flag is the loud, early half and it is NOT the invariant —
  `$SLOPWEAVER_HOME` is shared, hand-editable JSONL, and `rowEventSchema.ts` validates a gated pair's SHAPE
  rather than its membership, so any other caller of `applyRowEvent` reaches the journal without passing the
  flag parser. `standingGatesOf` therefore drops such a gate whole, exactly as the writer refuses a
  `--gates` value whole. Found by this change's own r1 review, with a counterexample that ran.
- **A reconstruction authors no refusal, on BOTH halves.** The write schema refuses a `gate` or a
  `gateReleases` on an event carrying `backfilledFrom`, and `standingGatesOf` projects from live rulings
  only — the same two-sided property `latestFindingRuling` holds, for the same reason.
- **An undecodable line never refuses the owner's LIVE ruling; it is skipped and stated.** `rowEvent.ts` appends any
  ruling with no `backfilledFrom` over such a line and hands the skipped lines back, and `handover rule`
  prints the count, the lines and the word this checkout predates. Twice measured with no hand edit, since
  every checkout shares one home and a newer kind is `unreadable` to an older decoder: once a gate
  `handover gate list` called in force could not be released; once the owner's read of a briefing went onto a
  fresh row because the one they were looking at held a `parked` line the chair's checkout predated. A live
  ruling claims only "not already said exactly this", so a skipped line can hide at worst a redundant
  duplicate. A RECONSTRUCTION is still refused: its source is a claim about exactly the lines nothing can
  read. `isLiveRuling` is the criterion.

The verb surface, the release path and the blunt/precise split are
[ruling-gates.md](../../skills/handover/reference/ruling-gates.md).

## The Alignment board projection is the second cache, and it fails LOUD

`$SLOPWEAVER_HOME/alignment-board.json` (`alignmentBoardProjection.ts`) exists for the same reason
`ruling-gates.json` does: the console's Alignment count needs only each row's placement fields (section, run,
workspace, tags, pull-request links, action), and the whole `handover list --json` it used to wait on took
tens of seconds over a board of ten thousand docs. The docs and journals stay the truth; the file is a
projection of them, and four things about it are the design:

- **Only a WHOLE default composition writes it.** `alignmentBoardWriteRefusal` refuses a `--tag`, `--base`,
  `--probe` or non-default `--dir` run, and any run whose sweep left a doc unresolved, a doc unread or a
  journal undecoded. A partial board written as if whole is the measured-zero lie the count exists to avoid.
  A refused write only warns: the board the caller asked for was still printed.
- **It is read WHOLE or not at all.** A version, an instant or one row that does not parse refuses the file,
  never a partial row set, on both halves (`alignmentBoardProjectionStore.ts`,
  `site/components/live/readAlignmentBoard.ts`).
- **A missing or invalid file is REBUILT, never served empty.** `handover alignment-board` composes the
  board as `handover list` does, and serves and writes it only when that composition is whole; if the scan
  fails, or a doc or journal would not read, it exits non-zero naming both problems and prints nothing. This is the opposite failure direction to the ruling gate's on
  purpose: a refusal missed is recoverable, while a zero printed as measured tells the owner nothing waits.
- **Served from cache is labelled.** The document carries `servedFrom` and `builtAtIso` (echoed as
  `observedAtIso`), and the console marks a cached count stale until its own full board answers.

## Before you add a row type or a state

Read `AGENTS.md` § "If an orchestration run is open" and the
[one-board reference](../../skills/handover/reference/one-board.md) first. The board's own rules live there
and are deliberately not restated here: a second wording of a root rule is how two rules come to disagree.
