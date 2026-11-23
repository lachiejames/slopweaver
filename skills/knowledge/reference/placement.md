# Where a thing worth remembering goes

**The normative text, written once.** Every other file that touches this links here rather than restating
it — a placement rule with two copies is a placement rule with two answers.

Read it **before writing**, not after: the question is cheap while you still have the thing in your hands
and expensive once it is in the wrong place.

## The bar that decides everything below

The auto-memory corpus needs strictness about what belongs in memories and what does not: there is a balance
between what is stored in a memory and what is not that gives the best performance, and a heavy index of
hundreds of memories can reduce quality.

An aspiration held in a memory does nothing for Claude and just takes up space. A rule already enforced in code
does not belong in memory either.

**The bar, in one sentence: a thing earns its place ONLY if its presence changes what an agent does.**

The same bar extends to learnings, and that extension is why this file exists: whatever decides what belongs in
Claude memories and what belongs elsewhere applies here too. A few learnings may be always loaded in Claude
project memory, but very few and far between. Most go into something more retrieval based.

## The admission test — run this first, on everything

> **If retaining this changes no future agent action, retain nothing.** If a gate, schema, hook, skill or
> always-loaded rule already supplies the same instruction, retain no additional copy of it.

Two things fail here and both are common. An **aspiration** — something the owner wants built — is a board row
(`slopweaver handover ask`), because a wish in a memory changes nothing. **Dated project state** — a PR, a
stack, a run — is already in git and on the board.

Nothing is obliged to land anywhere. A register of filler is worse than a short one.

## The three destinations, and the test for each

### 1. The codebase — a skill reference, a `docs/` page, or the recurring-failure register

> **If this tells an agent HOW to perform work, describes a measured mechanism or a reusable technique, or
> names a recurring failure class, it goes in the owning `skills/<name>/reference/*.md`, a `docs/` page, or
> `docs/recurring-failure-register.md`.**

**A class written into the register owes a `## Bindings` row in the same change** — `none`/`none` when
nothing binds it yet, which is the common and honest answer. `register-bindings` in `yarn lint` refuses a
live class without one, so this is not a convention anybody has to remember.

The owner's own worked example: a rule that a Datadog monitor has to be deployed with Pulumi probably
belongs more in the Datadog skills in the codebase, not the database and not the core project memories.

A skill is read when it is relevant, which is exactly what a procedure needs and exactly what a
boot-time memory wastes. This destination has taken the most traffic of the three: two passes moved 102 and
186 technique memories into skills.

### 2. Always-loaded Claude project memory — very few, and each one says why it could not wait

> **Retain this here only if it is an owner preference, an identity, or a way of working that must change
> behaviour BEFORE any task-specific retrieval cue exists. State why retrieval would arrive too late.**

The owner's own worked example, from the same turn: a rule that the owner only speaks to the supervisor probably
goes in the memory.

The second sentence of the test is the whole discipline. "Useful" is not the bar — **unretrievable in time**
is. A thing with a recognisable cue (a platform name, a verb, a file) is reachable by recall and does not
need to be paid for at every boot.

**The budget is real, and the corpus has been cut to it three times.** Only the first 200 lines of
`MEMORY.md`, or the first ~24.4 KB of characters, load at all — the loader cuts silently. Measured:
161 lines / 25,413 characters, `24.8KB (limit: 24.4KB)`, **3 entries from line 159 never loading**.
The passes: 396 → 84, then **171 → 18**, every
leaf read in full against this file's test. Measure the index as it stands rather than trusting a figure
here: `wc -lc ~/.claude/projects/<project>/memory/MEMORY.md`. Every entry added here takes a place from one
already there, whether or not anybody chooses which.

