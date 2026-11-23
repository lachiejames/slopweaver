---
name: knowledge
description: Record what an investigation LEARNED into the global knowledge register, and read it back by facet — one register, domain as a field, each row carrying its verdict, what was measured and the command that settles it again. Use when a turn found something out the hard way, when a run is being closed and has to answer whether it learned anything, or when the user asks what we already know about a system before investigating it. Phrases like "record that lesson", "what do we know about datadog", "have we hit this before", "what have we learned twice".
argument-hint: "recall <words> | record --domain <slug> … | list [--learner fleet|owner] | voice | propose --from <batch> --unit <id> … | answer <proposal-id> --mark right|wrong|partly | quiz --sweep <tick-id>"
---

**Before writing anything down, read [reference/placement.md](reference/placement.md)** — the one normative
text on where a thing worth remembering goes: the codebase (a skill or `docs/`), always-loaded Claude
project memory, or the retrieved memories table. The bar that governs the owner's Claude memories governs
learnings too, and most things go into something retrieval based.

The register holds what an investigation **paid for** — not the corpus (the thread), an atlas (what exists) or
canon (what we always do). **One register, `domain` a facet on the row**, from a CLOSED
vocabulary: `knowledge domains` lists it, and a retired alias is refused naming its home.
An install's own systems: `knowledge domains add`, held in the home ([how](reference/where-it-lives.md#an-installs-own-domains)).

## Before you record: the three-question entry test

A row must pass all three, and one that fails any of them belongs somewhere else. **It was paid for** — an
investigation, a failure or a measurement produced it, and nobody could have written it from the
documentation. **It is not re-derivable by a fresh read** — if the next session can get it by calling the API
or reading the file, it belongs in an atlas or the corpus, and putting it here makes a second copy that goes
stale. **It can be wrong later** — a lesson has a truth value that decays, which is what separates it from a
rule: a rule is a thing we chose, and choices do not expire on their own.

## Remembering one — the retrieved lane

```bash
"${CLAUDE_PLUGIN_ROOT}/bin/slopweaver" knowledge remember \
  --kind lesson|preference --placement retrieved \
  --domain <slug> --claim "<one sentence>" --evidence "<what you observed, or what the owner said>" \
  --verdict confirmed --learner <fleet|owner> \
  --behaviour-change "<what the next agent does differently>" \
  --retrieval-cue "<the words a task would have to mention>" \
  [--tier 1|2|3|4 --surface api|browser|cli|repo|process]   # a LESSON carries both; a preference neither
```

**Read [reference/placement.md](reference/placement.md) first.** `--placement` has no default, and it is
resolved before every other CHECK: answer it `skill` or `board` and you are told where that content actually
goes, not told about a flag you also forgot. The two placement fields make a wrong answer a reviewable claim
rather than an invisible one — what the gate cannot do is judge whether the answer is honest.

## Recording one — the register the settle gate reads

```bash
"${CLAUDE_PLUGIN_ROOT}/bin/slopweaver" knowledge record \
  --domain <slug> --claim "<one sentence>" \
  --verdict confirmed|changed|refuted|untestable|unsettled \
  --tier 1|2|3|4 --surface api|browser|cli|repo|process \
  --evidence "<what you actually observed>" \
  [--repro "<the command that settles it again>"] [--caveat "<what this does NOT establish>"] \
  [--run <board-row-slug>] [--learner fleet|owner] [--supersedes <claim-id>]
```

Four things decide whether the row is worth having, and each is a real judgement rather than a field to fill:

- **`--claim` is one sentence, phrased so it is true or false.** "Datadog sampling is confusing" is not a
  lesson; "APM adaptive sampling sits upstream of retention filters" is.
- **`--evidence` is what you OBSERVED, never the claim restated** — numbers, statuses, the window. If you
  cannot say what you saw, you have a suspicion rather than a lesson.
- **`--repro` is what makes the row re-checkable**, and without it a future session redoes the whole
  investigation to settle the claim again — the amnesia this register exists to end.
- **`--caveat` is what the evidence does not establish.** Omit it when there is nothing to say, never write
  "none": naming the limit of your own measurement is what makes the rest of the row worth believing.

