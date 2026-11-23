---
name: value
description: Draw the weekly value sample — five asks that ended in the last seven days, picked at random, each with its model-weighted cost and what it produced — publish it as a local page with one Queue card, and record the owner's one word per ask (used, not used, not yet). Use when the owner answers the week's value-sample card, when the Monday `value-sample-weekly` row fires, or when someone asks whether the work the fleet finished got used. Phrases like "was that worth it", "did I use those", "used", "not used", "not yet", "draw this week's value sample".
argument-hint: "sample [--home <dir>] [--projects-dir <dir>] | answer --slug <ask> --answer used|not-used|not-yet [--week YYYY-Www] [--home <dir>]"
---

Cost and throughput are measured elsewhere (`session spend`, `fleet ceiling`). This verb asks the one question only
the owner can answer: **did the work get used?** Five asks a week, one word each.

## The verbs

```bash
slopweaver value sample [--home <dir>] [--projects-dir <dir>]
slopweaver value answer --slug <ask> --answer used|not-used|not-yet [--week YYYY-Www] [--home <dir>]
```

`sample` runs every Monday at 07:00 as the standing row `value-sample-weekly`
(`src/live/automation/standingMeasurementRows.ts`). It can also run by hand. The steps:

1. Read the board.
2. Keep the asks filed or answered in the seven days before now. Declined asks are left out.
3. Draw five at random, seeded by the ISO week, so a re-run draws the same five.
4. Join each ask's cost through the seat spawned for it.
5. Read each linked pull request's state.
6. Write the week's file, publish the page and place one Queue card.

It exits 3 when no ask ended that week. The runner stamps that as a quiet week.

`answer` records one word for one ask in the week's file. Giving the same answer again changes nothing. A
different answer is refused, because a recorded answer is the owner's word and is never replaced. Once every ask
has an answer, `answer` withdraws the week's card.

## When the owner answers

The owner answers on the Queue card or to the supervisor. Record each word with `value answer`, one call per ask,
using the slug from the page. Never make up an answer the owner did not give. "Skip this week" means record
nothing: the card stays, and next Monday draws a new sample.

## What a cost means, and what it does not

A cost is model-weighted units (`src/sessions/modelWeight.ts`). They are summed over the transcripts that ran in the
working directory of the seat spawned for the ask, its subdirectories included. Which seat that is depends on how
the ask ended:

- A **filed** ask is joined through the doc it became.
- An **answered** ask is joined through its own slug.

An ask with no seat, or whose seat's transcripts are not on this machine, shows **not measured** with the reason.
It never shows a zero. The page also says how many turns a known model served, so a partial price reads as
partial.

## One sample per week, kept

`ledgers/value-samples/<YYYY-Www>.json` in the state home holds the draw, each ask's cost and outcome, and the
answers. A re-run in the same week reads the file again and never draws again, so the page and card the owner is
answering never change. A damaged file is an error, never treated as missing, because drawing again over it would
throw away recorded answers.

## The modules

| Module                    | What it is                                                             |
| ------------------------- | ---------------------------------------------------------------------- |
| `src/value/week.ts`       | the ISO week, read off the owner's local day                           |
| `src/value/sample.ts`     | which asks are eligible, the seeded draw, and the cost join (all pure) |
| `src/value/store.ts`      | the week's file and merging answers in                                 |
| `src/value/render.ts`     | the card's fields and the page fragment, every string escaped          |
| `src/cli/commands/value/` | the two thin verb shells, plus the board read and card placement       |
