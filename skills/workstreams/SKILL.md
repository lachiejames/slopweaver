---
name: workstreams
description: 'The owner''s outcomes register, the store rows the console''s Workstreams page reads. Each workstream is an outcome with its own milestones, the last its definition of done, and a dated, cited story; its progress is DERIVED from the entries that finish each milestone with their proof. Use when a milestone was reached, an entry or feedback should be added, a workstream starts, closes or changes status, or the owner asks how a workstream is tracking. Phrases like "update the workstreams page", "that''s the approach agreed", "add this to the timeline", "how far is the E2E gate".'
argument-hint: "list [--json] | put --file <document.json> | candidates [--unruled | --ruled] [--json] | react <their words> [--heard <their words>] | define | retitle | who-first | propose | loop-in"
---

The owner's ruling: one page, one card per workstream the owner drives, each a bar from the problem being raised
to the loop closed with the team, opening to its dated story. For the owner's own memory of everything in flight:
actual things progressed to actual outcomes. A later ruling: a vertical list of
collapsed cards, at risk first, each naming whose move it is, so fewer get dropped.

## The register

The owner's workstreams live in the store, one row per workstream with its own milestones, entries and links
([the model](../../docs/store/workstreams.md)), never a file: the retired `workstreams/register.json` is fenced, and
the store refuses to open while a file stands there. `slopweaver workstreams list --json` prints the schema-version-2
document the page reads, every figure derived and the register's `baseline` at its top;
`slopweaver workstreams put --file <document.json>` takes that document back, edited, in one transaction.

```bash
slopweaver workstreams list                                # one line per workstream, at risk first: lane, status, progress, hold
slopweaver workstreams list --json > "$dir/document.json"   # edit this copy
slopweaver workstreams put --file "$dir/document.json"      # refused, nothing written, if the register moved since
```

`put` checks the document's `baseline` against the register: one another writer moved since your read is
`WORKSTREAM_BASELINE_STALE` and writes nothing; re-read and rebuild. A document with no baseline can only seed an
empty register. It writes only the workstreams that changed, deletes the ones the document omits, and keeps every
stored entry and link id; a new one gets a fresh UUID. Each workstream's `derived` block is read, never written.
An empty store is exit 3, a store that refuses is exit 1, never an empty page.

