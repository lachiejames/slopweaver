# Design constraints

The rules any change to Slopweaver is designed against — what is fixed, what has been deliberately relaxed,
and what merely _looks_ fixed because that is how the code happens to work today.

This file exists because the same questions kept being re-argued from first principles at the start of every
planning session, and because a planner mistook an implementation detail for a requirement at least once (see
[Not constraints](constraints/not-constraints.md)). Read it before proposing an architecture. If a constraint here is wrong,
change it here first — do not route around it in a PR.

- [Hard constraints](./constraints/hard.md)
  - [1. Answer quality beats speed. Always.](./constraints/hard.md#1-answer-quality-beats-speed-always)
  - [1a. Retrieval is Postgres full text over the store. Nothing else.](./constraints/hard.md#1a-retrieval-is-postgres-full-text-over-the-store-nothing-else)
  - [2. Nothing is silently degraded](./constraints/hard.md#2-nothing-is-silently-degraded)
  - [3. No content is silently dropped from what gets indexed](./constraints/hard.md#3-no-content-is-silently-dropped-from-what-gets-indexed)
  - [4. `refresh` is the only writer into bronze — with one targeted exception](./constraints/hard.md#4-refresh-is-the-only-writer-into-bronze--with-one-targeted-exception)
  - [4a. A lane scanned off a local tree is not rebuildable until survival says so](./constraints/hard.md#4a-a-lane-scanned-off-a-local-tree-is-not-rebuildable-until-survival-says-so)
  - [5. Search runs in your own Postgres. No hosted search or embedding API.](./constraints/hard.md#5-search-runs-in-your-own-postgres-no-hosted-search-or-embedding-api)
  - [6. Corpus data does not leave the machine](./constraints/hard.md#6-corpus-data-does-not-leave-the-machine)
  - [7. Designed for 10–100× the current corpus](./constraints/7-9.md)
    - [8. Long-running work is observable](./constraints/7-9.md#8-long-running-work-is-observable)
    - [9. The house code standards hold](./constraints/7-9.md#9-the-house-code-standards-hold)
- [What the corpus may refuse to hold](./constraints/refusals.md)
- [The partition](./constraints/partition.md)
- [Deliberately relaxed](./constraints/relaxed.md)
  - [Porting from a private source — the design, never the code](./constraints/relaxed.md#porting-from-a-private-source--the-design-never-the-code)
  - [The old remote is dead](./constraints/relaxed.md#the-old-remote-is-dead)
  - [Platform: a colleague's managed work MacBook](./constraints/relaxed.md#platform-a-colleagues-managed-work-macbook)
  - [Token spend is not a per-verb question](./constraints/relaxed.md#token-spend-is-not-a-per-verb-question)
  - [10. A provider's per-QUERY cost ceiling is a design constraint, not a tuning knob](./constraints/relaxed.md#10-a-providers-per-query-cost-ceiling-is-a-design-constraint-not-a-tuning-knob)
- [Not constraints](./constraints/not-constraints.md)
- [Coupled claims](./constraints/coupled-claims.md)
