# Mined candidates and the owner's reactions

The owner's ruling: put a list of a hundred potential workstreams in front of the owner, who goes through saying
yes, no, or sort of to each. A later ruling, on what the page is for: it **reveals to the person what they want** by
putting the right options in front of them to react to.
The code is pure in `src/workstreams/`: `candidates.ts` (schemas, identity, the fold), `reactionBatch.ts` (the
owner's words by number), `promotion.ts` and `placement.ts` (what a word does to the register), `candidateTile.ts` (the tile a yes
becomes), `definitions.ts`, `titles.ts`, `proposals.ts`, `whoFirst.ts` and `loopIn.ts` (one per ledger), and
`candidatesDocument.ts` (the joined view). The `*Store.ts` beside each writes its file.

## The files

- `$SLOPWEAVER_HOME/workstreams/stated-candidates.json` — the owner's stated outcomes, as
  `{ schemaVersion: 1, candidates, formerNames }`. Each candidate has the mined shape below, numbered in a range no
  mine's numbering reaches (from 901, say), the owner's words restated as its outcome and its one quote, anchored to
  the turn, with the `boardMembership` the supervisor's coverage reads once the owner keeps it; none links into a
  Slack channel, since the file carries no `channels`. `formerNames` maps a retitled candidate's id to its EXACT
  former title, so a row answered under that title still counts as that id and no other
  (`candidateStore.ts`'s `readStatedCandidates`). An absent file is no outcome stated; one that will not read or
  validate is a refusal naming the problem. `candidateCatalog.ts` puts them FIRST, then the mined file's, and refuses a
  mined id, number or name that clashes with one. So every verb reads stated candidates before any mine, a home with
  neither file reads as an empty catalog, and nothing is written until the owner keeps one.
- `$SLOPWEAVER_HOME/workstreams/candidates.json` — the mined half, one bounded document, written whole by `slopweaver workstreams
candidates-put --file <candidates.json>`. Each candidate has an `id` (kebab-case, at most 80 characters — the
  bound a spoken ruling carries through the console), a `n` the owner answers by, a name, an outcome
  sentence, a theme, its `workspace` (`team` or `self`), the period it was active, an evidence count, the
  people involved, `inRegister` (the register id it already is, or null), and:
  - **`evidence`** — two or three dated quotes of the person's OWN words, verbatim, each with a Slack link or a
    `transcript:`/`owner-turn:` anchor. Never a paraphrase: the quote is the tile's evidence.
  - **`doneOptions`** — two or three definitions of done, each `{ id, lens, text, tradeoff, stretch }`. `lens` is
    `result`, `people` (the team across it and owning it) or `adoption` (teammates reaching for it unprompted), and
    at least one is `people`. `text` is the floor; `stretch` the rung beyond it, or null.
  - **`stalled`** (`{ since, what }` or null), **`priorSteers`** (the owner's earlier steers it answers, dated and anchored),
    **`owningTeam`** (`{ name, why }` or null) and **`loopIn`** (each person the first conversation is with, by Slack
    member id, with `why` and an `opener` drafted in their voice) — kept apart, because the team that owns it is
    not who the owner talks to first.
  - **`proposal`** — the id of the owner's proposal it was mined from, or null.

  Ids, numbers and names are each unique; two names differing only in case, spacing or punctuation are one
  workstream, so merge them. A top-level `channels` map names every Slack channel the evidence links into, as the
  owner knows it (`#dev-experience`, `your DM with Rosa`), and the put refuses a link into a channel it does not name, because
  the register refuses one too. `minedSources` records what the mine read per source.

- `reactions.jsonl` — append-only, one row per word: the candidate and its name then, the reaction, when, `via`
  (`console` press, `word` the owner said or typed, `session`), who recorded it, the anchor, `heard` (their own words, or null when a press or an
  older row carries none), any placing field, and `promotedAs`, the register id a yes became. The latest row per
  candidate stands.
- `definitions.jsonl`, `titles.jsonl`, `who-first.jsonl`, `proposals.jsonl` — one ledger each, the latest row per
  candidate standing (proposals: every row). A definition row snapshots the option as it read when picked.

Re-mining rewrites `candidates.json` and never touches a ledger, so **an answered candidate keeps its id and name
across a re-mine**: `candidates-put` refuses a set that drops an answered candidate, renames it, or reissues its
name under another id, because every link from the owner's word to its tile keys on that id.

## What each word does

`workstreams react` runs one critical section under the register's lock: read the register, plan every pick,
validate the grown register, append the rows, then write the register through its one validating writer. A
register that would refuse the change records nothing.

- **yes** — the register gains a `standing` `discovery` tile for a candidate it does not already hold (`inRegister`,
  a tile tagged `mined:<id>`, or an earlier yes's `promotedAs`), its timeline the evidence in date order, its name
  the title the owner gave, its outcome the definition they picked. `--steer` ties it to a prior steer, noted on the tile.
- **done** — kept as a `closing` entry, filterable, never dropped, carrying the candidate's outcome, the day it
  was placed as `closedOn`, its evidence as the cited timeline and its loop-in people as stakeholders.
- **same-as / milestone-of / outcome-of** `<id>` — a note on the named register workstream; milestone-of also
  files an own milestone there, so a mid-way blocker shows on that tile's strip, and is refused against a
  `closing` entry, which has no milestones. Outcome-of is something it
  produces, never a step on its way.
- **superseded** `--superseded-by <what>` and **no** with `--owner <whose>` and/or `--covered-by <id>` — kept on
  the row; covered-by notes the covering workstream.
- **abandoned** (also `cancelled`) — ends the held entry with `{ kind: "abandoned", reason, on, anchor }`, or
  promotes it already ended; needs `--reason` and `--anchor`, one candidate per call. A page-only entry is refused.
- **sort-of / not-sure / lets-talk** — the row only. `lets-talk` is a conversation the owner asked for: bring
  those to the owner together.

A placing flag or `--reason` goes with ONE pick of its word. A later yes on an ended candidate does not reopen it.
Keep a promoted tile's id and `mined:<id>` tag when writing its story: they are how a later yes finds it. The tile's
`agreedBy`, `team` and `numbers` read `STORY_OWED` until the seat writes them.

## The other answers

```bash
slopweaver workstreams define --candidate c-012 --option owned-and-read --via console
slopweaver workstreams define --candidate c-012 --text "<their words>" --stretch "<the rung beyond>" --via word
slopweaver workstreams define --candidate c-012 --all --first owned-and-read --via word
slopweaver workstreams retitle --candidate c-012 --title "<their title>" --via word
slopweaver workstreams who-first --candidate c-044 --people "Jasper and Quinn" --team "platform team" --via word
slopweaver workstreams propose --from c-012 --relation sibling --title "<their words>" --via word --anchor <where>
slopweaver workstreams loop-in --candidate c-012 --person <slack member id>
```

`--all` without `--first` keeps every option and the page asks which comes first. `propose` takes `split`,
`instead` ("not this, but THIS") or `sibling`, or no `--from` for one outright; the next mine owes each proposal a
candidate with evidence. `loop-in` parks the opener as a draft to that person on the owner's Queue and **sends nothing**; an opener past the
[earns-its-place](../../slack/reference/earns-its-place.md) caps parks nothing.

## What this seat owes, from `workstreams candidates`

- **Story owed** — a tile still carrying `STORY_OWED`: read its evidence through the verbs, write the story, `put` it.
- **Promotion owed** — a yes, done or abandoned with no entry: re-run the same `react`.
- **Definition owed** — a tile not yet saying its standing definition: re-run the same `define`.
- **Placement owed** — a placing note missing from the workstream it names: re-run the same `react`.
- **Retraction** — a yes since replaced by another word. Ask on the owner's Queue whether the tile goes; never remove it.
- **Proposal owed** — a proposal no mine has read yet: mine it into a candidate with `proposal` set.

## Where the owner answers

The console's `/workstreams#candidates`: a collapsed **Proposed workstreams** section at the top, asking "accept as
a workstream + these definitions of done". It opens on the FEW candidates with the most of the owner's own words
behind them, the rest behind one link (the owner will not read seventy at once), and offers one-at-a-time. Every
candidate with a reactions row is RULED and sits apart, behind one collapsed section showing its ruling, date and the
owner's quoted words — so record a spoken ruling with `react` the same turn, or it reads as unruled. A press
there writes the same ledgers the verbs do, but only for an answer that is a click or a pick: a word, an offered
definition or all of them, a placing, covered-by, an earlier steer, a loop-in. The console takes no typed words
(the owner's ruling), so a title, whose it is, superseded by what, who first, a definition in the owner's own words or a
proposal arrives as a call relay naming the open card (`candidate:<id>`), and the seat runs the verb above. Its derivation is
`site/content/console/workstreams.mdx`.

## Relaying the owner's words

The owner answers by number, out loud or typed. Relay exactly what they said, in one call:

```bash
slopweaver workstreams react "12 yes, 13 no 14-16 sort of 17 let's talk" --via word --anchor <where they said it>
```

Numbers, ranges (`14-16`) and ids (`c-012`) are references; several references before one word share it. The
words accept `y`, `n`, `sortof`, `notsure`, `unsure`, `lets talk`, `cancelled`. The whole batch is refused, naming every
problem, on an unknown number or word, a reference with no word, or one candidate given two words. The words become
each row's `heard`; `--heard "<their words>"` overrides them when the references are yours rather than the owner's.

## A ruling the owner speaks to the console voice

The owner's bug report: the voice walked the owner through candidates they had already
ruled on, because nothing it relayed reached the candidate. So the walk reads `workstreams candidates --unruled`,
which lists only candidates with no word of the owner's yet, and `--ruled` when the owner asks about one they
settled, newest first, naming the owner's word, the day and what they said. Either text listing is fitted to one
voice read and ends on how many it left out. When the owner's reply is a ruling, `relay_steer` carries `candidate`
and `reaction` beside the owner's words, and `talk relay
--candidate <id> --reaction <word>` writes the row the same turn (`src/talk/candidateRuling.ts`): `via` `word`,
`bySession` `talk:<turn>`, `heard` the owner's words, the anchor the turn's. The turn's digest binds the ruling, so a replay
naming a second candidate or word is a relay conflict and an exact replay writes nothing: one turn carries one
ruling. A relay not stated whole (`--heard-tail cut`, or absent) writes no ruling and opens its row `HELD:`
(`src/talk/relayCutHold.ts`). A refusal never fails the relay: the owner's words still reach the board, the candidate stays open, and the voice
is told so. The voice relays only a word that stands alone (`STANDALONE_REACTIONS`); same-as, milestone-of,
outcome-of and superseded name a target a relay cannot carry, so the seat records those with `react`.
