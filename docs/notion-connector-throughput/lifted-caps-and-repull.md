# Lifting the caps, and why a lifted run needs a THIRD bound

Part of [Notion connector throughput — what made it slow, and what the fix actually changed](../notion-connector-throughput.md).

MEASURED, the incremental catch-up over a 36h gap: `refresh --source notion --no-derive` took
**4h 37m** and achieved **0.24 req/s of the 3 req/s cap (8%)**, so the run is nowhere near rate-limited — the
cost is per-item work, not throttling. It skipped **over a thousand nodes, mostly `depth-cap` and the rest `item-deadline`**,
and bronze grew by roughly a quarter while the partial share rose slightly. The rise is
reach, not rot: thousands of pages and hundreds of databases were newly REACHABLE that run and were backfilled regardless of
edit date, and they truncate at the same caps as everything else.

That measurement is why the caps are liftable **and** why lifting them alone is refused. The same run named
individual pages that spent the whole 400-request budget and were **still** truncated — one after **23.5
minutes** of wall clock, others at 13.3, 13.6 and 13.7 — and there are 241 of that class. Raising the request
budget removes the only thing that ended those pages, and nothing measured says where they would stop
instead. So three flags, and one refusal:

| Flag                   | Bounds                                | Default |
| ---------------------- | ------------------------------------- | ------- |
| `--notion-block-depth` | how deep the block recursion descends | 6       |
| `--notion-item-calls`  | requests ONE page or row may issue    | 400     |
| `--notion-item-time`   | wall clock ONE page or row may spend  | none    |

**Raising either of the first two without `--notion-item-time` is a usage error**, not a warning: a run whose
worst case per item is unknown cannot be scheduled, which is the property `--if-stale` and the refresh slot
exist to protect. Lowering a cap needs no time bound — narrowing a bound is always safe. All three refuse
without `--source notion` beside them, for the same reason `--stale-after` refuses without `--if-stale`: a
bare `refresh` means GitHub, so a caller who typed a bound and got a GitHub run has been told nothing.

## Proved live — and it sizes the time bound

`refresh --source notion --fetch-cap 1 --no-derive --notion-block-depth 50 --notion-item-calls 5000
--notion-item-time 2m` against the real workspace, in 420s:

```
notion: caps: block depth 50, 5000 requests per item, 2.0m per item (LIFTED above the shipped defaults)
notion:   item-time-cap: 73 — exceeded its own per-item TIME budget
notion: page <id> hit its per-item time bound after 274 request(s) and 2.0m — kept partial content
notion: throughput: 275 request(s) in 420s — 0.65 req/s achieved of 3 req/s cap (22%)
```

**The finding is that a time bound can be a TIGHTENING rather than a lift.** That page issued 274 requests in
its 2 minutes — about **2.3 req/s for one item**, nearly the whole global cap — so 400 requests would have
taken it roughly **2.9 minutes**. A `--notion-item-time` below ~3m therefore gives a pathological page LESS
than the shipped 400-request budget does, however high `--notion-item-calls` is set. Size the time bound above
that floor, or the lifted run captures less than the capped one. (The run wrote 0 new records for exactly this
reason: 274 requests reached less of the page than the previous run's 400 did, so every projected record
deduped.)

Every run reports the bounds it used as its first note (`caps: block depth 6, 400 requests per item, no
per-item time bound`), and a truncated item's own note says WHICH bound ended it plus both numbers — a page
that spent 400 requests in 23 minutes and one that spent 12 in 23 minutes cost the same wall clock for
completely different reasons, and only one of them gets faster when the request budget is raised.

## The re-pull is IN PLACE, not move-aside — and the reason is a read-time rule

A whole re-pull with the caps lifted writes a fuller capture of a page bronze already holds a truncated one
of. The write layer admits it; the read layer is where the risk sits:

- **The writer admits it.** Dedup is `(sourceId, content fingerprint)` and `text` is in the fingerprint, so a
  fuller body is a new fingerprint and lands as a new row. `isFresh` rejects only a STRICTLY older `tsIso`, and
  a re-pull carries the page's unchanged `last_edited_time`, so an equal timestamp passes.
- **Compact keeps both.** It drops `(sourceId, fingerprint)` duplicates, and these two are not duplicates.
- **The latest-record view must prefer the repair.** A repaired capture is byte-for-byte its truncated
  predecessor minus `,"capture":"partial"` — 20 bytes SHORTER — so a same-instant tie broken on serialised
  LENGTH keeps the truncated row: `slopweaver dev capture-conflicts --source notion` counted **over ten thousand** such
  groups.

So: **re-pull in place**, and the partial marker outranks length at an equal instant and text
(`latestRecords.ts`, rule 1). Move-aside would be a much larger operation solving a problem the write path
never had, while leaving the read-path one untouched.

One residue, measured rather than assumed: a page whose truncated capture fitted in ONE chunk has
`sourceId: page:<id>`, and its repaired multi-chunk form is `page:<id>:chunk:N` — a different identity, so the
old single-chunk row survives in the latest view rather than being superseded. On the corpus as it stands that
is **under two hundred of some thirty-five thousand partial records (about half a percent)**, across a handful of the thousand-odd distinct partial pages that already hold both
shapes. It is a stale duplicate, never a loss of the repaired content, and it is small enough not to justify
changing a `sourceId` shape every existing Notion record depends on.