A workstream is `{ id, kind, name, outcome, status, workspace, detail, milestones, entries, links }`, and
`src/workstreams/store/types.ts` with `decode.ts` (each kind's `detail`) is the contract. Five kinds:

- **`outcome`**: under one declared initiative, its own milestones.
- **`standing`**: upkeep outside the initiatives (its `initiative` is null), its own milestones.
- **`linked`**: somebody else leads it and the owner's work feeds it; its own milestones and their `gauge` (value, of, gate).
- **`local`**: kept on the page only, the means rather than an outcome: no milestones, no progress.
- **`closing`**: finished or handed over, with whether it still `holding`, the `closedOn` day, its `people` and
  dated entries. A completion is kept and filtered for, never tucked away (the owner's ruling). No milestones, so
  `milestone-of` cannot place under one; `outcome-of` notes it.

Every kind states its **`workspace`** (`team` or `self`), which the console's context switcher filters by.
`outcome`, `standing` and `linked` carry in `detail`:

- **`waitingOn`**: whose move it is when something holds it — `{ on: "you", what }` for a decision only the
  owner can make, `{ on: "someone", who, what }` for a person to chase, or `null`. It is what puts a card in the **Your
  call** or **Chase** lane; read it from the evidence, never guess a name.
- **`priority`**: `{ level, because, anchor, rank? }` from a steer of the owner's (urgent, high, normal, parked), the
  anchor the turn or message they said it in, or `null` when no steer is on record. Never infer a level. `rank` (a
  whole number, 1 first) orders an `urgent` one against the owner's others, only as they ranked them; unranked follows ranked.
- **`queueWorkstream`** (optional): the board's `workstream=` tag value its Queue cards carry, a kebab-case id
  (`iso-27001-controls` → `iso-certification`). At `urgent` it makes this workstream one of the owner's
  **priorities**: what blocks its cards leads the owner's Queue, then its cards, ahead of every other card, the voice
  and `handover reconcile` in the same order ([the owner's priorities](../../docs/console/queue-focus.md)). Absent,
  the priority moves no card.
- **`people`**: `[{ slack, part }]`, each person involved by Slack member id (`slopweaver identity show --json`)
  and the part they played, from the evidence. The slide-over draws them as identity chips.
- **`ending`**: `null` while it is live, or `{ kind: "abandoned", reason, on, anchor }` when it ended without its
  outcome ("done" is the wrong word for previews that were dropped). It puts the card in the quiet **Abandoned** lane,
  never counted as done, and keeps its story. A `closing` one carries it too. Record it with `react` (below),
  never by hand.

**`links`** tie it to what is part of it, each one closed kind: a queue or alignment card's slug, an automation's
`recipeId`, a pull request `owner/repo#N`, a Linear project's UUID, or another `workstream` it bears on, why in
`label` ([the grammar](../../docs/store/workstreams.md#the-link-grammar)).

The register document (`meta`) names every Slack conversation a link points into once, in **`channels`**: id to the
words the owner knows it by (`#proj-monitoring`, `your DM with a teammate`; `atlas slack --json` holds the
names). A citation never shows a channel id, so `put` refuses an entry or feedback link into a conversation the map
lacks.

## Its own milestones, and the definition of done

The owner's ruling: each workstream carries **its own milestones**, `[{ id, name, after, anchor, position }]`,
`after` the ids it waits on (some run in parallel, some still in order), `anchor` where the owner named it. The milestone
`done` is **its definition of done**, last, and every other milestone leads to it. A promoted candidate starts with
it; `define` renames it in place. There is no generic bar and no percentage.

**A milestone is done only when a dated entry finishing it links the proof**: `{ milestoneId, done: true, href }`.
A Slack permalink, a merged pull request, the announcement. Never mark one done without its link. Progress
(`"2 of 3 done, next: Rolled out"`), each milestone's state (done, moving, ready, waiting) and its column are
DERIVED (`src/workstreams/store/derive.ts`, `src/workstreams/milestoneGraph.ts`), never typed. **The page leads with
what is at risk**: the owner's call, then a chase, then stalled, each ranked by the owner's priority
(`src/workstreams/lanes.ts`).

## What a session writes, and what it never does

- **Read the evidence first.** An entry quotes or summarises a real message, PR or ticket, dated the day
  it happened, and links it. Read Slack and Linear through their verbs (rule 3).
- **Feedback carries both signs**, the negative beside the positive, with `response`: what the owner did about it.
- **`skeptic` is the cynical morning read** of the card (the morning read after an excited night). Keep it true and short.
- **`status` is one of the owner's four words**: proven, validating, stalled, discovery. `statusNote` is its line.
- **Never a time estimate**, on any field.
- **Nothing here reaches a person.** The register is the owner's; a card is never posted anywhere as the owner.

## Candidates the owner reacts to, and what a yes becomes

**The register is the ONE source of the owner's outcomes** (the owner's ruling: one way of doing things): the
supervisor's coverage reads what the owner kept here, and nothing checked in is an outcome. The candidates are one catalog
(`src/workstreams/candidateCatalog.ts`): FIRST the outcomes the owner has stated, read from the state home
(`$SLOPWEAVER_HOME/workstreams/stated-candidates.json`, each the owner's words and its turn anchor; absent is none), THEN workstreams MINED from a person's connected history
(onboarding mines it, Notion alone is enough), each carrying dated quotes of their own words, two
or three definitions of done with trade-offs, what looks stalled, and who to loop in. Nothing is written until the
owner keeps one; they keep or drop each when they next open Workstreams. Five words answer one — yes, no, sort of, not sure, let's talk — and six place it:
done, same-as, milestone-of, outcome-of, superseded, abandoned. A yes the register does not hold becomes a
`standing` `discovery` workstream there and then, its `done` milestone the definition picked (a stated one's, the owner's words) and its
board membership the candidate's, its story owed to this seat.

```bash
slopweaver workstreams candidates               # every candidate, every answer on it, and what this seat owes
slopweaver workstreams candidates --unruled     # only those with no word of the owner's yet — the only list offered them
slopweaver workstreams candidates --ruled       # each ruling: the owner's word, the day, and what they said
slopweaver workstreams react "12 yes, 13 no 14-16 sort of" --via word --anchor <where they said it>
slopweaver workstreams react "83 abandoned" --via word --reason "<their why>" --anchor <where they said it>
slopweaver workstreams define --candidate c-012 --option owned-and-read --via word
```

The owner answers on the console's `/workstreams#candidates`; `retitle`, `who-first`, `propose` and `loop-in` (which
parks a draft on the owner's Queue and sends nothing) are the other answers. **Relay the owner's words verbatim and say
in one line what landed.** A row keeps them as `heard`, so the owner never repeats a ruling: the console voice writes its own through
`relay_steer`'s `candidate` and `reaction`. Every word, ledger and seat duty: [reference/candidates.md](reference/candidates.md).

## Why this is not the board

The handover board is the only register of work IN FLIGHT ([workstreams.md](../../docs/workstreams.md)). This
holds outcomes that outlive every board row under them. A board row has no page, so its citation reads as the row's
words; the fleet's placement against the board is on `/fleet`. The Workstreams page is `/workstreams`; how each figure on it is derived is
`site/content/console/workstreams.mdx`.