**Tiers, worst first.** Tier 1 holds TWO things deliberately — an irreversible harm, **or** a measured wrong
answer returned as a success — because ranking on silence alone mistakes detectability for protection.

| Tier | Holds                                                                    |
| ---- | ------------------------------------------------------------------------ |
| 1    | irreversible harm, or a measured wrong answer returned as success        |
| 2    | silent failure — a wrong answer with no error raised                     |
| 3    | loud failure — cost, a rate limit, a 404. Real, but you find out at once |
| 4    | a convention, a recipe, or a snapshot that moves                         |

**Verdicts.** `confirmed` (measured, still true), `changed` (still a trap, but the numbers, names or endpoint
moved), `refuted` (measured, no longer true — the correction is itself a lesson, so the row STAYS),
`untestable` (a call was tried and cannot settle it), `unsettled` (no call could settle it — judgement,
convention or cost, and the owner's to rule on).

## Whose lesson it is — `--learner`

One field names who learned it. Without it the owner's side would hold **zero** rows — not because the owner had
learned nothing, but because the type would have nowhere to put a person. `fleet` (the default) is what an investigation paid for;
`owner` is a belief the OWNER holds, recorded on the owner's behalf, and the field says whose knowledge is tracked rather
than whose fingers typed it.

What the facet changes about reading the register back, and why the id deliberately excludes it:
[reference/reading-back.md](reference/reading-back.md).

**A refuted row is regraded, not deleted.** A claim a better-worded one REPLACES is retired by `--supersedes
<its id>` on the new row: recall and list stop returning it, and re-recording it revives it. Removal is `knowledge
prune --plan <jsonl> --apply`, which archives first ([prune.md](reference/prune.md)); redacting names, opt-in: [redaction.md](reference/redaction.md).

## A trace, and the accounting on one you leaned on

```bash
"${CLAUDE_PLUGIN_ROOT}/bin/slopweaver" knowledge trace --domain <slug> --question "<q>" --probe "<cmd>" \
  --outcome paid|empty --evidence "<what came back>" [--does-not-prove "<required when empty>"]
"${CLAUDE_PLUGIN_ROOT}/bin/slopweaver" knowledge recalled <claim-id> --outcome held|broke|unchecked \
  --evidence "<what you saw when you checked>" [--verdict refuted|changed]
```

A **trace** only reports, so it is falsifiable; **a remembered dead end never skips a leg**, it reorders.
**Write it AS YOU GO**: each dead end, gotcha, re-pullable thread and known unknown, dated, each naming
what would make it stale, the moment the probe answers, never rebuilt at the end. A **recall** regrades the
claim when the evidence is in hand; `broke` names its verdict and the verb copies the claim. Held claims rank
first; a recall never deletes. Known unknowns, decay, all of it: [reference/traces.md](reference/traces.md).

## Reading it back — recall first, list second

```bash
"${CLAUDE_PLUGIN_ROOT}/bin/slopweaver" knowledge recall "<the words the task mentions>" [--domain <slug>]
"${CLAUDE_PLUGIN_ROOT}/bin/slopweaver" knowledge list [--domain <slug>] [--learner fleet|owner] [--repeats]
```

**A store detective's own lessons are this register too** — `--domain store-detective`, its dead ends traces, and a
correction reuses the claim byte for byte so `recall`'s latest-recording-wins ordering can supersede it:
[reference/detective-lessons.md](reference/detective-lessons.md) carries the templates and the three rules
that stop a false-lead exclusion becoming a permanent blind spot.

**Read the register BEFORE any investigation, scheduled or the fleet's own** — on real work, via DETECTIVES:
`slopweaver knowledge detect "<the task>" --term <word> …` plans a Haiku wave that reports only what is
relevant, so the worker's context stays clean ([recall-detectives.md](reference/recall-detectives.md)).
`recall` is the full-text search itself; `list` is the facet and repeat view over the same table, where
`--learner owner` is the owner's side and `--learner fleet` is the fleet's. A filter typed outside its vocabulary
REFUSES rather than reading the register unfiltered.

`--repeats` is the consolidation view and the owner's own trigger: when a row shows several RUNS, propose
promoting it to a gate or a rule rather than leaving it to be learned a fourth time. Both verbs in full,
the owner's words behind each, and what a thin page does and does not mean:
[reading-back.md](reference/reading-back.md).

## Where a belief of the OWNER'S comes from, and where the owner corrects it

The owner's rows do not arrive the way the fleet's do. Their source is **the owner's own
recorded speech**: `knowledge voice` hands you a batch of it and `knowledge propose` records what you read, quoting
the owner verbatim. A proposal is NOT a lesson and lands in its own queue. The owner answers it on the briefing's
correction block, and a session writes down what the owner said:

```bash
"${CLAUDE_PLUGIN_ROOT}/bin/slopweaver" knowledge answer <proposal-id> --mark right|wrong|partly --why "…"
"${CLAUDE_PLUGIN_ROOT}/bin/slopweaver" knowledge quiz --sweep <tick-id>   # the other direction
```

**Neither verb writes a register row, because a mark and an answer are not verdicts.** `right` says the
fleet read the owner's knowledge correctly, not that the claim is true; the owner can be right that they believed
something and the belief still be false, which is the most interesting row the register can hold. Record one
explicitly with `knowledge record --learner owner` when what the owner said supports it.

The **quiz** runs the other way — one question per sweep out of the fleet's own register, so a belief the owner
never thought to state is still reachable. Both halves: [voice-source.md](reference/voice-source.md) and
[quiz.md](reference/quiz.md).

## Closing a run: the question you cannot skip

`handover finish` and `handover settle` **refuse** a started run that has not answered whether it learned
anything. Two answers, and they are equal:

```bash
"${CLAUDE_PLUGIN_ROOT}/bin/slopweaver" knowledge record --run <slug> …   # something was learned
"${CLAUDE_PLUGIN_ROOT}/bin/slopweaver" handover finish <slug> --lessons none   # nothing was
```

**`--lessons none` is a first-class, recorded answer, not a bypass.** The gate asks whether there was a
lesson; it never demands that there was one. Do not invent a row to get past it — a store of filler is worse
than an empty one, and the honest `none` is what keeps the rest of the register worth reading.

The question is asked HERE, at the end of the run, rather than mined out of transcripts later, because the best
time to ask an agent whether there is a lesson is right after it did something — otherwise the lesson is lost,
distorted or harder to re-derive, or eventually unreachable. A run answering twice is a run that started twice: each
cycle answers for itself, and the previous cycle's answer deliberately does not carry over.

`SLOPWEAVER_ALLOW_NO_LESSONS=1` forces past the gate and journals that it was forced. It exists so a genuinely
stuck session is not trapped; using it is a thing to say in the pull request, not a shortcut.

## Where it lives — one register, in the store

Every verb here reads and writes the **`memories` table**: `record` and `remember` write it, `recall`, `list`
and `quiz` read it, `export` and `restore` carry it out and back. The
consequence that reaches every session in the fleet is one sentence: **`handover settle` and `handover
finish` need the store reachable** on any run that was started, because the lesson gate reads this table. An
unreachable one REFUSES with the database's own reason rather than passing quietly;
`SLOPWEAVER_ALLOW_NO_LESSONS=1` is the way past a genuine outage. The store is a LOCAL Postgres, so nothing
about this adds a provider to any path. Which database, the lessons file and how to get it back:
[where-it-lives.md](reference/where-it-lives.md).

Append-only is the mechanism rather than a storage convenience: a repeated claim id IS the consolidation
signal, so a writer that updated a row in place would destroy the count that signal is made of. That is why
`recording_id` is the primary key and the claim `id` is deliberately not unique.

## Running this from Codex

This skill runs on both hosts. In Claude Code, `${CLAUDE_PLUGIN_ROOT}` above is substituted for you. In
Codex it is not: resolve this `SKILL.md` on disk, take the plugin root two directories above it, and invoke
`<plugin-root>/bin/slopweaver` by absolute path for every CLI call. Never run bare `slopweaver` on either
host, because an ambient `PATH` may point at another checkout.
