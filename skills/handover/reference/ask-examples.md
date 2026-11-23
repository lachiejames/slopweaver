# Every open card leads with a concrete example

**A card leads with a concrete scene the owner can picture**: the owner is busy at the computer and a notification
pops up saying this; would the owner have wanted that to happen? That is effective because the owner can picture it
happening. An option list such as "A, this was the right call, B, this was not" leaves the owner rebuilding what the
problem was, why it was one, why solve it, how it was solved and whether that is aligned with the owner: every time
the owner opens the card, all the owner has is questions, not answers.

So lead with the concrete example, never the abstract. Not multiple choice; the owner needs something freeform to
react to, with the concrete examples, across the whole queue.

## What a scene is

A second-person story the owner can picture — what the owner was doing, what appeared, what the fleet did or wants to do — that
carries the five answers in it and ENDS on the question the card is really asking, ideally as "would you rather this
or that?". `src/handover/askExamples.ts` is the schema, and a violation is REFUSED rather than trimmed (`AGENTS.md`
rule 7): a word addressed to the owner, a closing `?`, and `ASK_EXAMPLE_MAX_WORDS` from `src/briefing/caps.ts`.

**Related asks fold onto ONE card** as up to `MAX_ASK_EXAMPLES` numbered scenes (concrete example one, two, three, then the owner's reaction). Fold the duplicates' rows onto the canonical
one and settle them `filed` with that slug as witness.

**A gap, never an invention.** A row whose own record cannot support a truthful scene carries `--example-gap` — one
line saying why — and the card prints it where the scene would be. A row carrying neither prints that nothing is
recorded yet; the console never composes one (`AGENTS.md` rule 2).

## The verbs

```bash
slopweaver handover ask <slug> … --example "<scene>" [--example "<scene>" …]     # or --example-gap "<line>"
slopweaver handover register --ask "…" … --example "<scene>"                    # every row that heads the owner's card
slopweaver handover example <slug> --example "<scene>" [--example "<scene>" …]  # an ask already open on the owner
```

`ask` writes the scenes on its own `question` (or `question-shaped`) line, so no ask can land without them;
`example` appends a `question-examples` event bound to the exact question it illustrates, so a re-cut question
drops it. `register` writes `examples:` / `exampleGap:` into the row's front matter. `example` picks the same source the
board reads — the journal for a run waiting on the owner, else the front matter — and refuses a row that is not open
on the owner. A `--dispatch` row refuses both flags; an unshaped `--finding` may carry them.

## How the card draws it

`site/components/console/QueueCardBody.tsx`: the scene (or numbered scenes) is the first row, above the WHAT, and
stays above the fold. **Your reaction** — the free field that sends to the supervisor chat — is drawn ahead of any
option. A drafted message's destinations stay drawn, because where a message goes is an act on the draft; every
other lettered option folds behind **what the session weighed**. The panel appends no option of its own: "answer
it", "read the thread" and "leave it" said nothing the card did not already say. The card draws no `why you` and no
`if silent` either: each was one sentence on every ask, and the owner never reacted to it
([the Queue](../../../docs/console/queue-and-triage.md)).
