# The detective fan-out — who spawns what, and how a turn investigates

The investigation half of [SKILL.md](../SKILL.md) step 2. [dynamic-planning.md](dynamic-planning.md) is the
LOOP this runs inside; this page is how that loop reaches the world model.

**The rule:** whenever anyone asks the bot a question, the haiku fan-out runs and does the investigation.

And the corpus is READ by an investigation, never ranked into an
answer: no embeddings, no pgvector, no re-ranking, no semantic search.

## The diagram — who spawns the Haikus

```text
  the owner
    │  the only place the owner ever types
    ▼
┌──────────────────────────────────┐
│  SUPERVISOR CHAT                 │  one pinned cmux workspace, on Fable.
│  /slopweaver:supervisor          │  The owner's single intake. It ROUTES work.
│                                  │  It never investigates, and it never
│                                  │  spawns a Haiku.
└──────────────────────────────────┘
    │  cmux spawn --model <opus|sonnet>   → a VISIBLE workspace, one per turn
    ▼
┌──────────────────────────────────┐
│  BOT-TURN SESSION                │  /slopweaver:loop-bot, ONE Slack thread.
│  visible, interruptible          │  Reads the thread, probes the store,
│                                  │  plans the wave, collects, composes, posts.
└──────────────────────────────────┘
    │  native Agent tool, model: haiku, IN PROCESS — N of them, FLAT
    ├──▶ detective 1  ─┐
    ├──▶ detective 2   │  each climbs the ladder: probe → groups → hits
    ├──▶ …             │                        → peek → open → around
    └──▶ detective N  ─┘  each writes ONE report and stops.
    │
    │  every report returns into the bot-turn session's own context
    ▼
  compose  →  turn dispatch  →  REVIEWER  →  turn answer  →  Slack
```

**Three facts the diagram is drawn to make unmissable:**

1. **The supervisor the owner talks to is not the thing that spawns Haikus.** It spawns the bot-turn session;
   the bot-turn session spawns the Haikus. Two different agents: a separate session is spun up per
   question, as the bot does when a new question comes in, and that session launches the Haiku sub-agents.
2. **It is FLAT. A detective never spawns anything.** One level of nesting: recursive
   spawning carries a lot of risk, so keep it flat.
3. **Kill the bot-turn window and every detective in it dies.** That is the no-headless property (rule 2)
   working, not a limitation: a headless claude process goes astray with no one watching it. If the bot-turn session itself dies, the supervisor
   sees it — it already tracks every session.

## Before the wave: an ambiguous name gets probed across its forms

When the person a question names is ambiguous **in free text** —
no tag, a first name only, a possible misspelling, a nickname the thread uses — probe counts across the
name's variants BEFORE the Haikus launch, treat zero hits as the WRONG SPELLING and try another, and size
the leads on what the probes turn up. **Good judgment, no dumb rules. Ids are never ambiguous**, so the step
never fires on one. You supply the forms — no table, no edit distance, no soundex — and the verb copies its
verdict into every brief:

```bash
"${CLAUDE_PLUGIN_ROOT}/bin/slopweaver" store detect "<the question>" --term "<keyword>" --ask <channel>/<messageTs> \
  --name "<the name as the question wrote it>" --variant "<another form>" --variant "<another>"
```

`--ask` lands the wave in this turn's record set ([where reports land](../../knowledge/reference/detective-lessons.md#where-the-reports-land)).
The two measured cases — a near-miss spelling that is not empty but is OTHER PEOPLE, and a transcript
mangling a name outright — the forms to propose, what the verb decides (only two things, and an id is one),
and how a nickname gets found are in [detective-names.md](detective-names.md).

## How many detectives, and why

**Counted from the probe, never chosen.** `src/detective/fanout.ts` is the rule and carries the reasoning;
the short version:

