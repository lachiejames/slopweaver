# 7 · Standing properties the shape has to satisfy

Part of [What the owner wants from the corpus — harvested from the owner's own voice](../corpus-intent.md).

## Quality beats speed — with a stated ceiling

Speed is always secondary to quality. The owner would rather wait 30 minutes for an amazing answer than 47 seconds
for an okay one, because every tool gives okay answers quickly; the differentiator is amazing answers given
consistently, and people will wait for those. If proving something takes four hours, take the four hours: in the
owner's experience, a faster answer is often a less correct one, and taking longer correlates positively with
quality.

The ceiling: extra time is fine, but not a hundred times slower or a hundred times more expensive. There is a limit.

## Fail loudly. Never fall back silently.

Six weeks before the BM25-only defect was measured, the owner predicted its exact shape: remove the fallback path
and fail fast and loudly. AI tends to add fallback paths for safety, and the cost is that nothing can be trusted,
because a run looks as if it passed and did everything right while it took weeks to find out it did not.

Semantic search in particular must be done properly. The owner has hit several instances of it silently falling back
to BM25, and wants embeddings running and semantic search working over the corpus, with no BM25 fallback.

## Nothing lossy, ever

The 1,200-character cut is a bug to fix: a computer that read half of every file would fall apart quickly. Splitting
long records into pieces instead of cutting them off is how the owner always assumed it worked — break a record into
chunks and all the information is there, the meaning preserved.

Truncation makes information lossy, and acting on lossy information means acting on bad data. Nothing is dismissed
or truncated, because the whole point is to get all the information and then condense it and derive insights from
it.

## Progressive disclosure applies to the model's context, not just the human's screen

This is a distinct requirement and it is easy to miss. Claude is the working memory here, so the output is only as
good as what surfaces to it, and there is a ceiling: context limits, and the risk of polluting the window with data
that lowers answer quality. A large JSON copy of one Slack thread can consume 100,000 tokens when its essence, as it
pertains to the question, fits in about a thousand. The owner often asks for things explained in the owner's own
voice; the world model has to explain things to Claude in Claude's voice.

Every verb that pulls semantic-search results prunes them for progressive disclosure: PR links and titles, perhaps
the description truncated by default, with a real way for the agent to expand and see the rest — while making sure
no critical context is removed. A balance has to be struck.

Note the tension the owner names personally and does not resolve: no lossy truncation, _and_ no context pollution.
The resolution the owner gestures at is agent-driven expansion — a first pass that is deliberately small with a real
path to the whole record — not a smaller cap.

## Bronze is disposable; gold is the bill

The owner is willing to discard the entire corpus and build a new one from scratch if the data is beyond repair, and
has deliberately not spent heavily on tokens because mistakes that force a redo are expected. Bronze has cost no
money so far, so avoiding a corpus rebuild is never a design constraint: it would be an artificial constraint that
might prevent reaching the best solution, and the path matters less than the best solution.

Gold is the only thing that should cost tokens. It is spent at scale only once it is proven on a small subset, and it
has not been proven there yet.

Being on the max plan has materially weakened the cost objection: cost can largely, though not totally, be ignored.
The _ordering_ argument (prove it small before you pay big) is untouched; only the price is.

## More data raises the ceiling

The more data available, the higher the ceiling on how smart this can get — a point the owner makes repeatedly.

Consequence for bronze, stated as a rule: keep all the raw data and every field in the bronze corpus, to minimise the
risk of ever having to bin it and re-download everything because something was projected away.

## A multi-hour first build is expected, not a defect

A one-off multi-hour index build is acceptable; it is how the owner imagined onboarding. Six hours of initial
indexing is fine: connect the integrations, pull data from each, index it, show a progress indicator and the messages
as they are processed, then show the learnings at the end, so the user gets confirmation it learned interesting,
insightful things that make it a differentiator.

What the owner pictured is a finished state — three months of Linear, Slack, GitHub and Notion indexed, embedded,
queryable in a vector space with a re-ranker in front — rather than the observed behaviour of building the index
just in time on the first retrieval.

## The evaluation harness is the thing the owner keeps calling the unlock

Empirical evidence from an evaluation harness is the best way to answer the open design questions. v0.2 is about the
evaluation harness; v0.3 introduces combinations of models, re-ranking and semantic search. No step further until the
harness exists.

And the constraint on it — this is the part most likely to be got wrong: an AI left to judge what good is, with the
humans taken out of alignment and review, ends up with something that does not match the owner's taste. Human time
goes in up front to define what good looks like, because what people think good looks like and what the AI thinks it
looks like are not the same. The best feedback is a case where the system failed empirically, contrasted with what
the humans who matter say a golden answer looks like.

The owner is also alert to the harness being gamed: how do you reach the golden answer faithfully, without bias,
when benchmarks such as ARC-AGI exist because AIs are good at cheating a benchmark whose questions they can
anticipate? **And in this case, the system has a heads up on what the questions might be.**

## The small-corpus / large-corpus tension the owner never resolved

Recorded because it is a real, live, unanswered design question and it keeps costing the owner weeks:

- A smaller sample gives a faster feedback loop — but small data sets are exactly where bugs hid until a very large
  data set exposed them. There must be a middle ground.
- Something minimal may be the right start: one day of data from one platform, answering a question about it, with
  semantic search, BM25 and re-ranking all running over that day.
- It remains unknown whether a three-month ingestion will perform badly even though the small one-off tests
  performed well.

---
