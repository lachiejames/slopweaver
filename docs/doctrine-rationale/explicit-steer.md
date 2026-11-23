# The explicit steer exception

`AGENTS.md` rule 10 carries the rule in one sentence and `.claude/rules/cross-session-messages.md` the one change
to the tier-3 set. This is why, what it does not cover, and the incident it was built from.

## What the exception is for

The owner has an escape hatch of their own. The standing rules stay, and they are wanted; but when the owner asks
for something and says, in so many words, that it overrides the earlier guidance, that instance happens. It is an
explicit steer exception, not a deadline exception: the override is signalled by the owner's wording, never inferred
from urgency. And when a steered deliverable is not going to land, the owner is told early, with the uncertainty
named, on the surfaces that reach them — a floating note and the console voice cutting in — rather than finding out
by reading the supervisor chat after the fact.

## The rule

- **What makes a steer explicit is the owner's words, not the stakes.** A phrase saying it overrides the previous
  guidance, or that it knowingly contradicts earlier steers, and their kin. A deadline is not one, which is why it is
  not a deadline exception: an urgent ask with no override in it is an ordinary ruling, and the standing rules govern it.
- **It beats every standing rule and memory, for that instance only.** The rule it overrides is not repealed, and
  the next instance of the same work is governed by the rule again. A steer that should outlive its instance is a
  changed rule, which is the [phase rule](./phase-rule.md)'s business, never a steer's.
- **The latest decision stands.** A later ruling of the owner's on the same row supersedes the steer, exactly as any
  later ruling does, a reconstructed one included: a backfill is an answer the owner really gave, so one decided after
  the steer ends it. A steer is not a lock against the owner's own next word.
- **The chair records it; the seat acts.** The owner speaks to the supervisor, so the chair writes it onto the row with
  `slopweaver handover rule <slug> --explicit-steer [--deliver-by <iso>] --anchor <where> --words "<the owner's words>"`.
  A seat reading that ruling on its journal acts on it. It does not ask the owner to repeat it in its own tab: that is the
  context switch [journalled grants](../../.claude/rules/journalled-grants.md) exist to remove.
- **Two tier-3 crossings survive it.** A rule protecting a THIRD PARTY's data — another person's, another
  organisation's, a data source the owner has not approved for that use — and spend outside the owner's own accounts.
  Both protect someone the owner's word does not speak for, which is the line. Everything else in the tier-3 set is a
  crossing of a session's mandate, and the owner's explicit word is the mandate.

### Why it is a field, not a phrase match

`explicitSteer` is a field on the `ruling` event (`src/handover/explicitSteerTypes.ts`), written by a flag. Matching
"overriding" in prose would make every reader re-derive the exception from wording, and would fire on a sentence
QUOTING an earlier override as readily as on a new one. A field is set once, by the chair that heard the owner, and is
read the same by every verb. A reconstruction (`backfilledFrom`) can never carry one: the write schema refuses it,
the decoder refuses the line, and the reader ignores one built past both. A backfill authors no override.

## The mechanism: told early, never at the deadline

A steered row is watched by the `steer-at-risk` monitor (`src/monitor/steerAtRisk.ts`), which reads every run
journal carrying a steer and judges it with `judgeSteerRisk` (`src/handover/steerRisk.ts`). A row is at risk when:

- a seat **named** the risk, with `slopweaver handover risk <slug> --why "<the uncertainty>"`. That is the half the
  register cannot see: a seat still running that knows a gate has no hatch, or a verb has not landed;
- the run is **waiting on the owner**: a recorded question that `ownerWaitOf` (`src/handover/ownerWait.ts`) calls the
  owner's, the same verdict the owner's Queue draws the ask card off, or a registered ask with no run that `registeredAskOf` lists there
  and that declares no `blockedBy` (whether a blocker finished takes the whole board, so one with any is not read);
  A question a later ruling already answered, or one on a paused row, has no card, so it reads as a park instead;
- the seat **parked on a clock**, or parked with no wake at all. A park on its own CI is work in motion, and is not
  a risk;
- the run was **abandoned** or **orphaned**;
- the instant the owner named has **passed** with the run not finished.

Every at-risk row raises ONE floating note (hand) and ONE voice line (talk), together:

- **The note** goes up at the tick that reads it — the tick opens by firing `steer-at-risk`
  (`src/supervisor/scratch/fleetReadings.ts`). It also goes up in-process, at once, when `handover park`, `ask`,
  `risk` or `rule`, or an orphaning, writes the line that made the row at risk (`src/cli/commands/handover/steerRiskCard.ts`).
  It says what is true about who waits: with the owner's question standing, leading or not, it opens "waiting on you", the
  question, then "answer it on your Queue"; any other row opens "nothing waits on you". It stays a notice with no link
  even then, because
  the question's own ask card is on the Queue and a second card would ask it twice. Measured on a vulnerability-fix
  top-up: seven notes overnight said nothing waited on the owner, the last of them over "it is stopped on a question
  to you".
