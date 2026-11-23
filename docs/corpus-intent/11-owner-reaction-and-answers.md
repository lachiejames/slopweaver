# 11 · The owner's reaction to this document — and the answers to §10

Part of [What the owner wants from the corpus — harvested from the owner's own voice](../corpus-intent.md).

The owner read this document end to end and reacted to it by voice, minutes after it was published. That reaction is
the anchor for everything in this section, harvested the same way as the rest: names redacted, and stated here as
the requirements it carries.

It also settles something [§9](09-current-system-assessment.md) could only assert. Several verdicts there were arguments from the owner's
older words; here the owner reacts to those verdicts directly.

## The tier definitions — the owner's own, and the reason Q3 could not be answered

Recorded first because [§9](09-current-system-assessment.md) and [§10](10-owner-calls.md) both depend on them, and because the absence of them is what made one
question unanswerable. The owner pictures one warehouse folder:

- **Bronze** holds all the raw JSON snapshots from the Slack API, the GitHub API and the rest.
- **Silver** derives information from all of that — the names, the identities, the channels.
- **Gold** is a step above: based on everything seen, here is this person and what they are working on, what they
  get blocked on, what someone else does, and the recurring blockers between teams. Those are the insights an org
  world model is hoped to give.

## The five calls, answered

|        | Call                                            | Answer                                                     |
| ------ | ----------------------------------------------- | ---------------------------------------------------------- |
| **Q1** | Semantic leg the default once the index exists? | **Moot — the retrieval ruling; there is no semantic leg**  |
| **Q2** | A source, or a pipeline?                        | **A source, consulted then verified**                      |
| **Q3** | Golden set to the work corpus?                  | **Not answered — the question did not land**               |
| **Q4** | What a good named-person answer contains?       | **Answered with a real example**                           |
| **Q5** | Local-only embedding absolute?                  | **Moot — the retrieval ruling deleted embedding entirely** |

**Q1 — moot under the retrieval ruling
([hard constraint 1a](../constraints/hard.md#1a-retrieval-is-postgres-full-text-over-the-store-nothing-else)); two
demands in the owner's answer stand.** Absence is a refusal, not a degraded answer (the strict reading of the owner's
fail-fast, fail-loudly ruling): the bot refuses to answer when what it needs is not set up. And just-in-time refresh
keeps it current, because people asking the bot often want to know what happened in the last 24 hours.

The owner then opens a question the reset has to answer rather than assume — what JIT does to the LLM-derived tier.
A just-in-time refresh of bronze can re-derive silver, but gold is the tier that makes LLM calls, and how gold's
picture is kept current under refresh is something **the owner does not yet know**. The owner's lean, explicitly a
lean: build a gold baseline and let a feedback ledger shape answers on top of it, rather than re-golding on every
change. The owner also needs to see gold records personally before settling it.

**Q2 — a source, and the verification step is the part that matters.** It could be both, but the question is hard to
answer having never seen the corpus perform well. It is one tool in the toolkit: the agent uses it, leans on it and
consults it — and never takes it at face value. It checks and verifies. The world model is one source, one thing
the agent can query.

The concrete shape of that verification: a few searches against the corpus, then the sanctioned verbs to read the
real thing. The corpus surfaces a Notion doc that seems to be about the ask; the agent pulls that entire doc with the
Slopweaver verb; the doc links to other docs with context, so the agent crawls those too. The owner's reason: rag
does not work like that, and the agent cannot work like that with rag as its tool.

So [§9](09-current-system-assessment.md)'s "no live-search leg" verdict is confirmed, and Phase B of the reset is a fix-with-planning rather
than a re-shape — `route plan` is the thing to extend.

**Q3 — not answered, and this document caused that.** The owner did not recognise the term, read "golden set" as the
gold tier, and could not recall how bronze, silver and gold related to evaluation. The owner heard the **gold tier**
and answered by explaining the tiers (above), never returning to the evaluation question. **Q3 is therefore still
open**, and the fix is this document's, not the owner's: "golden set" means the _evaluation_ set — human-written
answers to real questions, used to measure retrieval — and it collides with the gold tier by name only. Re-ask it
with that word replaced.

**Q4 — the bar is a real answer that already exists.** The first question V1 was ever asked, about the sales team's
top five friction points. Five named items, each cited into a specific thread and channel, plus an honest
evidence-strength line. The owner knows it was good because the asker said so.

The link is in the reset handover doc rather than here — it is a private workspace permalink, so it is
content under [the partition](../constraints/partition.md). The part that belongs here is the warning
attached to it: **V1 used no world model at all** — no org world model, no semantic search, just Claude and
perhaps a few verbs. So the bar was cleared once by live search alone, and the corpus has to **add** to that rather
than replace it.

**Q5 — local-only for now, and the zero-key claim is already softer than stated.** Local only for now: make it
actually good first, and perhaps later run an experiment with a hosted embeddings platform. The owner likes the
zero-key claim, but notes it is not really zero-key while it depends on the Linear API key. With one good answer
from the org world model still not achieved, it is far too early to look at a different provider, especially one
that costs money.

## New: feedback ingestion is a first-class requirement

This is the largest thing in the reaction that was **not** in [§1](01-end-to-end-tag.md)–[§9](09-current-system-assessment.md), and the owner names it as the mechanism that
made the Datadog work good in the first place: **feedback** — the owner talking to the bot, saying whenever it did
something unwanted or went off track. Feedback ingestion has to be first class.

The demand is specific and it constrains retrieval, not just process — the feedback must **outrank** the derived
tiers at query time. When the bot is asked a question, the feedback has to be prominent in what it looks up: if a
search through gold and silver yields an answer that directly contradicts the feedback, the bot **makes the same
mistake a second time in public**.

And the owner names the existing thing to copy, plus an open question about where it lives: the Datadog side has a
store of gotchas, the unintuitive and easy-to-get-wrong things. Where is that for the org world model — a platinum
tier beyond gold, or a separate data store?

The owner works the demo case through concretely: the bot answers a named-person question, the person says three
items are right and two are wrong, and that information needs a way back into the bot. Left open, deliberately:
whether that store is a fourth tier or a sibling.

## Sharpened: recency is one input, not the function

[§3](03-freshness-and-recency.md) recorded recency as a ranking rule plus a staleness rule. The owner adds a third thing — importance can beat
recency outright. Of two conversations with a manager, the more recent one should usually be more front of mind,
**but that is not a hard rule**: something said in the older one can matter more — a formal warning, say — and stay
more prominent because the information is weighted more highly. **Time is one input, but the weighting function has
several.**

No score multiplier supplies any of these inputs (the retrieval ruling); weighing them is the reading agent's
judgement.

## The atlas, in the analogy the owner actually wants used

The owner rejects "atlas" as the word while keeping the idea, and the replacement framing is worth having because
it states what the capability is for. A complex Datadog investigation today feels like an explorer stepping into a
large world of mountains and rocks where things hide everywhere, overwhelmed by the information. The **reach**
approach is different: **an explorer who has already explored the whole world** steps back into it already knowing
what hides under the rocks. **Things change over time — check again, verify, don't assume**: a tree that used to be
there may have fallen, but most of the seasoned explorer's model of the world is still intact.

## The planning phase, and what "dynamic workflow" does and does not mean

The owner confirms [§1](01-end-to-end-tag.md)'s central claim and then draws a distinction the reset must not lose. A human decides early how much
effort a problem deserves and how to go about it. **Today there is a fixed pipeline**, so two questions that should
need very different amounts of effort get the same pipeline.

The owner's worked example of the heavy tier is the months-long connection-pool problem: decide early that it
is hard, fan out one agent per aspect, consolidate, possibly a second fan-out for what is still open, and
adversarially verify every claim before posting. The owner's worked example of the light tier is the question
of who owns this area of the code base — someone reads the one source of truth and answers.

**The distinction:** the owner likes the phrase _dynamic workflow_ for the planning step, and says plainly it
is not Claude Code's Workflow tool — that is many agents inside one session, whereas the owner means deciding
steps, order and parallelism **before** sessions are spawned. One behaviour the owner does want copied from it: a
dynamic workflow sometimes decides mid-run that more work needs to happen. And the standing caution: not every
question deserves the big pipeline, so the easier problems are never overcooked.

## On the harness, confirmed for this surface

If the bot is tagged in Slack with a named-person question such as a leader's top five pain points and would come
back with an answer as poor as the earlier trial's, **the harness must not let it send that slop.**

And on who grades: mechanisms already exist to stop agents grading their own homework. [§9](09-current-system-assessment.md)'s
"no stop-gate on answer quality" verdict stands, and the existing Datadog-side machinery is the thing to extend.
