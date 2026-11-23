# The three fixes, and the contract each one chose

Part of [Notion connector throughput — what made it slow, and what the fix actually changed](../notion-connector-throughput.md).

## 1 · Skip what bronze already holds, unchanged — before the expensive call

`corpus/notion/seenIndex.ts` streams every Notion bronze file once at the start of a crawl and builds
`page id → newest capture`. Both lanes consult it before any block fetch or comment read.

A skip requires **all three** of: an exact `last_edited_time` match; no `capture: "partial"` marker; and a
capture inside recorded coverage. Around that:

- **Pages and rows, never a data source.** A data source's own `last_edited_time` does not move when one of
  its rows is edited, so skipping a matched data source would silently skip every row change under it.
- **Both lanes share one decision.** A row the pages lane skipped is skipped by the databases lane too —
  otherwise a row edited between the two lanes (which run hours apart) would be re-written with properties
  and comments but no block body, looking like a complete capture at the newer timestamp.
- **A skipped item spends no `--fetch-cap` budget**, because it yields no record.
- **A complete capture carries no new attr**, so an unchanged page's fingerprint is byte-identical to what
  earlier runs wrote and the corpus does not churn.

`capture: "partial"` is written on every chunk of a capture that is not a complete, self-contained snapshot,
and refuses to authorise a skip. Four things set it, each of which was a way this could have gone silently
wrong:

1. a body cut short — the depth cap, the per-item request budget, or any recoverable read failure;
2. a merge whose two lanes read **different** `last_edited_time`s for the same object;
3. a body inlining content another object owns — `child_page`, `child_database`, `synced_block`.
   [notion-coverage.md](../notion-coverage.md) measures **51% of child pages as invisible to `search`**, so for
   half of them the parent's body is the corpus's only copy, and a child's edit does not move the parent's
   timestamp;
4. the legacy case, handled by coverage rather than by the marker.

**Coverage** (`corpus/notion/captureCoverage.ts`) exists because bronze written before the marker carries no
attr, so a capture truncated back then would have read as complete and frozen itself as permanent. A crawl
that completed, was **not capped**, hit **no transient gap**, and **fully enumerated** (no recoverable
`search` or `dataSources.query` failure) has re-captured everything from its own `since`; that `since` is
recorded, and an unmarked capture older than it is never trusted. Before the first qualifying crawl, nothing
is skipped at all. `--refetch-unchanged` forces the full re-walk regardless.

**What the skip trades, measured.** Notion does not advance `last_edited_time` when somebody adds a COMMENT,
so a skipped page's comments are not re-read until it is next edited. Re-fetching everything the index would
have skipped, over this window, produced 777 records — **2 of them comments**. A renamed page-mention target
likewise leaves a stale title in an unchanged page; the target keeps its own fresh record and the mention is
a curated edge, so nothing is lost, and marking every mention-carrying page unskippable would disable the
skip across most of a workspace. Both are stated trades, not oversights.

## 2 · Make the incremental write real in BOTH lanes

The pages lane flushes once per search page too. It holds back one class of item: a page whose raw parent
is a data source is a database-row _shadow_, which the databases lane will independently discover and merge.
A shadow and its merged form share one `sourceId` but carry different content, so flushing both would
re-open the page/row double-emit `reconcileRowDuplicates` exists to close. Those rows lose nothing — the
databases lane flushes them itself. Measured on arm C: 2,433 records reached disk before the closing write.

The sharper proof came from a kill rather than a success. A full-history run was killed 37 minutes in,
still inside the pages lane, and left **8,497 records across 159 objects (24.8MB)** on disk. Chunk 3 was
killed inside the same lane at 4.3 hours and left nothing at all.

One property of that is correct but costly, and is stated here rather than discovered later: a killed crawl
records **no** capture coverage, because coverage may only be claimed by a crawl that completed, was
uncapped, hit no gap and fully enumerated. So the content a killed run landed is kept, but the retry gets
no skip benefit from it and re-walks from the top.

## 3 · Fill the rate cap instead of waiting on latency

Both lanes keep 6 items in flight (`NOTION_ITEM_CONCURRENCY`). The cap is still the only thing deciding how
fast requests leave: every call passes the one ~3 req/s scheduler, which paces call starts globally; the
concurrency gives the scheduler something to hand out.

**The per-item bound counts requests, not wall clock.** Under concurrency a wall-clock bound is not a fixed
amount of work: six items sharing one cap each get about a sixth of the slots, so pages would truncate that
were fine alone. Scaling the minutes by the concurrency is worse in the other direction — an item running
while the other slots happen to be idle would be handed six times the requests, so a pathological page would
cost _more_ the quieter the crawl was. So the bound is **400 requests** by default (the measured equivalent of
five minutes at the single-flight ~1.4 req/s), invariant to both. That number and the depth cap live in
`src/corpus/notion/caps.ts`, because a whole re-pull has to be able to lift them — see **Lifting the caps** [below](lifted-caps-and-repull.md).

## Pathological items, and what is left

Two teamspace-root pages spend the whole 400-request budget on every run — 5.9 and 5.7 minutes of arm B's 21. **Those two pages are ~54% of the wall time of a run in which nothing had changed.** They are correctly
never skipped (a truncated capture must not authorise skipping its own repair), and they never converge
either: each run re-spends the budget and truncates in a slightly different place.

The open lever: **resume a giant page across runs** instead of restarting its block tree from the top each
time, so the budget is not spent re-walking what the last run already walked. (The data-source query is
bounded by `sorts` + a `TimestampFilter`, ceiling 4.)

## What a run reports, every time

Two note lines, emitted unconditionally so the next person does not have to instrument anything:

```
notion: throughput: N request(s) in Ts — R req/s achieved of 3 req/s cap (U%), K item(s) skipped as unchanged in bronze
notion: unchanged-index: M page(s) already in bronze were available to skip
```

Achieved rate against the configured cap is the number that made ceiling 3 visible. It was invisible before
precisely because the cap was assumed to be the answer.