- **The voice line** is the console's. A live call asks `/api/talk/call/<id>/steer-risk` on a short cadence
  (`site/lib/steerRiskWatch.ts`). The server reads the open steer notes itself (`talk steer-risk`), so the voice and
  the owner's screen always name the same risk, and a note the owner answered (Done, Later, a snooze still running) is never said. It is the one window notice that
  CUTS IN: neither the owner's speech, the voice's reply, a tool call nor a running turn holds it, only one of this
  server's own writes still being sent, a typed turn of the owner's being handed in included, so it never splits one
  (`WindowNoticeLines.announceSteerRisk`, `ownWriteRefusal`).
- **A tick cannot close over a risk it read and left down.** `supervisor tick close` rehearses the monitor and
  refuses while a steer note is owed and not up — the `unescalated-steer-risk` gate, beside fleet health's
  (`src/cli/commands/supervisor/steerRiskRead.ts`).

## Worked example: a steered ticket due the same afternoon

The owner's deadline was a fixed instant that afternoon: an architecture proposal as a Linear document on ABC-1. The
run journal, in minutes before (−) or after (+) the deadline:

| Instant (deadline ±) | What the journal says                                                                        |
| -------------------- | -------------------------------------------------------------------------------------------- |
| −69 min              | `started`, `launched` — a seat on the row                                                    |
| −59 min              | `amended` — body drafted; "blocked on the linear document verb row before writing to Linear" |
| −59 min              | `parked`, wake ten minutes before the deadline — the seat closed itself behind the door rule |
| −13 min              | `claimed` — a reseat, after the chair's own later steer to publish it as the description     |
| −3 min               | `parked`, wake thirty minutes after the deadline                                             |
| +6 min               | `closed` — the owner had sent the document personally at the deadline                        |

The owner found out half an hour before the deadline by reading the supervisor chat. No note went up and the voice
said nothing, because nothing in the setup knew this row was the owner's override rather than ordinary work, and
nothing read a clock-park against a deadline. Where the owner's recollection and the journal disagree on the day,
the journal is the record.

**With the exception in place**, the chair records `handover rule … --explicit-steer --deliver-by <iso>` when the
owner gives it. The first park then fires `steer-at-risk` in-process, so the note reads `its seat closed until
<wake>, so nobody is working it` and the voice cuts into the owner's call with the same sentence, fifty-nine minutes
before the deadline, instead of the owner finding it personally half an hour out. Under the exception itself, the door
rule that held the seat would not have held it either: the owner's word overrode it.

**The proof** is `src/__tests__/subprocess/replay/explicitSteerHoldSynthetic.test.ts`: that journal through the
first park, redacted, plus the one steer line. The real `monitor check` raises exactly one note, one second after the
park, and the tick close's gate refuses before the note is up and passes after it. Two mutations of the same world raise nothing:
the journal with no steer on it, and the park on CI rather than a clock. Blinding the source to the steer field turns
the replay red.

## The residue, stated rather than discovered

- **An unrecorded steer is invisible.** The mechanism watches the field, so a steer the chair heard and did not
  record raises nothing. The chair's half is the one link no gate checks.
- **The register cannot see a risk nobody names.** A seat running into trouble raises nothing until it runs
  `handover risk`, parks, asks or dies. The judge reads what is written, never what a seat is thinking.
- **The voice says each note at most once per console process.** The line is claimed before the write, so a write
  that times out is never said twice — and one that definitely failed is not retried either, its floating note the
  only signal left. A console restart may say one open note a second time.
- **A meeting's prep page floats above a steer note.** Two rows at risk float two notes, stacked in the ordinary
  cascade with every other note, the newest in front; a meeting's prep page sits one level above them through its
  hour, in its own cascade from the top left, so it covers a steer note only on a screen too narrow for both first
  columns side by side, its voice line said meanwhile.
- **A writer can still journal a reconstruction carrying a steer.** `appendRunEvent` below the row-event schema does
  not check, the same shape a ruling's `gate` has; the decoder refuses the line and the reader ignores the field, so
  nothing acts on one.
- **One unreadable hand-register line refuses every tick close**, fleet health's included, until it is mended. The
  line may be the steer card itself, and a close that never saw the set must not report it clean.
- **A Done inside the chime's second can still be said.** The console reads the open notes, then rings the one-second
  herald before the line; a note the owner closes in that gap is spoken anyway. Re-reading after the chime would hold
  the owner's call silent for a whole CLI start and leave the same gap behind it.
- **The voice reads at most twenty open steer notes.** The console refuses a longer list as malformed, so past twenty
  rows at risk at once the owner's call says none of them; every floating note still stands.
- **Done is the owner's.** A note the owner closes is not said again while that same reason stands. A new reason — a second park
  after a reseat — is a new note.
