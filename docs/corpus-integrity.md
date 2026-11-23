# Corpus integrity — what is in there, who is in there, and what was lost

Read-first verbs that answer questions about the corpus itself rather than about the team. All of them
are cheap, offline and spend no tokens, so reach for them before assuming a `store read` came back thin
because the corpus is missing something.

```bash
slopweaver audit                                   # quality + cost snapshot, no network, no tokens
slopweaver identity show --json                    # every canonical person and how each id was linked
slopweaver identity resolve @ada                   # one raw handle or id → its canonical person
slopweaver slice capture --name self-daily --root /dev/notes
slopweaver slice verify --name self-daily          # did an unchanged re-ingest lose anything?
slopweaver dev manifest --compare before.json      # did a rebuild change the corpus's cross-source shape?
slopweaver dev manifest                            # …and can each lane still be rebuilt at all?
```

**`slice` is not `subset`, and the names are close enough to be worth separating here.** `slice` pins a named
part of ONE source and proves nothing was lost between disk and prompt; it is a completeness instrument and it
writes no bronze. `subset` copies a bounded part of the WHOLE corpus into a home of its own
(`slopweaver subset build --limit 500 --out ~/.slopweaver-small`) so the entire pipeline can be re-run against
something small. Different jobs,
different nouns.

## `audit` — the quality snapshot

A read-only pass over the on-disk corpus: exact, deterministic counts, plus a distil cost estimate. The
estimate never calls a model. It extrapolates from recorded per-batch `distil` usage, reporting the
**initial** full backfill and the **ongoing** marginal separately, because a steady-state refresh re-distils
only changed batches while the content-hash cache serves the rest.

One caveat, stated in the code and worth knowing before quoting a number: under operating-doctrine rule 2
`distil` calls no model in-process, so that calibration data does not grow. On a fresh install every estimate
is the documented **cold default** — a labelled extrapolation, not a measurement of this corpus.

## `identity` — the cross-source person map

`identity show` lists every canonical person with their per-source ids and how each was linked;
`identity resolve` answers "who is this?" for a name, handle, email or id; `identity narrow` hands the whole
member index to a haiku sub-agent when that exact lookup missed, and checks the key it picks;
`identity org-domains` prints the email domains that answer is checked against. All four are read-only.

**`resolve` reads the MEMBER index and nothing else** — every provider's own member list, hydrated into
`corpus/members/`. It needs no `derive`, so it cannot be silently disabled by one that refuses under the
heap ceiling; it may match a bare FIRST NAME, because a member row's name belongs to a specific native id
rather than to an inference; and it REFUSES rather than picking when two live colleagues answer to one
token, when the only match sits outside the org's own email domains, or when nothing places a match either
way. `--corpus-scan` opts into the whole-corpus resolution for the one case members cannot cover: someone
who appears only as a record author. `show` keeps that whole-corpus reading as its default.

**A miss is reported as a miss, never as a proven absence.** Before `resolve` says anything about absence it
runs the NEAR pass (`src/silver/nearMention.ts`) over the member index's own display names, name parts,
handles and emails, and names whoever is spelled close — colleagues ranked first, closest first, capped, and
explicitly refusing to pick between them. The budget is scaled by length: no budget at all at four
characters or fewer, one edit to eight, two beyond that. External and unverified rows are admitted, so each
one carries its own `org-status:` and the header counts PEOPLE rather than colleagues.

MEASURED, this is why. `identity resolve 'Tobyn Barten'` answered "no colleague in the member index
answers to Tobyn Barten" and added "member bronze is every provider's own member list, so this is a real
absence, not a stale roster" — while the member index held **Tobin Barton** across Slack, Linear and Notion,
with over ten thousand bronze records under that name. Two letters. The miss was correct and the sentence was not: an
exact ladder cannot bridge a spelling, and a session that reads "a real absence" correctly concludes the
person is not in the corpus and stops looking.

**A miss says only the checkable part.** It says member bronze needs no `derive`, because that is true and
it is what the heap-ceiling failures below needed. It never says the roster is current: member bronze is written by
`refresh`, so it is exactly as current as the last one, and a colleague who joined since reads identically to
an absence.

A near match is a SUGGESTION and may never be promoted to a resolution. The gap that makes `Tobyn Barten` a
near miss for `Tobin Barton` makes it an equally near miss for a differently-spelled third person, and the
exact ladder's whole design is that a confident wrong person is worse than no answer.

### `identity narrow` — the judged pass, and why spelling distance is only the floor

**The owner's ruling on the fix above:** exact string matching is not enough, and adding common misspellings to
an exact match only meets the same class of problem again. The class is fixed by narrowing the identity roster
to who the asker most likely meant — work for a haiku sub-agent, so the whole roster never enters the context
window of the agent doing the work.

So `identity narrow <token>` prints the WHOLE member index as a brief — the ask, the answer contract, then
one row per non-bot person carrying every spelling, handle, source and org status they have
(`src/silver/rosterNarrow.ts`). `--question` and `--asked-by` carry the framing, which is half of what the
judgement is made on. Edit distance still runs: its candidates are hoisted to the top of the roster and
tagged `~N edits`, stated in the brief as a hint that cannot see a nickname at all.

**Who runs the verb is the design, not a detail.** The sub-agent runs `identity narrow` itself, so the
roster only ever lands in the sub-agent's context and the working agent sends a token and gets one key back
— the owner's context objection, answered without a file on disk. Nothing here calls a model: the brief is text, and
the haiku that answers it is an in-process sub-agent of an already-visible session (AGENTS.md rule 2).

