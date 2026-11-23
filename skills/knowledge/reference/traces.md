# Traces — the third memory kind

The [SKILL.md](../SKILL.md) register holds lessons and preferences. A trace is the kind that holds **where an
investigation looked**: the question, the exact probe, whether it paid or came back empty, and — for an
empty one — what the emptiness does not prove.

The point of a trace: rather than inferring a ruling from one instance, it says what happened when this was done.
That can be more accurate than a ruling, because a ruling risks being wrong by generalising from what was found.

## Why it is not a lesson

A lesson must be paid for, NOT re-derivable by a fresh read, and able to be wrong later. A dead end is
re-derivable by definition — re-running the probe is the whole point — so filing one as a lesson would make
the lesson contract a lie. A trace carries no tier and no surface; the database refuses one that does
(`memories_kind_facets`).

## The one rule that governs reading one

**A remembered dead end never skips a leg.** Correctness comes before speed. An empty trace tells the
next investigation what to open first and what the last emptiness did not prove. It never removes the probe.
A cheap-confirmation skip may be earned later, from recall-accounting data over several self-improvement
loops — not adopted now. `knowledge recall` prints that rule under every empty trace it returns.

This is the same rule for traces: a recalled exclusion never narrows the probe that already ran.

## Writing one

```bash
"${CLAUDE_PLUGIN_ROOT}/bin/slopweaver" knowledge trace \
  --domain store-detective \
  --question "why did the staging pool exhaust" \
  --probe "slopweaver store probe k6 --source linear" \
  --outcome empty \
  --evidence "exact 0, wild-both 0" \
  --does-not-prove "Linear only; the load-test thread may name it another way" \
  --run <the board row this turn is on>
```

- **`--probe` is the EXACT command**, pasteable. It is stored as the row's repro, because it is what settles
  the trace again.
- **`--does-not-prove` is required for `empty`** and refused absent, by the verb and by the database. An
  unqualified dead end is a blind spot.
- **The claim, the behaviour change and the retrieval cue are derived**, not typed: the claim is
  `<probe> — for: <question>`, the cue is the question, the behaviour change follows from the outcome.

## Write it while it is true

A memory is most accurate as the event is happening or just after: the agents in the field emit their findings
as they go, which retroactive transcript sweeps never catch. An
investigation, scheduled or one the fleet opened itself, keeps its field notes AS IT GOES:

1. **Before it opens a system**: `knowledge recall "<the system and the question>"`, and for a wide one
   `knowledge detect` to plan the detective wave ([recall-detectives](recall-detectives.md)).
2. **The moment a probe answers**: a dead end is `knowledge trace --outcome empty --does-not-prove …`, a thread
   worth re-pulling is `--outcome paid`, both carrying `--run <its board row>`. A gotcha that passes the
   [entry test](../SKILL.md#before-you-record-the-three-question-entry-test) is a `knowledge record --run` then
   and there, not reconstructed at `handover finish`, which stays the completeness check it always was.
3. **Its known unknowns**: everything known, everything not known, everything run into, everything unsure.
   Each open question is one line on the investigation's page with the probe
   that would settle it, and an empty trace's `--does-not-prove` is the same thing for one leg. A detective
   gradually finds out what it knows it does not know, then answers those: the list is what the next leg
   is chosen from, and an answered line becomes a trace.

**Decay is written in, not discovered.** What is true yesterday may not be true tomorrow: every field note
says what would make it stale (`--does-not-prove` on a trace, `--caveat` on a record, a "fixed since" check on a
page lead), and an investigation that leans on one re-checks it first and accounts with `knowledge recalled`
(below).

**Nobody's word is a fact until the session checked it**: if someone says something wrong and the knowledge is
updated from it, the register is wrong in future. When someone says something is fixed, do not log it as fixed;
log that someone said it was fixed, which cannot be wrong. A row is `confirmed` only on a probe
the recording session ran itself. What a teammate, a ticket or another session SAID is kept, because it is a
useful data point true or not, and kept AS WHAT WAS SAID, _"<who> said <what>"_ with its permalink, on the
investigation's page and in a trace's `--evidence`, never as the thing itself. The thing said is a known unknown
with the probe that would settle it, and the session that runs that probe records what IT found. A bare quote
is re-derivable from its permalink, so it reaches the register only inside a lesson that passes the
[entry test](../SKILL.md#before-you-record-the-three-question-entry-test), such as "said fixed, still
failing when checked".

**Open, and the owner's to shape** (not yet ruled): whether known unknowns earn their
own row kind in the register, queryable across investigations, rather than living on each page; and whether
a fact the real world changed should propagate into every store table that quoted it, rather than waiting for
the next recall to regrade it.

## How one flips

The claim is derived from the probe and the question and from nothing that moves between runs, so the same
probe for the same question recorded again is **the same claim id**. A later run whose probe now pays writes
`--outcome paid`; recall shows the latest recording, and `traced 2× across N run(s)` says it has history.
Nothing is deleted — both recordings stay.

The other way a trace moves is the recall that just leaned on it:

```bash
"${CLAUDE_PLUGIN_ROOT}/bin/slopweaver" knowledge recalled <claim-id> --outcome held|broke|unchecked \
  --evidence "<what you saw when you checked>" [--verdict refuted|changed]
```

**A trace regrades at the one moment the evidence is in hand**: the investigation that recalled it
is the only one holding that evidence. `broke` names its own verdict — `refuted` or `changed`, never a
default — and the verb copies the claim across for you, so the id cannot drift. `held` on an already
confirmed claim writes the accounting row alone, and that count is what puts the trace in front of one
nobody has ever pulled. Retention is earned by USE, and it reorders a page rather than narrowing it.

## Who writes it

The visible session that ran or read the probe — the same division as
[detective-lessons.md](detective-lessons.md): a detective names its dead ends and paid probes in its report,
and the session that can see every report records the ones it verified.
