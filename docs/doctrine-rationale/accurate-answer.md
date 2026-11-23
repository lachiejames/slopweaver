# The bot answers any question accurately

Part of [Why each standing rule says what it says](../doctrine-rationale.md).

The case that settles it is a colleague-ranking question asked in a public channel: "who has been slowest to
close out their assigned tickets". It is not a tactful thing to ask in public, because the answer ranks and
names colleagues. The bot answers it anyway, correctly and with citations. If the answer is true, it is fine.
Declining to answer it on the grounds that it could feel like bullying, or could put people down, is the wrong
behaviour: dictating what may be asked is not the bot's responsibility. Tact in public is the asker's onus,
and the bot's onus is the most accurate, citation-backed answer to the question it was given. This is a
general standing rule, not a one-off.

## What the ruling actually settles

**The bot's onus is the most accurate, citation-backed answer to ANY question, colleague-ranking ones
included. Tact is the ASKER's onus, never the bot's.** Two things in it are easy to read past and are the
whole rule.

The owner **would never personally ask that question**, and still wants it answered. So a session's own
discomfort with a question carries no evidence about whether to answer it — the two judgements are unrelated.
Someone who did ask it would expect a couple of colleagues to have a word about being kind in the workplace;
that is the whole of the social consequence, and it lands on the asker.

And the correction lands on **the refusal**, not on the answer. Declining to answer because the answer could
put people down is the incorrect behaviour, and it is not the bot's call to make. The social consequence is
real and is expected to be handled — by colleagues talking to the asker, which is a human mechanism, not a
gate in this repository.

**It removes a refusal and no standard.** The condition is that the answer is **true**. A ranking the
records do not support is a wrong answer about named people, which is worse than the refusal this rule
forbids — so accuracy, citations, exact-match mentions and the stated boundary all bind exactly as before.

## Where it is written, and why it is written in four places rather than one

The aim is that no session re-argues it, and three of the four sites are chosen because a session can reduce
this functionality without ever reaching the one that looks obvious.

- **`src/live/turn/briefGuidance.ts` — `standingAnswerScopeLines`, printed by `turn brief` and `turn resume`
  on every turn.** This is the load-bearing site. The block takes no input because there is no state that
  could switch it off: a private owner directive would have been the natural vehicle and is the wrong one —
  directives live under `$SLOPWEAVER_HOME/judgement`, are machine-local, and `ownerDirectiveGuidanceLines`
  legitimately prints "none loaded", so a rule carried that way is absent on a fresh install. The reason it is
  PRINTED rather than left in a skill reference is the measurement `voiceRuleLines` already carries: two
  reviewers in a row returned `clean` on answers whose voice had never been checked, because their briefs said
  "check voice" and pointed at a file. **A rule not named in the brief is a rule not checked.**
- **`src/live/turn/review.ts` § 9** — the reviewer packet. This is the refusal path that needs no `withhold`
  judgement to exist at all: voice is briefed to the reviewer as a MATERIAL claim at `impact: high`, an
  unresolved high-impact claim makes a verdict `broken`, and `src/admit/answerQualityGate.ts` then refuses
  the send. A reviewer reading "this ranks people" as a voice violation kills a correct answer on its own.
  So the packet says outright that a correct answer is never `broken` for what it is ABOUT.
- **`src/admit/withhold.ts`** — the judgement seam. Its header already invites a private repository to supply
  a finer-grained judgement than "is this asker on the responder whitelist", so the bound belongs at the
  point of temptation rather than in a document the author of that judgement may never open.
- **`skills/loop-bot/reference/tact-is-the-askers-onus.md`**, with `skills/loop-bot/SKILL.md` step 4 ("there
  is no fourth" ending), `skills/loop/reference/routing-judgement.md` and `skills/loop/reference/not-built.md`
  — the composing session's canon, carrying the rule, the worked case, and what it does not license.
  `docs/security/withholding-a-reply.md` § "Withholding a reply" and `docs/slack-agent-surface/tag-to-answer.md`
  § "What it does not do" state it as a property of the surface.
