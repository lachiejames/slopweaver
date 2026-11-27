# The owner's outcomes, and the three places the fleet is held to them

The owner checked in, found most chats idle, and asked how to make that mistake structurally impossible to repeat:
a chair that used good judgement and read everything the owner had said over the last week would have known what
was expected, and a chair that does not know what the owner expects fails again every day. The open question was
which information is lost between supervisors, allowing such deviations between what the fleet does and what the
owner wants.

This file is the answer to that question: what was being lost, and what stops it.

## What was actually lost, measured

**1 · Half the owner's voice never reached any reader.** A message the owner types while the chair is mid-turn is
written to the transcript as an `attachment` line of type `queued_command`, never as a `user` line. Every owner-turn
reader here — `supervisor intake`, the reconciliation's intake clause, the tick ledger's verbatim
`ownerTurns` — decoded `user` records only. MEASURED across the 28 supervisor transcripts of
handoffs 24x–263: **102** such records. The seven-day chain read returned **96** turns before the fix and
**238** after it, **167 of them queued**. Reproduce on one transcript:

```bash
grep '"queued_command"' <transcript.jsonl> | grep -c '"kind":"human"'
```

**The turn stating the owner's eight outcomes is one of them.** That turn and the one widening it are both
`queued_command` attachments — so the statement of what the owner expected, and the widening of it to the owner's team-facing work, were
invisible to every mechanism that claims to read what the owner said. `src/transcripts/queuedTurn.ts` reads them;
the chain read merges its turns in file order with the typed ones.

**2 · Nothing held the owner's outcomes at all.** `handover reconcile --json` exposed the top FIVE ranked rows out of
718 and no statement of what the owner wants to be true, so a shift could be aligned by every number the verb printed
while every ready row under an outcome the owner named sat unspawned. That is what one chair did.

**3 · The handover carried mechanics, not direction.** The successor boot block is shift state — what is in
flight, the merge queue, where to pick up. Measured over eleven handoffs it carries no statement of the owner's
outcomes, so each chair re-derived the owner's direction from whatever it happened to read.

## One source: the Workstreams register

