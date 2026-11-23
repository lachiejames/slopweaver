# The correction block — where the owner corrects what the fleet thinks the owner believes

The block [the briefing shape](fleet-briefing-shape.md) names, in full: a correction block below react-now, where each
belief takes right, wrong or partly in a single click.

## What it renders

`<h2 id="owner-beliefs">what I think you believe</h2>`, a contract line the RENDERER owns, and one `.belief`
row per proposed belief of the owner's that is still waiting on a mark:

- **Above the fold**: the claim as the reviewing session composed it, the domain, and the proposal id as
  `<code>`. The id is there because it is what the owner SAYS BACK — "the second one, wrong" stops meaning anything
  the moment the block re-renders in a different order.
- **Beside it**: `A right · B wrong · C partly`, all three, every row. `partly` is the arm that carries the owner's
  own wording, so a row missing it loses the correction rather than just an option.
- **Folded**: the owner's own words the claim was read from, how firmly they showed the owner held it, which unit they came
  from, and whether that unit was WRAPPED — a turn file a supervisor wrote around the owner's words, so the quote is
  in the record rather than proven to be the owner's. Asking the owner to correct a belief read out of the fleet's own
  prose without saying so would be asking the owner to ratify it.

Empty is a real, honest state — every proposal answered, or none made yet — and the block does not render at
all. `notShown` states how many open proposals this page is not showing, so it never reads as everything.

## It is PROJECTED, and a form that writes it is refused

`slopweaver briefing render --owner-beliefs` reads `$SLOPWEAVER_HOME/knowledge/proposals.jsonl` and projects
its open rows. A form carrying `ownerBeliefs` is refused, because this block asks the owner to judge whether the
fleet read the owner's own knowledge correctly: a supervisor free to retype a claim would be free to put words in
the fleet's mouth and then collect the owner's mark on them, which makes the answer worthless as a record.

A BOOLEAN flag rather than a path, unlike `--your-list` and `--open-artifacts`, because the queue is durable
state any session can read rather than a document one sweep produced.

## How the owner's answer gets back

The owner tells the supervisor the id and the letter, the way the owner answers everything else on this page — the
briefing is published HTML and cannot call back. A visible session then records it:

```bash
slopweaver knowledge answer <proposal-id> --mark right|wrong|partly --why "<the owner's words>" \
  [--correction "<the owner's wording>"]
```

**A mark is the owner's REACTION, not a verdict.** `right` says the fleet read the owner's knowledge correctly; it does not
say the claim is true, and nothing maps one onto the other. The owner can be right that they believed something and
the belief still be false — the most interesting row the register can hold. So `knowledge answer` writes no
register row; `knowledge record --learner owner` is the explicit second step, and it owes a verdict and
evidence that was observed. [The knowledge skill](../../knowledge/SKILL.md) carries the rest.

## The quiz, directly under it

**Every sweep cuts one and renders it** (the quiz is on): `slopweaver knowledge
quiz --sweep <tick-id>` first, then the render flags below. A sweep that skips either is the quiz off.

The same page carries ONE quiz question per sweep, projected by
`briefing render --knowledge-quiz --sweep <tick-id>` and refused the same way when a form writes it. It runs
the OPPOSITE way to this block: a claim the fleet learned the hard way, asked as a question with the fleet's
own answer folded, so a belief the owner never thought to state is still reachable. The whole contract, the
selection rule and why it grades nothing: [the quiz](../../knowledge/reference/quiz.md).