**A memory that amends canon names the board row landing the change, and is deleted when that row
settles.** A ruling that changes a rule belongs in the rule; the leaf only bridges the sessions that boot
before the canon edit lands. Left behind, it restates a rule canon has since changed and contradicts canon
every session — a hygiene pass found two such leaves doing exactly that. The
leaf declares `metadata.slopweaver.amendsCanon: { target, row }`, and `memory check` reports it
(`amends-canon-without-row`) when the row is absent, unknown to the board, done or closed unlanded
([declaring one](../../memory/reference/checks.md#declaring-a-memory-that-amends-canon)).

**A keeper says why, in its own body.** Every always-loaded memory opens with one
paragraph — `**Why always-loaded:** …` — naming the first agent act that would already be wrong if retrieval
waited (the estimate typed, the deadline written, the safe rung defaulted to). A keeper that cannot name that
act is a retrieved memory carrying a boot-time cost, and `memory check` reports a root-routed memory whose
body does not open with that paragraph (`why-always-loaded-missing`). What moved out is staged verbatim, one bucket per
destination, in `$SLOPWEAVER_HOME/memory-deindexed-13sep/` with a `MANIFEST.md` — the retrieved rows as one
exact `knowledge remember` invocation each, proven against a throwaway Postgres and replayed into the live
table once it exists (see below).

### 3. The retrieved memories table — everything else worth keeping

> **Retain this here only if it changes behaviour when a recognisable task cue arises, is not already
> supplied by canon or by a fresh authoritative read, and carries evidence.** A `lesson` must be paid-for
> empirical knowledge; a `preference` must anchor something the owner actually said.

This is the default destination, by the owner's steer that most things will be going into something more
retrieval based, and the reason it can be the default is that it costs nothing until it is asked for.

```bash
slopweaver knowledge recall "<the words the task mentions>"      # read this EARLY
slopweaver knowledge remember --kind lesson|preference --placement retrieved …
```

**The two kinds are not interchangeable.** `SKILL.md`'s entry test demands a lesson be paid for, not
re-derivable by a fresh read, and capable of becoming false. A preference of the owner's satisfies none of those
honestly — nobody measured it, re-reading a system will never produce it, and it changes only when the owner
changes their mind. Filing one as a lesson would make the entry test a lie, so the schema keeps them apart and
gives a preference none of the lesson facets (`tier`, `surface`, `repro`).

## What the gate actually checks, and what it cannot

`knowledge remember` requires `--placement`, refuses anything but `retrieved` and names the real
destination; it requires `--behaviour-change` (what the next agent does differently) and `--retrieval-cue`
(the words a task would have to mention).

**None of that judges whether your answer is honest.** No type, no Zod schema and no SQL constraint can tell
whether prose duplicates a skill or genuinely changes behaviour. What the fields buy is that a wrong
placement becomes a **reviewable claim** somebody can read and disagree with, instead of an invisible one.
Anything claiming more would be a check that cannot fail, which this repository treats as worse than none.

## The boundary that actually decides most cases

A **reusable procedure** for a platform goes to that platform's skill. An **observation that a specific
investigation paid for** — and could not have got from the documentation — is a retrieved lesson.

"Datadog's API lies" establishes neither placement nor truth. "APM adaptive sampling sits upstream of
retention filters, so a 100%-error retention filter cannot rescue a trace the agent never sent" is a lesson:
paid for, falsifiable, and it changes what the next agent does before it writes the filter.

## Two verbs, one register

`knowledge remember` and `knowledge record` both write the `memories` table, and the difference between them
is what the caller was ASKED rather than where the row lands.

`remember` is the verb that asks the placement question: it REQUIRES `--placement` (and refuses every answer
but `retrieved`, naming the real destination), plus `--behaviour-change` and `--retrieval-cue`, because a
writer who reached it has answered this page's test on the record.

`record` is the verb a settle gate reads. It was never asked the placement question — its contract is a
domain, a claim, a verdict, a tier, a surface and evidence — so its rows carry NULL in those two fields
unless the caller chose to supply the optional flags. A NULL there reads as "nobody answered", which is true.
Reach for `remember` when you have answered this page's question and for `record` when you are closing a run;
a lesson that is both is one row through whichever verb you are already in.
