# How much Codex a change earns — never whether

**Read [the skill body](../SKILL.md) first: the PAIRING itself is standing.** On every
non-trivial change Codex plans, you implement, Codex reviews, and `codex status --check` plus both landing
verbs refuse without evidence of both halves.

**The bounds are the owner's: ONE plan, at most TWO review passes** (a pass is one reviewed diff); a third is
refused before it spends (`codex-review-pass-cap`), and what stands after the second lands only on `--acknowledge
codex-loop-incomplete --reason` ([the full loop](../SKILL.md#the-full-loop)). A description's review is its own lane,
one pass per packet, which neither cap counts ([description-review.md](../../github/reference/description-review.md)).

**Judgement — most of this file — is what fills those passes**: which properties, how many, and whether a
CLEAN first pass needs a second. The trigger is the owner's: **when the confidence does not seem well
earned.** The owner ruled out a rule keyed to which part of the codebase a diff touches, because such a heuristic
falls to edge cases and builds a worse product. So this file is tells, not a table. Read them, then decide.

## The reflex this exists to catch

The session that first proposed a codebase-area rule for this had three prior rulings against exactly that
shape already loaded in memory — the corpus was not to be partitioned public/private, a workstream's shape
was not to be encoded, review routing was to stay advisory and never a gate — and proposed a partition
anyway. **Reaching for an area heuristic feels like rigour and is the opposite**: it decides in advance, on
a proxy, what only the claim in front of you can settle. If you find yourself sorting work into tiers by
directory, you have already left the judgement you were asked for.

## What "unearned confidence" means here — reuse the vocabulary, do not coin one

This repository already decided how to talk about a claim being earned, and it is **structural, never a score.**
`src/admit/reviewVerdict.ts` holds the rule: a model's own percentage of confidence is always misleading, so none is
calculated. So `ReviewedClaim` classifies each claim `supported` / `unsupported` / `unverifiable` against `high` / `low`
impact, and the bar is "no unresolved high-impact claim" — something a reader checks by looking rather than a number
they have to trust. `src/codex/outcomeContext.ts` refuses to invent a second one for Codex passes, on purpose.

Two consequences worth stating, because they are easy to get backwards:

- **Do not read your own `confidence` field as the trigger.** `ConfidenceLevel` in
  `src/live/turn/judgement.ts` is self-declared, schema-validated, and read by nothing. The reviewer brief
  says it outright (`src/live/turn/review.ts`): _judge the answer against the evidence, not against its
  confidence._
- **So cash the trigger out as a claim.** "The confidence does not seem well earned" means: _this change
  rests on a high-impact claim I would have to classify `unsupported` or `unverifiable` if a reviewer asked
  me to._ That is the question to put to yourself, and the tells below are just the shapes it takes.

## Tells

Every one is about the CLAIM. None is about which files it touches.

- **You are about to write a `probeWaiver:`.** You are declaring the claim unfalsifiable — `unverifiable`
  at whatever impact the work carries — which is the single sharpest moment there is.
- **You cannot name the command that would go red if you were wrong.** The claim rests on reading rather
  than running. The owner's bar is a question: in what mechanical way can you enforce that a PR does what it
  says it does? Words mean nothing to us.
- **A doc already claimed this fixed.** Recurrence is proof the last confidence was misplaced, so the
  second attempt deserves more scrutiny than the first, not less. This is the pain the whole rule serves.
- **You are describing a mechanism you never watched run.** Explaining why something works is not evidence
  that it does — that is `unsupported`, however well argued.
- **You cannot name what you doubt, only that you doubt.** Not a reason to skip the pass; a reason to run
  the full adversarial loop rather than one property.

## The counter-tell — when NOT to spend an EXTRA one

**A green behavioural probe that would fail if the claim were false already IS the proof.** Mechanical proof
and an adversarial pass are **substitutes, not a stack**, ABOVE the floor. A pass earns its extra cost exactly
where mechanical proof is unavailable; spending one on a claim a probe already holds buys nothing and teaches
the fleet that passes are ceremony. The cheapest correct move on a shaky claim is often to write the probe,
not to run another pass.

What a probe cannot substitute for is the floor itself. A probe proves the code does what you meant; the plan
pass is what checks whether you meant the right thing, and no probe you write can answer that about its own
premise.

## How many passes

The same judgement, one step down.

- **One property (`--pass r1` alone, one statement)** when you can name the specific doubt. Bound the
  question to it; a widened property is how a pass returns a paragraph instead of a verdict.
- **The full `r1`/`r2`/`r3`** when you cannot name what you doubt. Not knowing where to look is precisely
  what an adversarial loop is for.
- **`p1`–`p3` before you write code** when the plan itself is the thing you are unsure of — a plan built on
  a wrong premise costs more than a diff reviewed late.

## What this is, and is not, a gate over

**There IS a mechanical floor, and this file is not it.** `codex status --check` refuses a branch without
a conclusive STALE `READY` plan and a CURRENT conclusive review, `yarn validate:pr` chains it onto
`yarn validate:local`, and `github enqueue` / `github merge --admin` ask the same question immediately before
their own mutation. Not atomically, though, and not at the same point in each verb: nothing locks the ledger,
so a pass finishing in the last instant is not caught. `docs/doctrine-rationale/rule-9.md` § Rule 9 has both details.
This file governs everything ABOVE that floor, and nothing here refuses a landing.

**Rejected**: a check keyed to the CLASS of change — which files, which directory, which
risk tier. The floor names no area at all; it asks only whether the
pairing the owner made standing actually happened in this checkout, on this branch. Golden proof plus green CI
remains the merge bar ([the pull-requests reference](../../github/reference/pull-requests.md)).

**Trivial work has a stated route rather than a silent one.** Acknowledge `codex-loop-incomplete` with
`--reason "…"` on the landing verb; the reason is written to the door ledger, so a waived floor stays
countable afterwards. **There is a second route, and it is not yours to type**: `github landing --press`
names the same subject itself, with one constant reason, on a pull request a standing human approval covers
— the pairing a reviewer already did is what substitutes there
([landing-cadence.md](../../github/reference/landing-cadence.md)). Never widen that by hand. A reason-bearing `codex declare-trivial` verb was designed alongside this and
deliberately NOT built — the acknowledgement already carries the reason, and a second mechanism for the same
thing is how two of them drift. Its absence is a decision, not an omission.

`yarn validate:pr` is deliberately kept out of `yarn validate`, per `docs/constraints/coupled-claims.md`: ordinary build laps
run long before any review exists.

## The one pass that earns NOTHING: an exact repeat

Everything above is judgement. This is not, and it is the only part of this file that is a gate.

**A pass whose exact question already has a conclusive record on file is refused before it spends anything.**
The measurement behind it: **a measurable share of all Codex input was the same pass asked twice.** Not a
nearly-same pass; the same one. So the key is EXACT and
the check is a lookup, never a similarity judgement:

| Arm    | Keyed on                          | Deliberately NOT keyed on                                  |
| ------ | --------------------------------- | ---------------------------------------------------------- |
| plan   | branch + pass + `HEAD`            | the task text, the prompt hash, the dirty tree             |
| review | `diffSha256` + property id + pass | the commit, the branch, the base ref, the property's prose |

**Read the plan row twice, because it costs you something real.** Re-running `p2` on the same branch and
commit with a COMPLETELY DIFFERENT planning question is a duplicate by this key, and will be refused. That is
the requested rule rather than a bug, the refusal says so in its own words, and it is the first exception on
the hatch's list. The review row trades the other way and in your favour: a rebase that changes every SHA and
no bytes is still the same question, so the answer you already paid for still counts — and the landing floor
counts it too: `codex status` and both landing verbs print that review `CURRENT` with the reason "the diff it
judged against <base> is byte-identical", read from the same `diffSha256` this gate refuses on. A rebase that
DID move the diff leaves the review STALE and the re-run is not a duplicate.

**Only a CONCLUSIVE record refuses.** A plan that answered `READY` or `BLOCKED`, or a review that answered
`CLEAN` or `BROKEN` about the property its own scope names. A `NO_VERDICT`, a `FATAL`, or a review record
carrying a plan's verdict concluded nothing a re-run would merely reproduce, so none of them refuses anything.
A PLAN pass on a detached HEAD cannot be keyed at all and is never refused — its key is branch + pass + HEAD,
so an absence of provenance reads as "cannot say". A REVIEW pass is different and the distinction is
deliberate: its key is the diff digest, the property and the pass arm, none of which needs a branch, so a
review of the same bytes is still refused on a detached HEAD. That is right — the diff is what was judged,
and how you got to it changes nothing about whether the answer is already on file.

**The way through, when you have one of the legitimate exceptions:**

```bash
SLOPWEAVER_ALLOW_DUPLICATE_CODEX_PASS=1 slopweaver codex plan --pass p2 --task-file ./task.md --bound-seconds 1800
```

The refusal prints that line itself, with the prior artifact's id and verdict beside it, so you can read what
you already have before deciding to buy it again. Registered as `codex-duplicate-pass` in
`src/hatch/codexPassHatches.ts`; the mechanism is `src/codex/duplicate.ts` (the key) and `src/codex/passAdmission.ts`
(the decision), asked inside each pass as it STARTS — so a property queued behind three others sees whatever
those three published while it waited.

## A property chase

The spend the exact-repeat gate cannot see is the opposite shape: the SAME property re-run after every fix,
each time on a new diff, each time finding a new counterexample. `codex status` and `codex review` print a
`CHASE:` line (`src/codex/propertyChase.ts`) when a property's newest runs on the branch are three or more
`BROKEN` in a row. It refuses nothing; it is there so the next run is a decision rather than a reflex.

MEASURED, over eight days of review records (the handover that asked where the Codex week
went): a re-check of the same property after a fix came back `BROKEN` again **367 of 424 times**; the sixth or
later run of one property on one branch was 23% of all review input, 82% of it `BROKEN`; the `BROKEN` rate
rose with rounds, 70% on a branch's first diff to 82% past its tenth. The widest chases were docs-alignment
branches running "every claim this diff adds is true" for 14 to 31 rounds. Repro:

```bash
find "$SLOPWEAVER_HOME/orchestration" -maxdepth 2 -name record.json -newermt <start-date> ! -newermt "<end-date> 12:00" -print0 \
  | xargs -0 jq -c 'select(.scope.mode == "review" and (.outcome.answer.verdict? | IN("BROKEN", "CLEAN")))
      | {b: .tree.branch, p: .scope.property.id, d: .scope.diffSha256, t: .createdAtIso, v: .outcome.answer.verdict}' \
  | jq -s '[group_by([.b, .p])[] | sort_by(.t) | . as $r | range(1; length) as $i
      | select($r[$i - 1].v == "BROKEN" and $r[$i].d != $r[$i - 1].d) | $r[$i].v] | group_by(.) | map({(.[0]): length}) | add'
```

A late finding is not automatically noise — some are real, and finding defects is the reviewer's job. So when
the line prints, read the newest counterexample and pick one, on the merits:

- **Take it** — it names a state a user or the fleet can reach. Fix it before pass two; after it, name it a leftover.
- **Narrow the property** — it quantifies over something unbounded ("every claim", "every write", "anywhere
  in the response"), so each fix just moves the counterexample. Re-state it over the thing you actually
  changed, and over what the code CLAIMS: a verdict flipped `BROKEN` to `CLEAN` on unchanged code once
  "`selected` is never written" became "never CHANGED", because the code rewrites it byte-identically.
- **Stop, and write the residue into the code** — the property is inherently a HEURISTIC, and the newest
  counterexample needs someone to construct the input rather than a machine producing it by accident. Fifteen
  rounds on one pull request against `isClaudeWatchProcess` (`src/live/standing/processes.ts`), which matches a pid's
  argv, each produced a new true argv shape; the early rounds paid for nine real fixes, the tail for comments.
  Say in the code what it closes, what it does not, and which mechanism would. Past the second pass the
  finding is a leftover: land it with `--acknowledge codex-loop-incomplete --reason` saying why it is not a
  defect in this diff.

A rebase that moves the diff stales every review, and the pass after it is one of your two: rebase before the
second, and make the rebase one of its properties (the conflicted call site kept both sides).

- **Retire the wording** — `codex supersede`, with the reason on the record
  ([superseding-a-wording.md](superseding-a-wording.md)). The finding stays visible; only the floor stops
  counting it.

## Before and after the spend

What the budget is before a pass (`codex gauge`, `codex route`), what a pass actually cost, and how to notice
an account draining far faster than its own normal: [spend-and-burn.md](spend-and-burn.md).
