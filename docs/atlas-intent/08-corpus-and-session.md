# 8 · The atlas is DISTINCT from the corpus, and a SESSION routes between them

Part of [What an atlas must be](../atlas-intent.md).

The owner's ruling, reacting to the finding that nothing outside `src/atlas/` reads an atlas — one
command from being re-checked: `grep -rl atlasHomePaths src` returns `src/stateHome.ts` and
`src/atlasHome.ts` and nothing else. The atlas is distinct from the organisation's world model: some
questions route to one, some to the other, and some through both.

The owner's own worked example, in the same breath — and it is the test to apply, because it is a question whose
answer is a PERSON rather than a system's shape: asked for a colleague's top five pain points, nobody
expects the Cloudflare or Google Admin atlas to be invoked; that answer lives across meeting transcripts,
Notion, Slack and Linear.

And on wiring the two together: wiring an atlas such as JumpCloud's or Google Admin's into the world model
raises security questions, and mixes data sources in a way that may not even be useful.

Three consequences, each a rule rather than a note:

- **Never wire an atlas into the retrieval path.** An atlas record does not join `store read`/`store cite`'s ranked
  slice beside corpus records — that is precisely the mixing the owner questioned, on both a security and a
  usefulness ground. [The definition of done](../atlases/definition-of-done.md) carries the shape: _"an investigation reads the atlas to
  find out what is there, then reads the world model to find out what was decided about it"_ — two reads by
  one reader, never one index over both.
- **The router is a session's judgement, not a term match.** Per the owner's dynamic-planning steer, a
  spawned session looks at everything available and then plans what to do, and the plan is never final —
  it stays dynamic. `src/route/routingCapabilities.ts`
  is that shape and its own header says why it is deliberately not `buildSourcePlan`: it hands the
  judgement an inventory of what is reachable and matches nothing itself.
- **The owner's doubt runs wider than the atlas, and the bound the owner put on it is the useful half.** The
  owner extended it to the retrieval layer — the BM25 and semantic-search half of the world model — while
  ruling the corpus itself untouched: every corpus stays, and bronze, silver and gold can all stay. An owner
  ruling BANISHES BM25, embeddings, pgvector, re-ranking and semantic search: retrieval is
  local Postgres full text through `store read`/`store cite`. Nothing in either ruling licenses touching
  bronze, silver or gold.

**How a session routes TO an atlas, and the one thing this page does not settle.** Every registered platform
gets a row, because `src/route/atlasCapability.ts` DERIVES one from `atlasPlatforms()` rather than waiting
for somebody to hand-author it — a row somebody has to remember to write is a source that goes dark.
`src/route/genericCapabilities.ts` then authors a row for the platform whose question a derived sentence
cannot carry, and `saas-spend` is the worked example: it declares `sourceClass: "atlas"` on the trelica
platform, so `atlasPlatformOf` suppresses the derived row and the authored one takes its place. A derived
row's terms are built from the platform NAME alone, so a question that does not name the vendor never
reaches it — which is exactly what left a spend question with no leg to pick and a seat count to pick
instead (MEASURED; the row's own comment carries it).

Both halves report a generation's age the same way, and that is the part that must not drift: a row's
`freshness` says the generation is what the last sync published and that nothing schedules the next one, so
a reader states its age rather than implying live. What questions route to the atlas at all is the owner's ruling
and not this page's to revisit.
