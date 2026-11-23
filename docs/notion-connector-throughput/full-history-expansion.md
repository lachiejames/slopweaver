# The full-history expansion

Part of [Notion connector throughput — what made it slow, and what the fix actually changed](../notion-connector-throughput.md).

Run against the real workspace as a LADDER of six widening windows rather than one `--all`.
That shape is not a convenience: capture coverage is recorded only by a crawl that COMPLETED, was uncapped,
gap-free and fully enumerated, so a monolithic run banks nothing until the very end and every interruption
throws away the skip benefit even though the content landed. Each rung that completes banks coverage
permanently and makes the next one cheaper.

| Rung | `--since`, back from the run | Wall   | Requests | Achieved rate         | Items skipped | New records | Projected |
| ---- | ---------------------------- | ------ | -------- | --------------------- | ------------- | ----------- | --------- |
| 1    | ~3 weeks                     | 7,462s | 20,567   | 2.79 of 3 req/s (93%) | 482           | 146         | 15,630    |
| 2    | ~2 months                    | 7,919s | 21,552   | 2.75 of 3 req/s (92%) | 3,432         | 7           | 16,025    |
| 3    | ~4 months                    | 8,565s | 22,932   | 2.70 of 3 req/s (90%) | 6,423         | 31          | 17,783    |
| 4    | ~8 months                    | 7,863s | 20,971   | 2.69 of 3 req/s (90%) | 8,741         | 5           | 17,311    |
| 5    | ~2 years 8 months            | 7,768s | 20,457   | 2.66 of 3 req/s (89%) | 10,046        | 19          | 16,441    |
| 6    | `--all`                      | 7,038s | 18,132   | 2.60 of 3 req/s (87%) | 10,713        | 9           | 15,359    |

Read the last three columns together, because that is where the fix shows up:

- **Skips compound, and then start paying for the width.** Rungs 1-3 the skip only offset a widening
  window and wall time still rose. From rung 4 it wins outright: rung 4 widened the window by four months
  and finished 12 minutes FASTER than rung 3, and rung 6 - the widest possible - was the fastest of all six.
- **The rate held between 87% and 93% of the cap across 13 hours of crawling**, on runs an order of
  magnitude longer than the bounded window the concurrency fix was measured on. The gentle downward drift
  is the giant pages taking a larger share as windows widen, not the mechanism degrading.
- **Rung 5's multi-year cutoff was never the ambitious target it looked like.** It widened the window by two
  full YEARS and yielded 19 new records; rung 6 removed the cutoff entirely and yielded 9. Practically nothing
  in this workspace predates rung 4's cutoff, which retires a question the expansion plan had left open.

## Corpus after

| Measure                           | Value                                        |
| --------------------------------- | -------------------------------------------- |
| Bronze records                    | tens of thousands                            |
| Distinct objects                  | over ten thousand                            |
| On disk                           | hundreds of MB across a small set of windows |
| Pages marked `capture: "partial"` | hundreds                                     |
| `slopweaver derive`               | under a minute, silver rebuilt clean         |

## The two spot-checks

- **Tables render.** One deep teamspace root captured hundreds of chunk records and tens of thousands of non-empty lines, including
  **more than a thousand rendered multi-cell table rows**. Table cells reaching the corpus as content rather
  than as empty blocks is the earlier `table_row` fix, confirmed still live at full-history scale.
- **A deep child tree is present with content.** That root's independently-captured descendants number dozens
  across several levels, and **all of them carry text**. The tree was expected to be larger, and the difference is
  explained rather than unexplained: [notion-coverage.md](../notion-coverage.md) measures about half of child pages
  as invisible to `search`, so those exist only inlined into the parent's body - which is exactly why that
  root is hundreds of chunks, and why any capture inlining a `child_page` is now marked partial.

## What it still could not read, stated rather than hidden

731 nodes across two reasons, both ours rather than the provider's: **453 item-deadline** (a page spent its
400-request budget and was truncated) and **278 depth-cap**. No `object_not_found` or `restricted_resource`
appeared at all, so the grant covers everything the integration is pointed at - there is no access gap left
to chase, only our own bounds.

Those bounds are the whole remaining story. The same handful of teamspace roots trips the request budget on
**every single rung**, re-spending 400 requests and truncating in a slightly different place each time, which
is also why a run that discovers almost nothing still writes a few records. Resuming a giant page across runs
is the lever; it is unchanged by this work and now has six runs of evidence behind it.
