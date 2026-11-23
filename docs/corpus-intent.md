# What the owner wants from the corpus — harvested from the owner's own voice

A record of what the owner has actually said they want, paraphrased from months of the owner's voice
recordings. It exists because the corpus was half-baked and because seven
defect docs landed describing what the current code gets wrong — which is a different question from
whether the current code is the right shape at all. The owner asked for this explicitly, open to the answer
that half the code should be deleted.

**This is evidence, not a plan.** Every claim below is harvested from the owner's recordings. Where the owner changed
their mind, both positions are here with the later one marked. Where the owner was unsure, it stays unsure.

**The owner read this document and reacted to it by voice**, minutes after it
was published. That reaction answers four of the five calls in [§10](./corpus-intent/10-owner-calls.md), adds a first-class
requirement nothing here anticipated, and moves §1's context argument from sub-agents to sessions. It is harvested the same way as
everything else, in [§11](corpus-intent/11-owner-reaction-and-answers.md#11--the-owners-reaction-to-this-document--and-the-answers-to-10). Read [§11](./corpus-intent/11-owner-reaction-and-answers.md) before
acting on [§9](./corpus-intent/09-current-system-assessment.md) or [§10](./corpus-intent/10-owner-calls.md).

> **Retrieval is settled by the owner's ruling ([hard constraint 1a](constraints/hard.md#1a-retrieval-is-postgres-full-text-over-the-store-nothing-else)).** There are no embeddings, no
> vector index, no re-ranking or fusion, no recency multiplier and no locally-built lexical index. A question
> reads Postgres full text plus `pg_trgm` substring over the local Supabase store through `store read`/`store
cite`, and `store detect` plans a fan-out of visible Haiku detectives that investigate the way the owner does —
> pull a thread, follow where it leads — with `atlas probe` as the atlas leg. So the retrieval-ranking problem
> the chapters below weigh is dissolved, and Q1 and Q5 in [§10](./corpus-intent/10-owner-calls.md)/[§11](./corpus-intent/11-owner-reaction-and-answers.md)
> are moot: there is no encoder. What this document governs is SHAPE (Problem 2, the workflow chosen per
> question) and TRUST (Problem 3); its retrieval verdicts and the `ask` noun its tables name are the record
> of what the owner weighed, not the system.

- [How this was harvested](./corpus-intent/harvest-and-problem-boundaries.md)
  - [The three problems, kept apart](./corpus-intent/harvest-and-problem-boundaries.md#the-three-problems-kept-apart)
- [1 · What a tag should do, end to end](./corpus-intent/01-end-to-end-tag.md)
- [2 · What retrieval is for, versus live search](./corpus-intent/02-retrieval-vs-live-search.md)
- [3 · Freshness and recency weighting](./corpus-intent/03-freshness-and-recency.md)
- [4 · Citations, proof and refusing to be confidently wrong](./corpus-intent/04-citations-and-proof.md)
- [5 · Identity resolution](./corpus-intent/05-identity-resolution.md)
- [6 · What "good" looks like for the two named-person questions](./corpus-intent/06-named-person-quality-bar.md)
- [7 · Standing properties the shape has to satisfy](./corpus-intent/07-standing-properties.md)
- [8 · Where the owner was unsure — kept unsure](./corpus-intent/08-unresolved-questions.md)
- [9 · Holding the current system up against all of that](./corpus-intent/09-current-system-assessment.md)
- [10 · The calls only the owner can make](./corpus-intent/10-owner-calls.md)
  - [What this document is not](./corpus-intent/10-owner-calls.md#what-this-document-is-not)
- [11 · The owner's reaction to this document — and the answers to §10](./corpus-intent/11-owner-reaction-and-answers.md)
