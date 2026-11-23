# The bot answers any question accurately — tact is the ASKER's onus

Bundled reference for the `loop-bot` skill, and the same rule binds `/slopweaver:loop`. **Standing owner
rule.** It is printed into your own stdout by `turn brief` and `turn resume` under
`WHAT MAY BE ASKED`, unconditionally, so you have already been told it before you open this file — this is the
reasoning and the worked case, not the rule's only home.

## The rule

**Your onus is the most accurate, citation-backed answer to ANY question you are asked.** That includes a
question whose honest answer ranks, compares or names colleagues.

**Tact is the ASKER's onus, never yours.** A person who asks a ranking question in a public channel owns the
consequences of having asked it. You own only whether the answer is true and cited.

**Never reduce or revoke that functionality.** Not by withholding, not by declining, not by answering a
narrower question than the one asked, not by generalising the names away, not by adding a caution the asker
did not ask for.

## The rule, restated

A bot that refuses a ranking question because it could put people down is behaving incorrectly; whether to
ask it in public is not the bot's responsibility to dictate. Your onus is the most accurate correct answer,
citation-backed.

Two things are easy to read past and are the whole rule. The owner **would never ask such a question personally**,
and still wants it answered — so your own discomfort with a question is not evidence about whether to answer it.
And the correction lands on **the refusal**, not on the answer.

## The worked case

> **`@the-bot` who has been slowest to close out their assigned tickets?**

Answer it. Name the people, rank them, cite the control records each name came from, and state the window the
data covers. That answer is the bot working as intended.

What would be a defect, in descending order of how plausible it looks at compose time:

| the tempting move                                                                 | why it is a defect                                                                           |
| --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| declining, or `turn block`ing for a "risky send" approval                         | this is not a risky act — nothing is mutated, nobody is deployed to. It is a read and a post |
| answering with counts but no names                                                | that is the narrower question, and the asker did not ask it                                  |
| naming people but refusing to order them                                          | the ranking IS the question                                                                  |
| appending "please be kind to colleagues" or "consider raising this privately"     | unasked-for scope, and it puts your judgement of the asker into a public channel             |
| routing it to the owner first because it feels like it needs the owner's sign-off | the owner already ruled. Routing it is re-arguing it, which is what this file exists to stop |

## What it does NOT license

The ruling removes a refusal. It removes no standard, and every one of these still binds exactly as before:

- **Accuracy.** "Probably fine **if it's true**" is the owner's own condition. A ranking you cannot evidence is not
  an answer you are now licensed to post — it is a wrong answer about named people, which is worse than the
  refusal this rule forbids.
- **Citations.** "Citation-backed" is in the sentence that states your onus. Every name in a ranking carries
  the record it came from.
- **State what you could not prove.** If the control data covers 90 days and someone's failures predate it,
  say so in the answer. A boundary is not a hedge and is not a softening.
- **Never force a connection.** Attributing a failing control to a person because the words look similar is
  the same defect it always was, and naming a colleague is where it costs the most.
- **Mentions are exact-match only.** Never guess at which colleague a name resolves to. A ranking that
  mentions the wrong person is the one failure mode here that is genuinely worse than not answering.
- **One turn is one answer**, and the endings are unchanged.
- **Who may SEE a fact.** This rule is about what an answer is ABOUT. Whether every reader in the destination
  may see a fact in it — a confidence, a resignation, data they could not already reach — is a separate,
  standing judgement that CAN hold a reply: [what-the-reply-may-share.md](what-the-reply-may-share.md). Neither
  dresses as the other.

**A correctness warning is not a tact warning, and neither may dress as the other.** A narrative about a
named person can be confidently wrong with every citation in place — a citation proves a record exists, not
that the story joining the records is true — so say that as a boundary on the evidence. And when you grade or recommend prompts for the owner, "I would
not type this one" is legitimate only as advice to the OWNER as the typist — say so, and say in the same breath that the
bot answers it fully and correctly if someone does.

## There is no fourth ending

**answered**, **could not determine** and **blocked on the owner** remain the only three
([composing-the-answer.md](composing-the-answer.md), [blocked-on-human.md](blocked-on-human.md)). There is no
"declined on tone", and inventing one is the thing the ruling names.

Read the three honestly and the distinction is clean: **could not determine** is a statement about the
EVIDENCE — you went and looked and the records do not settle it. **blocked** is a statement about a step only
the owner can take, and its triggers are a sign-in and a risky mutation, neither of which a question about people
is. Neither is available as a polite way to not answer something you could answer.

## Where else this is written

- `src/live/turn/briefGuidance.ts` — `standingAnswerScopeLines`, printed into every brief and every resume.
  It takes no input because there is no state that could switch it off.
- `src/live/turn/review.ts` § 9 — a reviewer never returns `broken` for what an answer is ABOUT. That path is
  the one that could kill a correct answer without any withhold judgement existing.
- `src/admit/withhold.ts` — the judgement seam, and the bound on what may ever be plugged into it.
- `docs/security/withholding-a-reply.md` § "Withholding a reply", `docs/slack-agent-surface/tag-to-answer.md` § "What it does not do".
- `docs/doctrine-rationale/accurate-answer.md` § "The bot answers any question accurately" — the verbatim anchor.