There is one way of doing things. The owner's outcomes are the entries the owner has KEPT on the
Workstreams register (the store's `workstream` rows, read through `productionWorkstreamRegister()`) — every active
outcome or standing workstream, and every linked one that names its board rows. A store that refuses is a refused
reading, never an empty register. Nothing checked into this repository is an outcome.

**What the owner stated is offered, never assumed.** The expectations the owner stated are CANDIDATES on the
Workstreams page, read from `$SLOPWEAVER_HOME/workstreams/stated-candidates.json` (never from the repository), beside
the mined ones, each carrying **the owner's own words**, its `transcript:<session>#<uuid>` anchor and the
`boardMembership` that decides which of today's rows sit under it. An install with no such file has none. Nothing is written until the owner keeps one; keep or drop each when the owner next opens
Workstreams. A keep writes an ordinary standing tile with that membership; a drop writes only the owner's reaction.

**An outcome is not a board row.** A row is planned, run, settled and gone; an outcome survives every row
under it. So the rows change and the register entry does not.

**A stated candidate is added only when the OWNER states an expectation**, anchored to the turn where the owner
stated it. Never because a session thinks something matters — its authority is that every word is the owner's and checkable in one
command (`slopweaver supervisor intake --session <id>`).

**What the supervisor reads.** `handover reconcile --json` projects the register (`src/supervisor/outcomes/coverage.ts`):
each entry's name, the owner's words (its `outcome`), the earliest anchor its timeline cites and its board membership. It
declares `outcomeSource` — `{"kind":"absent"}` while no register exists, `{"kind":"present","count":N}` once one
does — and names an entry citing nothing checkable in `unanchoredOutcomes` rather than inventing an anchor. An
entry with no membership is listed with no rows under it. A register that will not parse makes reconcile exit 1.

## The mechanisms

| Where                                  | What it does                                                                                                                                                                          |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `slopweaver handover reconcile --json` | carries `outcomeSource`, `outcomes` (the owner's words, live sessions and unspawned ready rows per kept outcome), `uncoveredOutcomes`, `unanchoredOutcomes` and the WHOLE `ready` set |
| `slopweaver supervisor tick-record`    | REFUSES a tick that left capacity free with an outcome unattended and no reason; hatch `SLOPWEAVER_ALLOW_UNCOVERED_OUTCOME`                                                           |
| `slopweaver supervisor tick-record`    | REFUSES a free machine beside a groomed ready p0–p2 doc or ask with no seat, spawn or row-named reason ([idle-capacity.md](idle-capacity.md)); hatch `SLOPWEAVER_ALLOW_IDLE_CAPACITY` |
| `slopweaver cmux takeover`             | REFUSES a chair that has not read every owner turn of the last seven days; hatch `SLOPWEAVER_ALLOW_UNREAD_OWNER_TURNS`                                                                |

Beside them, `slopweaver supervisor successor-summary` derives the outcomes half of a handover — the owner's words,
the owner's anchors, this tick's coverage, then the whole ready set — and seals it with a hash;
`slopweaver supervisor state-archive` REQUIRES `--successor-summary <path>` and verifies that hash, so a
boot block cannot be archived with a hand-typed summary beside it.

## What the sweep gate does NOT do

It does not require the fleet to be on every outcome. A tick may leave one alone — holding off because the load is heavy is the precedent — and that stays a
legitimate choice. What it may not do is leave one alone **silently**. Two ways to answer:

```bash
slopweaver cmux spawn <one of that outcome's unspawned rows> --model <model>
```

or a judgement on the draft:

```json
{ "kind": "hold-rationale", "subject": { "kind": "outcome", "id": "<outcome id>" }, "claim": "<why>" }
```

`"id": "all-outcomes"` answers for every uncovered outcome in one line.

**A gate that cannot SEE refuses too.** A reconciliation with no `outcomeSource`, a row count disagreeing with
the one it declares, an outcome field (source, row or list) with a key or shape reconcile never writes, an
`uncoveredOutcomes` its rows disagree with, or a draft whose capacity observation is not a reading, all refuse rather
than passing: a check reporting clean on an input it never saw is the silent-failure class this repository names
everywhere else. An EMPTY list is clean only when the source says so — no register yet (`absent`), or one holding
no active outcome (`present`, count 0). Until the owner keeps one there is nothing to hold the fleet to, and the
successor summary says so in one line.

## The boot check, and what a receipt is worth

`slopweaver supervisor owner-turns` prints the owner's turns verbatim, oldest first, in ~60 KiB chunks, and appends
one receipt per printed turn against this session. Seven days is about **550 KB** of the owner's speech — eight calls.
`cmux takeover` runs the same read with a zero budget (so it counts without spending a receipt) and refuses
while anything is unread.

A Claude chair turn is addressed by its transcript uuid, a Codex chair turn by its rollout pointer
(`codex-rollout:<thread>#<rollout>@<offset>`, the byte its `user_message` line starts at); a Codex chair whose
rollout will not read whole fails the read and the gate. An archived `### RULINGS` row is addressed by its WORDS:
every `state-archive` carries the live block into a new file, so the window delivers each ruling once, and a
ruling receipt carries the hash of what it printed, so a later copy in another file is already read. Words
edited by one character, as printed, are a new ruling and are shown again. Two identical rows are one ruling even
if typed separately: the row is the whole record, its date and call or turn anchor written inside it, so a second copy
holds no word the chair was not shown. The handover ROW ruling journal is different, because its instant and
anchor are fields outside the words. A ruling receipt with no hash, written before this, reads no ruling: an
address alone cannot say which words were printed there, so a chair spanning that change is shown the
window's rulings once more. `--session <id>` credits the receipts it writes to that Claude Code session, not the
ambient one, and `--session codex:<thread-id>` to that Codex thread. An archive
entry that will not read fails the read and the gate, since it could hold a ruling never shown. The read is one snapshot with no
lock: an archive published while the gate reads is seen by the next read, not this one.

A receipt is evidence the words were DELIVERED, not that the chair understood them. It measures the half that
was mechanically missing; the other half is judgement and always was.

## The proof

`src/__tests__/unit/supervisor/outcomes/tickZeroReplay.test.ts` replays a frozen tick zero — the
`tick-record` draft it recorded and a `handover reconcile --json` written in the shape it read, every row
under exactly the outcomes it sat under then, in `src/__tests__/fixtures/supervisor/handoff-9263-tick-zero/` —
through the gate, holding the fleet to twelve synthetic stated outcomes (`src/__tests__/statedCandidatesFixture.ts`,
one per outcome that tick was held to) kept through the console's own keep. Capacity was free (`hold: false`, load
8.68 against a hold of 22), one row was spawned, and the only judgement was a watch disposition.
**The gate refuses it.** Measured against the uncut document, two outcomes were left unattended. The outcome sets
come from row labels cut to 160 characters, which can only ever remove a row from an outcome, so the replay names a
superset of those two and the test says so.