- One lead per `(keyword, source)` pair with a positive count — **not one per shape.** The seven shapes of
  one keyword select overlapping populations of the same records, so a detective per shape sends seven
  readers at the same rows and calls the duplication a fan-out.
- Splitting by SOURCE is real work: a keyword's Slack rows and its Linear rows are different conversations
  held by different people. On this store that is load-bearing — one Slack alert channel holds about half
  of a couple of million rows, so an unsplit fan-out spends every slot on it and never opens the few dozen Linear rows.
- Plus ONE discovery detective, always, bound to no keyword and no source. It re-asks the question in other
  words and challenges every recalled exclusion. It is also the only detective when the probe found nothing
  — a fan-out of one is the honest answer to a question whose vocabulary we have not found yet.
- A cell over 500 rows is not a lead. It is split first with `store groups --facet container`, which turns
  one unreadable cell into several readable ones.
- Ceiling 30, and what sets it is the visible session's own context rather than the machine — every
  detective is an in-process sub-agent of it and every report comes back into it. Lap two ran 28 readers in
  one session and composed from all of them, which is the only measurement this repository has.

So: **four** when the probe found three seams, **eight** when it found seven, **thirty** when it found
twenty-nine. Each number is derived.

## The ladder every detective climbs

Counts first, records last. Each rung costs more than the one above it. **The three search rungs are human-only**,
as Slack search is: add `--include-bots` when the answer may be IN an automation (an alert, a Renovate
PR) or the probe's `bots:` line dwarfs its counts. `peek`, `open` and `around` always show bots.

```bash
"${CLAUDE_PLUGIN_ROOT}/bin/slopweaver" store probe <keyword> [<keyword> …] [--regex <p>] [--source <s>] [--include-bots]
"${CLAUDE_PLUGIN_ROOT}/bin/slopweaver" store groups --term <t> --shape <s> --facet container|author|source|kind
"${CLAUDE_PLUGIN_ROOT}/bin/slopweaver" store hits   --term <t> --shape <s> [--limit <n>] [--offset <n>]
"${CLAUDE_PLUGIN_ROOT}/bin/slopweaver" store peek   --id <uuid,…> [--match <term>] [--chars <n>]
"${CLAUDE_PLUGIN_ROOT}/bin/slopweaver" store open   --id <uuid,…>
"${CLAUDE_PLUGIN_ROOT}/bin/slopweaver" store around --id <uuid | <channel>:<ts> | a slack link> [--mode conversation|thread|container]
```

**The seven shapes, and what the counts are for.** `exact` (the stemmed word), `wild-left` (`*term`),
`slash` (`/…term…/`), `alnum` (`[0-9a-z]*term[0-9a-z]*`), `wild-right` (`term*`), `wild-both` (`*term*`),
`regex` (yours). Read the ladder for where the count **collapses** — the probe prints it — and spend
attention on the narrowest non-empty rung.

MEASURED on a live store of a couple of million rows, and it is why this is a ladder rather than a search:

| keyword   | `exact`         | narrowest rung     | `wild-both`     | whole ladder     |
| --------- | --------------- | ------------------ | --------------- | ---------------- |
| `barten`  | dozens          | `wild-left` dozens | thousands       | about a second   |
| `17000`   | 13              | **`slash` 4**      | 20              | under a second   |
| `datadog` | about a million | `slash` thousands  | about a million | over ten seconds |

`barten` makes `exact` insufficient alone: **nearly all the records mentioning the name are invisible to the
tsvector**, which tokenises on punctuation, so a name inside an email, a `<@U…|handle>` or a URL reaches only
a substring. `17000`: the four `slash` hits are pull request URLs ending in that number, and `store peek
--match 17000` tells that pull request from a ticket numbered `170006` without opening either record.

**Three moves that are not searching, and they are where the lap-two win came from:**

- **`around` is where the answer usually is.** Two of the four lap-two questions were settled by thread
  REPLIES containing none of the search terms. It takes an anchor, never re-applies the term, and defaults
  to `conversation`: the whole thread AND the channel around it, with reply counts.
