# The answer-quality lane — grading what the answer SAID

`src/eval/` is the offline evaluation lane. It holds one instrument, `src/eval/answerQuality/`, and
this page is what it measures, what a grade means, and the one failure mode it is built to be incapable of.

## Where it came from

When approving the frozen private eval case set, the owner asked for grading on the content and context
inside the message, not only on whether it reads in the house style.

The frozen set's retrieval scorer measures RECALL against expected record ids — which records came back —
and structurally cannot express that dimension. This lane does.

**Read the approval record before quoting it, because two of its attributions are easy to get wrong.** The
grading note above is the owner's reaction to `case-02` specifically, not a remark about the set. And what
the owner singled out — the honest caveats and the Notion-versus-self split — is the owner's
reaction to `chain-01`, an evidence-chain case that carries **no answer text at all** and is graded on
GROUNDING — there, that split names which SOURCES the chain spans, not a claim credited inside an answer.

So the two dimensions here that are not "did it say the right thing" — the **what-it-does-not-prove
honesty** and **attributing a claim to a named source rather than asserting it bare** — are a reading of what
the goldens DO, which `case-07` and `case-08` carry plainly. They are not something the record shows the owner
asking for at the answer level. That is worth the owner's eye rather than a footnote, and it is in the park.

## It is not the live-send gate, and that confusion is the commonest one

`src/admit/answerQualityGate.ts` judges an outbound form BEFORE it is sent. This lane grades an eval
candidate OFFLINE against a frozen golden. They share a name and nothing else, so a grep for one matches both.

## What a grade is made of

A case pairs one proposed golden with a rubric derived from it:

| Dimension           | What it holds                                                                 |
| ------------------- | ----------------------------------------------------------------------------- |
| `claims`            | the substance the golden asserts                                              |
| `caveats`           | the what-it-does-not-prove honesty it carries                                 |
| `attributions`      | a claim credited to a NAMED source (a Notion runbook, a screenshot, a thread) |
| `inventedCertainty` | phrasings that assert certainty the golden does not hold                      |

Each declared dimension scores `met / total`; the grade is their mean over the dimensions the case
DECLARES, so a case with no attributions is scored over three rather than penalised for a dimension it never
had. Bands: `top` at exactly 1, `sound` from 0.8, `degraded` from 0.5, `unsound` below.

**One asymmetry, and it is not a weight.** Any invented-certainty hit CAPS the band at `degraded` whatever
the mean says. An incomplete answer leaves a reader short; a falsely certain one sends them somewhere wrong.
A mean lets a complete answer bury one.

Every unmet expectation produces a NAMED reason — `caveat dropped: does not claim it was reproduced` — never
a similarity score. The reasons are the output; the number is the part nobody has agreed to yet.

## Nothing here calls a model, and that is the design rather than a limitation

Deciding what a golden CLAIMS is judgement. Judgement is done once, by a visible session reading the golden,
and written down as a rubric — after which a grade is reproducible byte for byte. `eval/judgementAssertion.ts`
refuses the alternative for the same reason: grading a model's output with a second live model call
makes a red result unreproducible.

`requires` is an ALL-OF list of ANY-OF groups. Every group must hit; within a group any alternative will do.
That is the shape that lets a restatement satisfy an expectation while still refusing an answer that dropped
the concept.

## The failure mode it must never have, proved rather than claimed

**Rewarding token overlap over substance.** `slopweaver dev answer-quality --cases <path> --selftest` runs
five ordering properties over every case and exits non-zero if one fails:

1. the verbatim golden scores `top`;
2. the case's authored paraphrase is MEASURABLY one — Jaccard token overlap with the golden below 0.5;
3. that paraphrase also scores `top`;
4. every caveat and attribution anchor is specific enough that deleting its sentences removes it;
5. every mechanically degraded variant grades STRICTLY DOWN, and the certainty one is capped at `degraded`.

Properties 4 and 5 are the pair no overlap scorer can pass, and the numbers are the argument rather than the
prose. Jaccard against the golden over `eval/answer-quality.fixture.json`: golden 1.000, caveat-dropped
0.612, attribution-dropped 0.755, certainty-invented 0.942. The certainty variant only APPENDS, so it keeps
every token the golden has and is the CLOSEST degradation by overlap — and it is the one the band cap holds
furthest down. An overlap scorer ranks those three in the opposite order.

Those four numbers are ASSERTED rather than recounted here, by
`unit/eval/answerQuality/selftest.test.ts` § "the shipped fixture's overlap profile", which reads the shipped
fixture and fails if editing it moves any of them. Property 2 is what stops property 3 resting on the
author's good faith — a near-copy labelled "paraphrase" fails on a number rather than on a reviewer's opinion.

The degraded variants are generated from the rubric, never authored, so they cannot drift from the thing they
are meant to falsify.

## The converse does not hold

