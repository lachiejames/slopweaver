# The card's shape: meter, outline, and the loop below the fold

What `turn status --plan` and `--step` draw, and why each part is bounded. The parent is
[live-card.md](live-card.md) § 1; this page owns the shape.

## What the card is for

The progress tracker illustrates the dynamic planning loop and shows progress in a visible way. It is a
meter and an outline above the fold, and the loop's phases below it, rather than a flat trail of ticks.

## Above the fold

- **The meter**, first and glyph-less: `▰▰▱▱ step 2 of 4 · worker 2 · review round 1 · re-planned`, or
  `4 of 4 steps done` once the turn finishes. With no plan it counts updates instead, and a turn with one
  update and nothing else to say draws none.
- **The question**, as it always was.
- **The outline**: the plan's steps, with ONLY the live step expanded — its latest finding and the `now:` line
  as indented sub-lines. Earlier steps are ticked with their own finding beside them; later ones are pending.
  With no plan, the latest stage is the one live step.

## Below the fold, under `the loop so far`

One phase per plan, re-plan, worker handover and review round, each with the findings filed in it. A review
round is filed by `turn review` itself once the reviewer holds its pickup; a handover is a stage written by a
different visible session from the last one. The loop only appears once the timeline holds two events, since
before then the outline already says everything it would.

## Bounded by construction, so the fold never truncates

Rule 7 wants a schema that refuses a wall rather than cutting one. So `--plan` refuses more than 7 steps or a
title over 60 characters (`src/live/turn/liveStatusCap.ts`), `--step` past the plan's length is refused, every
line is clamped to the card's line cap, and the loop keeps its last 12 phases of 6 findings each with a
`… N earlier phases` line in place of the rest (`src/live/turn/progressLoop.ts`). Slack's own task chunks
carry the outline alone — a meter or a loop phase is not a task it could tick.

## Where it is computed

`src/live/turn/progressLog.ts` folds the log's `stage`, `plan` and `review` lines into one timeline;
`progressLoop.ts` walks it into phases and the meter; `progressOutline.ts` draws the outline and the loop;
`src/outbound/assistant/todoBlock.ts` renders the loop block that `turnMessage.ts` puts below the Details label.
