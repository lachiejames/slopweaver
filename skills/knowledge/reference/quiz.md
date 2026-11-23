# The quiz — one question per sweep, running the other way

One quiz question on the briefing per sweep. This is the half of the ledger that reaches beliefs the owner never
stated.

## Why it is not the correction block

The [correction block](../../supervisor/reference/owner-beliefs.md) asks whether the fleet read the OWNER'S words
correctly. Its source is the owner's own recorded speech, so it can only ever surface a belief the owner has
already said out loud. The quiz runs the other way: it takes a claim the FLEET learned the hard way and asks the
owner whether it is true. That is what makes it a separate surface: a belief held confidently and wrongly is the
one a quiz catches and a briefing does not, because the owner would never have thought to ask.

Two surfaces with the same job would be the defect here, not the redundancy.

## The verbs

```bash
slopweaver knowledge quiz --sweep <tick-id>                        # cut this sweep's question
slopweaver knowledge quiz-answer <quiz-id> --answer "<the owner's exact words>"  # record what the owner said
slopweaver briefing render … --knowledge-quiz --sweep <tick-id>    # put it on the page
```

`knowledge quiz` is IDEMPOTENT per sweep by construction: a sweep that has already asked gets its own
question back rather than a fresh selection, because the page the owner is reading carries that question's id.
`briefing render` only ever READS the ledger — it never cuts — so a sweep re-rendered after a new lesson
landed shows the question it already asked.

## It is ON every sweep, and traces go first

The quiz is pointed at the fleet's traces. So every sweep cuts the question and renders it; a sweep that skips
either is the quiz switched off, which leaves `quiz.jsonl` empty.

A **trace** is asked before a lesson, because it is the half the owner has never been asked about and the half that
decays fastest — a place the fleet stopped looking is worth re-opening long before a conclusion is worth
re-testing. An empty one asks _"we stopped looking here for X — keep that, or re-open it?"_; a paid one asks
_"this probe paid for X — still where you would look?"_ The probe and the evidence sit in the fold, and the
block carries no tier, because a trace has no rung on the harm ladder ([traces.md](traces.md)).

## What can be asked, and how one is chosen

A `confirmed` **fleet** trace, or a `confirmed` or `refuted` **fleet** lesson. A quiz needs an unambiguous reference answer, and the
other three verdicts supply none — `unsettled` in particular means the fleet has already said no call could
settle the claim, so asking would collect the owner's opinion and file it against a row that cannot disagree with
it. `knowledge quiz` reports how many candidates each excluded verdict cost, so the narrowing is visible.

The owner's rows are filtered out before the fold, because the owner's row and the fleet's for one claim share
an id — left in, one of the owner's own answers could become the reference answer to its own question.

**The selection is a mechanical rotation, never a reading**: least-asked, then oldest-asked, then TRACE
before lesson, then worst tier, then claim id. Rule 2 forbids a model inside a verb, so nothing judges which lesson is worth asking about.
Ranking on times ASKED rather than answered is what stops a question the owner ignores pinning the quiz forever.

## It is a self-check, and the page says so

The fleet's own answer is on the page, inside the fold, and the contract line tells the owner it is there. The
briefing is static HTML the owner can read end to end; a design that depended on the owner not opening a fold
would be lying about what an artifact is. What the ledger records is what the owner SAID, and the value is the
**disagreement** — a claim where the owner's answer and the fleet's verdict come apart is a row worth having on both
sides of the register.

The gate refuses a page that renders that answer ABOVE the fold: it turns "do you agree?" into "here is the
answer, do you agree?", which collects the owner's agreement rather than the owner's belief.

## It grades nothing

There is no `--correct` flag and there will not be one. Deciding whether the owner's answer is right means assessing
the claim, which is what a verdict on a register row means, and a session hearing _"no, that only happens on
the read replica"_ has to judge whether that refutes the fleet's claim or narrows it. So `quiz-answer`
stores the owner's words and says what is still owed; `knowledge record --learner owner` is the explicit next step,
and it owes a verdict and evidence of its own.

A second answer to one question is refused. What the owner said is never overwritten, and a changed mind belongs in
the next sweep — which asks a different question anyway.