"Ignores wording" runs one way only. `satisfiesRequires` is `includes` over a lowercased,
whitespace-collapsed string, so a candidate that reworded the golden while carrying identical substance
scores BELOW it whenever the rubric's `requires` alternatives did not anticipate that wording. The
counterexample is a TEST rather than a paragraph — `unit/eval/answerQuality/score.test.ts` § "a rewording
outside the anchors" — where a one-claim case anchored `[["unrelated"]]` grades its golden `TOP 1.000` and
"has nothing to do with the original fault" `UNSOUND 0.000`. Run it; a matcher that ever closed this gap
would redden it rather than leave this page quietly stale.

Closing it in the matcher would need a model, which this lane refuses — `eval/judgementAssertion.ts` rules
that a red result graded by a second model is unreproducible. So it is an AUTHORING bar instead, and
property 3 is what enforces it: a case whose anchors are too narrow for its own paraphrase fails the
selftest. It fired on the real `case-01` during authoring, whose claim anchor read `["unrelated"]`
while its own paraphrase said "nothing to do with". Narrow that anchor back and the paraphrase grades
`SOUND 0.917` — one claim of three missed, the other three dimensions clean, `(2/3 + 1 + 1 + 1) / 4` — so
`paraphrase-scores-top` reddens and the case cannot ship until the anchor names the wording it meant to
accept.

State the guarantee accordingly. It is not "wording-independent". It is "every case carries one paraphrase
whose anchors are proven wide enough, and a rewording further out is out of scope rather than graded".

## What it gates, and what a green from it does NOT mean

The owner read a real grade and picked option A off the `answer-quality-scorer-dimensions` page: the
three dimensions are right, so the scorer gates the eval lane **beside the retrieval one**. That is
`slopweaver dev gate`'s fourth check, `answer-quality` (`src/devGate/answerQualityCheck.ts`), sitting next to
`evidence-handoff` because the two grade different halves of the same answer — which records reached it, and
what it then said.

**What runs is the SELFTEST, not a grading pass.** The five ordering properties are a claim the instrument
makes about itself, and that claim is what a gate is for; a grading pass needs candidate answers, which exist
only when somebody is evaluating something. Grading still gates nothing, and should not.

**Two lanes, and the summary never conflates them.** The committed `eval/answer-quality.fixture.json` always
runs. The private ten-golden rubrics run only on a machine holding them — and CI's home is a fresh
`$RUNNER_TEMP/slopweaver-home`, so in CI that lane is ABSENT on every run. An absent lane is a fact: it
passes, and the summary says `private lane NOT RUN` in the same sentence as the pass. A file that IS there
and will not parse is a failure, reported as a load-error COUNT rather than as its messages.

**The sensitive text cannot reach the gate's output, and that is a type rather than a habit.** A
`PropertyOutcome`'s `detail` quotes the golden, and so does its `property` on a degradation —
`degrades-down · certainty-invented: "<the phrase, verbatim>"`. `redactOutcomes` converts every outcome to a
`RedactedOutcome` — the case's 1-based POSITION in its own file, the property KIND, the state — at the
boundary, and the summary builder consumes nothing else, so printing a golden fragment from there is a type
error. The id is redacted too, and that is the part worth naming: an id reads as safe metadata, and
`caseSchema.ts` constrains it to a non-empty string and nothing else, so a later `case-jane-doe-referral-delay`
would travel. Both lanes go through the same conversion, so there is no per-lane branch to get wrong. The
witness is `unit/devGate/answerQualityCheck.test.ts`, which feeds a marker through a rubric's id and its labels,
asserts the raw selftest stream carries it, and asserts every line the check can print does not.

The hand-run verb is deliberately the other way round. `slopweaver dev answer-quality --selftest` prints the
full id, property and detail, because the operator running it already holds the file it read.

## Where the cases live

`eval/answer-quality.fixture.json` is a SYNTHETIC two-case file that ships, and is what the self-test probe
runs on. The real rubrics are derived from goldens naming real people and carrying sensitive context, so they
live at `$SLOPWEAVER_HOME/eval/answer-quality-cases.json` and are never committed — the same partition the
frozen set already follows.

**Its domain is the ten golden-text cases only.** The frozen set's five `chain-*` cases carry no golden text
at all: they are graded on grounding, and one of them is a refusal case with no chain by construction. There
is nothing here for this scorer to measure.

**A case declaring no claim, caveat or attribution is REFUSED at load**, naming the case — rather than
scoring every candidate 1.0 over an empty rubric and calling the lane green. All ten load, and two of them
are worth knowing about anyway, because the refusal is not what catches either:

- `case-07`'s golden is a follow-up QUESTION, not an answer. It declares no claim at all and grades on its
  hedge and its Notion attribution, which is exactly the pair the owner singled out — so it loads and grades
  honestly while "grade the answer" means grading a question.
- `case-09`'s golden discusses field classification while the question it was mined against is about
  booking-cancellation comms. **The scorer never sees the question**, so it grades the text happily. No
  property here can catch that class, and none pretends to.

Both are eval-set findings rather than scorer ones, and the owner's approval already covers the consequence: a
problem found later is an eval update, never a re-approval.
