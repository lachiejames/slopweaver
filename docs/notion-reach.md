# Notion reach — the grant-delta contract

Notion coverage is bounded by an external grant: the integration only ever sees the pages and databases
someone has shared with it, and that grant widens over time as more of a workspace gets connected. **A
normal refresh cannot see that widening on its own.** `src/corpus/notion/fetch.ts`'s pages/databases lanes
page `search` newest-first and stop at the first hit older than `since` (Notion `search` has no
server-side date filter), so a page the integration was just granted but that was last edited long ago sits
below every incremental window and is never reached — however many refreshes run afterward. One widened
grant needed hand-picked `--since` chunks to surface it (`handovers/notion-bronze-expansion-after-access-grant.md`):
a human noticed the gap; the tool did not.

**Reach** is this file's name for the fix: on every refresh, before the incremental pass runs, the connector
asks a separate question — "what can the integration see RIGHT NOW, and how much of that have we never
captured a single byte of?" — and fully backfills the answer, regardless of edit date. See
`src/corpus/notion/reach.ts` for the implementation and `src/cli/commands/refresh/tokenedJobs.ts#ingestNotion`
for how it's sequenced ahead of the normal crawl.

## The two phases, every refresh

1. **Enumerate** — page `client.search` for both `page` and `data_source` objects to exhaustion, with no
   `since` cutoff at all, collecting only `{id, last_edited_time, raw}` per hit. No block tree is walked, no
   comments are fetched, no data-source rows are queried. This is the "names only, cheap" half: a full
   sweep of a workspace's search index costs one rate-limited call per 100 objects (~3 req/s), not one call
   per object.
2. **Diff + backfill** — set-difference the enumerated ids against what's already held (bronze's own
   `page:<id>`/`database:<id>` records, unioned with `structures/notion.jsonl`'s known data-source ids —
   the structural hydration pass discovers every accessible data source unconditionally on every `derive`,
   so a data source it already knows about must never be reported as newly granted just because this
   refresh hasn't captured a row from it yet). The ids left over — the **grant delta** — are fetched
   completely: every page's block tree + comments, every data source's full row set, regardless of
   `last_edited_time`. This reuses the exact fetch logic the incremental crawl uses
   (`collectSearchedPages` in `src/corpus/notion/liveApiPagesLane.ts`, `collectDatabaseResults` in
   `src/corpus/notion/liveApiDatabases.ts`), fed the delta's raw
   hits instead of a live search page, with `cutoff: undefined` and an empty seen-index so nothing in the
   delta is skipped.

The delta is flushed to bronze immediately, and the seen index is **rebuilt from bronze** before the normal
incremental pass starts — so a delta id that also happens to fall inside the run's own `since` window is
never fetched twice.

## What a run reports — the "reachable vs. held" line

Every Notion refresh prints one `reach:` note, unconditionally (never only when something changed):

```
notion: reach: 5,412 page(s) + 340 database(s) reachable — 5,000 page(s) + 331 database(s) already held,
  +412 page(s) + 9 database(s) newly reachable this run, backfilled regardless of edit date; roots:
  <title>, <title>, …
```

or, when nothing changed:

```
notion: reach: 5,412 page(s) + 340 database(s) reachable, all already held — nothing newly reachable this run
```

Silence is never the answer to "did anything become newly reachable" — an absent line would be
indistinguishable from a run that never checked, which is the failure mode `docs/notion-coverage.md`
documents for the connector's other blind spots.

## What reach does NOT cover, decided rather than overlooked

- **A child page invisible to `search`** (`docs/notion-coverage.md` measures 51% of `child_page` blocks this
  way) is not itself enumerated by the reach sweep — it is reached the same way the incremental crawl
  reaches it, by recursion into a parent's block tree, and its capture is marked `capture: "partial"` on the
  parent so `seenIndex.ts` never treats that parent as skippable. Reach detection widens WHICH parents get
  walked; it does not change how a borrowed-content child is discovered.
- **A revoked grant** is not detected. Reach only ever adds — it diffs "now visible" against "already held"
  in one direction. A page the integration can no longer see still has its old bronze capture, and nothing
  here removes it or flags it as stale.
- **A grant-delta enumeration or backfill failure is fatal for the run**, exactly like the incremental
  crawl's own top-level failures — an auth rejection or an exhausted retry budget during reach detection
  aborts the whole Notion source rather than silently skipping ahead to a normal crawl that would fail the
  same way moments later.
- **Backfill respects `--fetch-cap`** (bounding items yielded, same contract as the incremental crawl) but
  **enumeration never does** — capping enumeration would under-report the delta rather than under-fetch it,
  which is a worse failure than a slightly slower `--fetch-cap` run.

## Cost

Enumeration alone (no backfill) adds two full `search` sweeps to every refresh — one per object type — at
the shared ~3 req/s rate. For a workspace with a few thousand objects that is tens of seconds, not the hours
a full recursive re-crawl costs; the expensive part (block-tree rendering, comment paging, row querying) only
ever runs against the delta, which is normally empty.
