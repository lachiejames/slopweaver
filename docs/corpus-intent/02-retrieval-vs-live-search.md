# 2 · What retrieval is for, versus live search

Part of [What the owner wants from the corpus — harvested from the owner's own voice](../corpus-intent.md).

## The corpus is one tool, not the answer

Answering a question uses the corpus as one tool in the toolkit: it finds a set of relevant places to look, and then
the AI goes and looks at those places. The idea is to **combine** retrieval with asking Claude directly.

## The split the owner has ruled on repeatedly: history vs now

This is the clearest and most-repeated line the owner draws, and it has held throughout.

- The org world model's bronze is for historical questions. A question about what is happening now needs live data,
  and the same may hold for SDLC metrics.
- Live Slack work **reads live Slack**. The corpus is there for the org world model; a live Slack feature should not
  even consider it.
- Reading a thread by link is usually the owner pasting a thread and asking for a summary or a draft reply. Corpus
  refresh serves the org world model; this is a separate use.
- Bronze and silver serve the org world model's corpus search; reading a Slack thread is a live use case.

## Atlases are the other half of "reach", and the owner rates them above the corpus

The atlas idea arrives and does not go away:

- Taking all of a platform's ground-truth data, such as Datadog's, and storing it locally in a deterministic,
  coherent, provable and falsifiable form, then connecting it to a very capable AI, can turn **unknown unknowns into
  known unknowns and then maybe known knowns**.
- An atlas gives the AI the human's view — what a person sees in Slack — and comparing that with what the API shows
  reveals unknown unknowns.
- On the Vanta atlas: find everything you will ever need, and **reveal all the unknown unknowns in one pass**.

## The mind-change worth naming: for a stretch the owner wanted the corpus OUT of the live answer path

This is the single most important reversal in the harvest, and it is why "is the current code even the
right shape" is a live question rather than a rhetorical one. In order:

1. The org world model could be useful and important, but not the most important thing; if it was not already
   working, **put a pin in it**.
2. It felt separate from the work in hand, so **maybe a pause on the org world model**.
3. Every attempt to use it got blocked trying to ingest and index around 500,000 records at once.
4. The owner cared less about the org world model than about tagging the bot in Slack and getting a decent answer —
   and asking it for the owner's open PRs went only through the org world model, which the owner did not like.
5. **The owner did not want answers going through the corpus** for now; it was more trouble than it was worth, and
   the owner wanted the setup rewired so most things no longer went through it.
6. Much of the org world model could go, because it was only hindering.
7. Expanded, its steps claimed to load the world model and retrieve and rank evidence — none of which it was doing.
8. **Back to it, deliberately**: organisational intelligence is something more people are likely to be interested
   in, especially for the proposal.

**How to read that.** The owner never said the world model was a bad idea. The owner said a world model that
intercepts every question and answers them all badly is worse than not having one — and the fix the owner reached
for each time was routing, not deletion. The return is not a contradiction of the pause; it is the same
judgment with a reason to pay the cost now.

---
