# 10 · The calls only the owner can make

Part of [What the owner wants from the corpus — harvested from the owner's own voice](../corpus-intent.md).

Ordered by how much downstream work each unblocks. Each is a genuine fork, not a request for approval.

> **ANSWERED**, except Q3. The owner worked through all five in one voice reaction; the answers, with what each one
> settles and what it leaves open, are in [§11](11-owner-reaction-and-answers.md#the-five-calls-answered). **Q3 is
> still open** — the term "golden set" did not land, and that is this document's defect rather than the owner's. The
> questions below are kept as originally put, because [§11](11-owner-reaction-and-answers.md) is a reaction to this
> exact wording.

1. **Does the semantic leg become the default again once the index exists? — MOOT under the retrieval ruling.** The
   owner's doctrine says yes (quality > speed; no silent fallback). `constraints/hard.md` §1's relaxation says no, on
   a measurement taken against the wrong corpus. One of the two has to move, and the relaxation is a documented,
   owned decision — so it is the owner's to reverse, not a session's.

2. **Is the corpus a source the agent consults, or a pipeline the question flows through?**
   Everything in [§1](01-end-to-end-tag.md) and [§2](02-retrieval-vs-live-search.md) above says "a source". The code says "a pipeline". Answering this decides
   whether the retrieval work is a fix or a re-shape, and it is the fork the whole reset hangs on.

3. **Does the golden set move to the work corpus?** It means the eval can no longer be public or committed
   in the same way, and it means the five dogfood questions become the benchmark. Without this, no
   retrieval decision after today can be evidence-backed for the corpus that matters.

4. **What does a good "a leader's top five pain points" answer actually contain?** Nobody has written it
   down. The owner's own bar — an answer is especially good when the asker already knows in advance what a
   high-quality answer would be — implies asking the person the question is about, which is a people step, not an
   engineering one.

5. **Does local-only embedding stay absolute? — MOOT under the retrieval ruling.** The owner had twice raised
   Voyage/Cohere as a real quality question and twice noted it collides with the zero-key claim. The ruling
   ([hard constraint 1a](../constraints/hard.md#1a-retrieval-is-postgres-full-text-over-the-store-nothing-else))
   removes the subject: there is no embedding step anywhere, hosted or local.

---

## What this document is not

It is not a plan and it does not sequence anything. The successor —
`org-world-model-retrieval-reset` — is the doc that turns the [§9](09-current-system-assessment.md) verdicts and the §10 answers into work.

It also does not touch Problem 1, which the owner's retrieval ruling dissolves: there is no vector index to build.

---
