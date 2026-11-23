# The pages lane reads a body in one request

Part of [Notion connector throughput — what made it slow, and what the fix actually changed](../notion-connector-throughput.md).

The pages lane reads each body with ONE `pages.retrieveMarkdown` call and drains referenced child pages
through a queue (`src/corpus/notion/liveMarkdown.ts`, `src/corpus/notion/pageFrontier.ts`). The measurements
in [the rest of this document](../notion-connector-throughput.md) were taken when every page body came from a
recursive `blocks.children.list` walk.

**Measured live, same command, same `--fetch-cap 25`, 81 items on both sides:**

| Arm               | Requests | Crawl wall | Rows written | Partial rows |
| ----------------- | -------: | ---------: | -----------: | -----------: |
| recursive walk    |      142 |       396s |          133 |           50 |
| one markdown call |   **54** |   **313s** |          113 |           28 |

Fewer rows is duplication leaving rather than data leaving, and that was checked rather than assumed: stored
text equals each page's OWN projected body at a ratio of 1.00, including on a page carrying five child
references.

That bears on ceiling 3 below. Ceiling 4 is closed: a row query sends `sorts` + a `last_edited_time` filter,
so `--since` bounds the FETCH (`src/corpus/notion/liveApiDatabases.ts`).

## What was actually slow — four ceilings, measured not guessed

| #   | Ceiling                                                                                                                                                                                                                                                                                                                | Evidence                                                                                                                                                                                      |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Nothing checked whether bronze already held a page.** The search seam bounds `since` client-side (Notion search has no server-side date filter), so widening the window re-discovers every page newer than `since` and re-renders its whole block tree — then the writer's fingerprint dedup throws the result away. | Chunk 2 (`--since` the start of the year) discarded **27,014 of 34,552 projected records — 78%**. Re-measured on a two-day window below: **84% of what arm A projected was already on disk.** |
| 2   | **Incremental writes covered one lane of two.** `fetchNotionActivity` passed its `onBatch` checkpoint only to the databases lane — and the pages lane runs FIRST, to exhaustion.                                                                                                                                       | Chunk 3 (`--since` two years earlier) was killed at **4.3 hours with no window file for it ever appearing**, on a build whose own release notes claimed durable incremental writes.           |
| 3   | **The rate cap was never the binding constraint.** Every call was serially awaited behind one `p-throttle(interval=333ms, limit=1, strict)` gate, so the achieved rate was `1 / (333ms + latency)`, not `1 / 333ms`. The scheduler spent most of every interval with nothing to hand out.                              | Measurable, because a run reports it. After the fix: **2.81 req/s of the 3 req/s cap, 94%**. Before, doing the same work took 1.32× the wall time, so it was running at roughly 71%.          |
| 4   | **`--since` bounded what a data source KEPT, never what it fetched.** `dataSources.query` went out with no `sorts` and no `filter`, so every row of every data source was paged and then discarded client-side.                                                                                                        | Measured. The row query sends `sorts` + a `last_edited_time` filter, which closes it — see [notion-coverage.md](../notion-coverage.md).                                                       |

## Before and after, same window, same door

`slopweaver refresh --source notion --since <two days back> --no-enrich`, run three ways against the same live
workspace. The window is small on purpose: it is the largest one that can be run three times in an evening,
and by the third run nothing in it has changed — which is exactly the condition a widened `--since` creates
at scale.

| Arm                       | Build       | Skip                       | Wall       | Requests       | Achieved rate             | Items skipped | Pages fetched | Rows fetched |
| ------------------------- | ----------- | -------------------------- | ---------- | -------------- | ------------------------- | ------------- | ------------- | ------------ |
| **A — before**            | pre-fix     | did not exist              | **2,407s** | not measurable | —                         | 0             | 122           | —            |
| **C — after, first run**  | this branch | inactive (no coverage yet) | **1,837s** | 4,972          | **2.81 req/s of 3 (94%)** | 0             | 135           | 321          |
| **B — after, second run** | this branch | active                     | **1,289s** | 3,291          | 2.70 req/s of 3 (90%)     | 482           | **35**        | **4**        |

- **A → C is the concurrency fix alone**: 1.31× on wall time. The number that matters more is the
  utilisation, because it settles what is left: at 94% of the cap the crawl is now genuinely rate-limited,
  so **fetching less is the only remaining lever**.
- **C → B is the skip**: 34% fewer requests, **74% of pages and 99% of rows never fetched at all**, and
  zero new records — the run correctly concluded it already had everything.
- **A → B is what a real widened window gets**: 2,407s → 1,289s, **1.87×**, and it under-states the case.
  This window is two days old; the chunked expansion's redundancy was 78–84% over months.

Arm A's request count is absent rather than estimated: the pre-fix build had no counter, which is why one
of the fixes is the counter.

**Baseline note, worth knowing before anyone measures from there:** the main checkout's own `node_modules`
is stale (`p-timeout` 3.2.0 against the pinned 7.0.1) and fails every Notion call with ``Expected
`milliseconds` to be a positive number``. That is an environment artefact, not the before-code. Arm A ran
from a worktree pinned at the pre-fix commit with the pinned dependency tree.