- **Follow the links.** `store open` returns the URLs a record's text linked to. A Slack message linking a
  Notion page is an instruction to go read that page.
- **Reject junk out loud.** A detective that reports everything it found has reported nothing.

## Two more SOURCES beside the corpus, each on its own verbs

The store knows what was SAID. **Datadog** knows what HAPPENED: `--source datadog` routes the same ladder
there, a `dd:` id routes the record verbs there with no `--source` at all, and the local shape catalogue is
what you read before a live query — it costs no network and a live search does not. The four rungs, the
correlation modes, the retention ceiling and the one that matters most — what you read is UNREDACTED and
what you report must not be — are in [detective-datadog.md](detective-datadog.md).

An **atlas** knows what a platform CONTAINS, and `store detect` spends a detective per PLATFORM off one
statement over all of them — nothing merged into `content`, so an atlas stays DISTINCT from the
corpus. `atlas probe` SIZES and `atlas <platform> read --query` answers; the scope
read, the one-lead-per-platform rule, the ZERO that is this STORE rather than the provider, and the
staleness every lead carries are in [detective-atlas.md](detective-atlas.md).

## What the fleet has learned before

Recall at the START of the wave, on the nouns the question actually names, and put the result in every
brief — see [../../knowledge/reference/detective-lessons.md](../../knowledge/reference/detective-lessons.md)
for what a detective records and how a wrong memory gets corrected rather than left standing.

```bash
"${CLAUDE_PLUGIN_ROOT}/bin/slopweaver" knowledge recall "<the nouns the question names>" --domain store-detective
"${CLAUDE_PLUGIN_ROOT}/bin/slopweaver" knowledge list --domain store-detective   # the file lane, always available
```

**A recalled claim is a HYPOTHESIS, never evidence**, and an exclusion one proposes never narrows the probe
that already ran — re-check a sample of what it would have excluded first, and say in the report whether it
held. A memory can turn out to be wrong, and acting on it means operating off bad data.

**The bot's own earlier answer is the same class, and it is the one a detective actually falls for.**
MEASURED on this path's first live dogfood, on the owner's own question "what are Tobyn Barten's top
five pain points": **five of the six detectives that reported cited one record** — an earlier bot message
answering that identical question in the owner's DM — rather than any record another person wrote. The Slack detective did it with 18 `exact` and
2,865 substring rows of primary material in front of it. The only one that reached primary evidence was the
gmail detective, whose source held no copy of that answer.

The cause is structural, not carelessness: a posted answer is a stored record, it contains the question's
own words verbatim, so it ranks for the very question the wave was sent to investigate. `src/detective/brief.ts`
refuses it in the same breath as a recalled lesson — finding one is worth reporting, because it tells the
wave this ground has been walked; citing one as the answer is the failure that looks most like success.
Reproduce the shape with `slopweaver store groups --term barten --shape exact --facet container`: 18 of
those 48 rows are Slopweaver's own working state rather than evidence about any person.

**The reading is a WAVE of its own.** `slopweaver knowledge detect "<the question>"
--term <word> …` plans Haiku detectives over the register, so this session never reads 1,200 rows to find
three. Run it BEFORE `store detect` and pass its reports into `--recalled`; an unreachable store still
REFUSES with its reason rather than answering an empty page. The contract, the sizing rule and the two
limits every brief carries: [../../knowledge/reference/recall-detectives.md](../../knowledge/reference/recall-detectives.md).

## The rest of the turn is unchanged

Collect the reports, challenge the contradictions between them, decide whether a second wave is worth it —
and then compose and send exactly as [SKILL.md](../SKILL.md) step 4 already says. **Detective collection is
not the reviewer's verdict**: the independent reviewer in `turn dispatch` → `turn answer` runs unchanged,
and nothing here is a substitute for it.
