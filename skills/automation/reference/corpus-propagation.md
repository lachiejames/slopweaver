# Corpus propagation — what a corpus sync does last, and the pass it seats

Every corpus sync has a session that does a pass over everything in the queue, the workstreams and the database,
and updates anything worth updating, so workstreams are tracked in real time without the owner having to say
anything.

Which surface reads which source, and how each is brought current, is the generated
[propagation map](../../../docs/propagation-map.md). This page is what the resync does with it and what the
seated pass does.

## What `automation resync --source <s>` does after a success

The sync's own verdict is written first and nothing below changes it or its exit code.

1. **Re-derive in code.** After a `github` or `slack` sync the resync takes a fresh `github landing` reading, as
   `corpus-propagation:<id>`, without `--press` or `--register` — so the pull-requests page and the queue's `pr`
   rows read review state from after the sync, not from the last tick.
2. **Record.** One record per sync lands in `$SLOPWEAVER_HOME/live/recipe/propagation/records/`, carrying each
   surface's outcome and the reading's receipt (`readingId`, `observedAtIso`). A failed read is on the record.
3. **Join or seat ONE pass.** Under the `corpus-propagation-batch` lock the sync joins the open batch
   (`batch.json`). Only OPENING a batch seats a session: a dispatch board row, then `cmux spawn <slug> --model
opus`. Seven corpus syncs in one seat open one pass. A resync outside a visible session, or against a
   `--home` other than the ambient one, records the batch and prints `automation propagate --seat` instead (rule 2).

A seated pass whose workspace cmux no longer lists, with syncs still pending, is lapsed and a fresh one is
seated. Age never lapses one — a slow pass left open is still the one pass — and a cmux that does not answer
reseats nothing. A seat the fleet spawn backoff defers (exit 4) stays recorded unseated with that problem; the
resync still exits on its SYNC, which is done, and the next join or `automation propagate --seat` (exit 4 while
still held) seats it — re-running a sync on a held machine to retry a seat would be the wrong load.

## The pass itself — you, if this workspace was opened on a `corpus-propagation-pass-*` row

```bash
slopweaver automation propagate --status                     # the syncs this pass covers, and what each re-derived
slopweaver automation propagate --done --batch <id> --through-revision <n> # confirm what --status printed
```

1. **Read `--status`.** Note the revision. A `failed` surface is yours to investigate first — a landing read
   that failed means the pull-requests page is still on its older reading.
2. **Walk the queue.** For each open ask, hand card and draft, ask whether the fresh corpus changed its answer:
   a reply landed, a PR merged, a Linear issue closed. Update through the typed verbs (`handover answer`,
   `hand done`, `slack draft …`) — never by editing a file.
3. **Walk the workstreams.** `slopweaver handover list`, then prune and re-tag the rows the fresh corpus moved
   ([reading the board](../../handover/reference/reading-the-board.md)).
4. **The briefing** re-renders through the chair's own tick; do not render it from here.
5. **Confirm.** `--done --batch <id> --through-revision <n>` with the batch and revision you READ. If a sync
   joined while you worked, it says so and the pass stays open — read `--status` again and cover it too. A
   batch retired since your read is refused rather than confirmed, so a stale pass cannot close a newer one.
6. **End the run** saying what changed and whether it learned anything ([knowledge](../../knowledge/SKILL.md)),
   then close the workspace.

## When a corpus sync stops firing

The `corpus-sync-stopped` monitor ([the monitors](../../monitor/reference/the-monitors.md)) floats a note and puts
a card at the top of the owner's queue — even though the standing steer sends every resync row to the chair. The
steer says who seats a resync; it never says one ran. MEASURED: all seven corpus resyncs had last succeeded days
earlier, 22 firings missed each, while `recipe-stopped` read `STEERED — nothing to ask the owner`.
