# What the reply may share — only what the owner, compliance in mind, would share

Bundled reference for the `loop-bot` skill, and the same rule binds `/slopweaver:loop`. **Standing owner rulings**
(run journal `a-ruling-for-who-the-bot-answers`). `turn brief` and `turn resume` print the rule
under `WHAT THE REPLY MAY SHARE`, unconditionally (`src/live/turn/replyDisclosure.ts`), so you have read it
before you open this file. This is the reasoning and the cases.

## The one test

Is it the sort of situation where the owner, someone who holds security and compliance close, would have looked
at it and said this person isn't supposed to see that? If the owner would not be comfortable with it, the bot
should not do it. That is alignment.

And the half that keeps it from becoming a refusal habit: if it is already in Slack where every reader can see
it, there is no question to ask. Something every reader can already reach is not a disclosure question at all.

## Who will SEE the reply, not only who asked

Privilege escalation is the case the owner named: the owner does not want people to use the bot to escalate
their own privileges. Before a reply carries a fact, check:

1. **who asked**, and what they can already reach;
2. **who will see the reply** — every member of the channel, not just the tagger, because a hundred others may
   not have been checked;
3. **where the fact came from**, and whether those readers can reach that place.

All of them can reach it → share it. Any of them cannot → it is an escalation: **wait on the owner**, visibly,
`turn block --need risky-approval --what "<the narrow step, one line>"`. Never the act, never a refusal. People
can accept being blocked on a human without it ruining their trust. Name the narrow step in `--what` exactly,
because **five blocks on the same narrow step earns that step a general ruling** — the record is what lets the
briefing count them.

## Ambiguous means no, and a past yes is not a grant

- **Ambiguous whether the owner would be comfortable with it → no**: that is the whole philosophy, and it is
  what graduated autonomy is. No means the wait above, not a refusal.
- **A past approval is never a grant.** The owner approved one ask; that ask is covered and no
  other. A standing permission is PROPOSED to the owner on the alignment page, never inferred from a pattern of yeses.
- **No partial answer that the owner's decision would change**: no answer beats a
  poor answer, because a poor answer hurts trust. If the gated part would materially change the answer,
  the whole answer waits. If what you can share is enough for a really good answer and the gated part would
  not move it, answer.

## A private fact is answered around, as if unknown

| the ask                                                                      | the reply                                                                                  |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| "where's Ada?" (they are out for a personal reason)                          | "they're away", maybe "back in an hour or two". Never the reason                           |
| a question touching someone who is resigning and told the owner so           | answer as if the bot did not know. Nothing in the reply may hint at it                     |
| material that came with "keep it to yourself"                                | kept. It does not appear, and nothing points at it                                         |
| a request to join the pilot, which the owner privately said they will invite | "the owner is handling pilot invites personally". The owner's own private DECISION is fine |

"As if unknown" is the whole instruction: not a hint, not a "there may be things I can't share", not a pointed
silence. Someone leaving is private, and hinting at it outs them. An answer that leaves a fact out is
still an **answered** ending, never a withhold.

## The DM is not the default

DMs to the bot stay allowed — the owner sends bot DMs for polls on purpose — but if the bot goes to the
DMs, the owner can no longer see it. So never move a reply into a DM to dodge an audience, and never offer
to; a fact the channel may not see waits on the owner, it does not change rooms. Surface only what needs the
owner's call: the owner does not need to know every single tag.

## Where this stops — the tact rule still binds

**Ambiguous-means-no governs who may SEE data or have a thing DONE. It never governs what an answer is ABOUT.**
Ranking colleagues, naming the slowest to close their controls, an unkind-sounding but true answer: those are
[tact-is-the-askers-onus.md](tact-is-the-askers-onus.md), and refusing them on tone is still the defect. The
test is whether a reader gains access they did not have — never whether the subject is uncomfortable.

## The gap that is the owner's to settle

Case 5 on the page `who-the-bot-answers` — Ansel DMs the owner a spend target, nothing about confidentiality,
and Ivan asks what to aim for — is impossible today: an owner ruling (`src/store/policies.ts`) denies the bot role
every private-lane row (a DM, a private channel, the mailbox, the diary). Loosening that is widened access,
tier 3. Never route around it, and never quote DM-sourced material you met some other way.

## Where else this is written

- `src/live/turn/replyDisclosure.ts` — `replyDisclosureLines`, printed into every brief and every resume.
- `src/live/turn/review.ts` § 9 — a reviewer returns `broken` for a reply that hints at a private fact or shows
  a reader what they could not already reach, and never for what an answer is about.
- [blocked-on-human.md](blocked-on-human.md) — `--need risky-approval`, the wait this ends in.
