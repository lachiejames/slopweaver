# The freshness contract for derived state

Every artefact in this system that is DERIVED from a source — silver from bronze, a registration from a path
on disk, a checkout from its upstream, a board verdict from its probes — can go stale, and this contract is how
each one says so: it records what the source held when it was built, so a consumer tells "stale" from "fine"
cheaply.

This document is the rule set, the on-disk format, and the per-consumer table of who refreshes and who
refuses. The pure half lives in [`src/silver/derive/freshness.ts`](../src/silver/derive/freshness.ts); the
effectful half in [`src/silver/derive/stamp.ts`](../src/silver/derive/stamp.ts).

- [What went wrong, measured](./freshness-contract/rules-and-stamps.md)
  - [The five rules](./freshness-contract/rules-and-stamps.md#the-five-rules)
  - [The stamp format](./freshness-contract/rules-and-stamps.md#the-stamp-format)
  - [Every source is WITNESSED; only some are COMPARED](./freshness-contract/rules-and-stamps.md#every-source-is-witnessed-only-some-are-compared)
  - [Why bytes and a cursor, and not an mtime](./freshness-contract/rules-and-stamps.md#why-bytes-and-a-cursor-and-not-an-mtime)
- [Which consumer does which](./freshness-contract/consumers.md)
  - [Bronze freshness: who refuses, who does not, and what keeps it current](./freshness-contract/consumers.md#bronze-freshness-who-refuses-who-does-not-and-what-keeps-it-current)
  - [The just-in-time gate: when a question WAITS rather than answering or refusing](./freshness-contract/consumers.md#the-just-in-time-gate-when-a-question-waits-rather-than-answering-or-refusing)
  - [The one row deliberately NOT converted to a refusal](./freshness-contract/consumers.md#the-one-row-deliberately-not-converted-to-a-refusal)
- [The atlas rolling window](./freshness-contract/atlases-and-rosters.md)
  - [The window is per atlas, and four hours is the default the owner set](./freshness-contract/atlases-and-rosters.md#the-window-is-per-atlas-and-four-hours-is-the-default-the-owner-set)
  - [A bounded live read counts as fresh](./freshness-contract/atlases-and-rosters.md#a-bounded-live-read-counts-as-fresh)
  - [Who runs the window](./freshness-contract/atlases-and-rosters.md#who-runs-the-window)
  - [Every atlas and every corpus source is REGISTERED, not written by hand](./freshness-contract/atlases-and-rosters.md#every-atlas-and-every-corpus-source-is-registered-not-written-by-hand)
  - [The page that says whether the schedule is keeping up](./freshness-contract/atlases-and-rosters.md#the-page-that-says-whether-the-schedule-is-keeping-up)
  - [Who actually ticks it](./freshness-contract/atlases-and-rosters.md#who-actually-ticks-it)
  - [Member rosters stay in sync, and are visible when they do not](./freshness-contract/atlases-and-rosters.md#member-rosters-stay-in-sync-and-are-visible-when-they-do-not)