**A pick is a nomination, never a resolution.** `identity narrow <token> --answer "<the reply>"` reads the
two lines back, REFUSES a key the roster does not carry — a judged pass can name a plausible person who does
not exist, which is the one failure the spelling floor cannot have — and then re-runs the exact ladder on a
token the picked person genuinely carries. An outsider still comes back `external`; two colleagues of one
name still come back `ambiguous`. The roster is not the permission.

MEASURED: the brief contains roughly a thousand people and is well under a MiB, built from the member
index without a corpus walk. Reproduce with
`slopweaver identity narrow "Tobyn Barten" | head -30`.

**The corpus leg is STREAMED, and must stay that way.** Both verbs fold three inputs — the roster, the
hydrated members, and the per-source identities the corpus contributes — and only the third is corpus-scale.
It is harvested one line at a time (`src/silver/identityCandidateStream.ts`), so what is retained is the
deduped candidates rather than the records they came from. Reading the tree instead was what made a one-token
lookup the most expensive read in the repo, and then stopped it answering at all: on a
multi-gigabyte bronze tree, a whole-tree load projected roughly twice the on-disk size and was refused, while the
stream answered in seconds with sub-gigabyte peak RSS.

Two things not to "simplify" later, both measured on that corpus the same day:

- **Do not drop the corpus leg.** A large minority of the people it resolves are discoverable ONLY from record
  authorship — every bot, and everyone who predates the members index.
- **Do not resolve from members first and stream only on a miss.** Over the thousands of tokens members alone
  resolve, a handful of answers change once the record candidates are folded in, and most go from a confident
  person to an ambiguous one (`github-actions` is the reproducible case). A short-circuit answers those
  confidently and wrongly, which this verb treats as worse than no answer.

`derive` still reads the whole corpus, and that is not the same defect: it synthesises the directory, the
cross-ref graph and the opportunities from record CONTENT, so the records are its subject rather than a
detour to one lookup.

## `slice` — proving a re-ingest lost nothing

Two verbs, and the split is the trust model rather than convenience. `capture` **writes** a manifest under
`$SLOPWEAVER_HOME/slices` pinning a named subset of a source: its content digest, the files it legitimately
declined, and its sentinels. `verify` **writes nothing at all**, so it can be run by anyone, at any time,
including in CI, and exits non-zero if anything was lost without saying so.

Neither writes bronze. `refresh` stays the only writer, which is exactly what makes `verify` meaningful: it
proves that an unchanged re-ingest **would** write nothing, rather than proving it by writing.

## `dev manifest` — origin survival, and why conservation cannot see it

Every run of `dev manifest` prints an **origin survival** block under the shape summary: per lane, how many of
the DISTINCT local files its records were scanned from still exist on disk.

```
origin survival: 1 lane(s) CANNOT be rebuilt by re-scanning
  LOST  self: 3982 of 5019 origin file(s) are GONE — a re-scan cannot rebuild this lane
  ----  github: no local origins — this reading says nothing about it
```

Conservation compares the corpus to itself, so it structurally cannot make this call. A lane whose source tree
was pruned has lost nothing a before/after comparison can see — the records are all still there — and is at
the same time the only copy of every file that went. That is the gap this reading fills, and
[constraints/hard.md](constraints/hard.md#4a-a-lane-scanned-off-a-local-tree-is-not-rebuildable-until-survival-says-so)
is where the rule lives: a verdict that a lane may be discarded cites this number.

**Three verdicts, and the third is the one that matters.** `intact` clears a lane. `lossy` refuses it. **`no
local origins` clears nothing** — a fetched lane is rebuildable for reasons this reading never looked at, and
collapsing it into "fine" would put the same false reassurance back in a new place. Counts only, never paths:
an origin path is an absolute path under the owner's home, which is a leak class the hygiene gate catches.

The reading needs the disk, so `buildCorpusManifest` takes the existence check as a required seam rather than
defaulting it — a default would hand a caller a manifest reporting every lane intact without anyone having
decided how existence was judged. It is also why the manifest is version **2** and a version-1 snapshot is
refused instead of filled in: an absent origin tally decodes as "this lane has no local origins",
which is exactly the reassurance the field exists to withhold.

## Where it lives

- **`src/audit/`** — `auditCore.ts` (the pure aggregators), `auditFold.ts` (the one streaming fold over
  physical bronze rows), `auditReport.ts` (rendering), `costEstimate.ts` (the sample-calibrated
  extrapolation). Nothing here does I/O; the CLI shell (`src/cli/commands/audit/run.ts`) streams the corpus
  census's rows into the fold.
- **`src/silver/identity.ts`** — the person model the `identity` verb renders.
- **`src/corpus/`** — bronze, its connectors (GitHub, Slack, Linear, Notion, Gmail, Calendar, Fathom,
  `chatgpt` and `self`), and the `members/`, `structures/` and `history/`
  sibling stores.

## What they do NOT do

- **None of them refreshes anything.** They report on what is already on disk. A thin answer may simply
  mean the window was never ingested — see [corpus-coverage.md](./corpus-coverage.md) for what the corpus
  actually spans, per source.
- **`audit` spends no tokens and makes no network call**, and its cost figure is an estimate about `distil`,
  never a bill.
- **`slice verify` never repairs.** It reports the loss and exits non-zero; fixing it is a `refresh`.
- **Origin survival never restores anything, and never fails the verb.** It is a reading a verdict has to
  cite, not a gate — a `lossy` lane is a fact about the corpus, not a broken run.
- **`identity` never guesses.** A handle that is not in the roster does not resolve to the nearest name.
