# 3 · Freshness and recency weighting

Part of [What the owner wants from the corpus — harvested from the owner's own voice](../corpus-intent.md).

## The rule

**Newer material is weighted higher than older material.** The owner has said it in several forms:

- Recent things are usually more important; that is how people's minds work. Over a 30-day window, something from
  28 days ago should not outrank something from two days ago, **because minds do not work like that** — the most
  recent conversations are what people are thinking about and what their current world model reflects.
- Prefer what happened very recently over what is older, just as people care about what is happening today and what
  happened yesterday.
- Retrieval runs with a **recency bias and time decay**.

## Recency is not only a ranking preference — it is a correctness property

Time is one input among several, and importance can outrank it outright
([§11](11-owner-reaction-and-answers.md#sharpened-recency-is-one-input-not-the-function)).

The subtlety is the one an implementation is most likely to lose. A long-serving colleague has many thousands of Slack messages
and has surely raised pain points among them, but some may have been raised long ago and no longer be true, **in
which case it is correct not to name stale information**.

So an old record that would have been a good answer six months ago is not a good answer now. Down-ranking
it is right; citing it as current is wrong. These are different behaviours and the owner wants both.

## Importance is not length, and not recency either

A Slack message can matter enormously at 200 characters. If the founder posts that the company is abandoning its
business for a completely different one, that message should rank very high — it is what people's minds would
notice and weight above some random Notion doc, however much longer the doc is. Things have to be weighted the way a
mind weights them.

Raised there as a concern about chunking: a record split into 50 chunks gets 50 chances to score, a
one-line Slack message gets one. The owner accepts the framing and does not resolve it.

## Records store "now", and the owner is broadly fine with that

Storing what a ticket says now rather than what it said last month is fine; what it says now is what matters more.
The owner then immediately second-guessed it: the full activity history of each issue would carry far more granular
data, and possibly more junk, and would then need **ranking how the issue looks today over how it used to look** —
whether that helps this data set or hurts it is unknown.

Unresolved. Recorded as unresolved.

---
