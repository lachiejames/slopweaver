# A row's priority, and the default written down

Every Queue card and every board row carries at least a status and a priority, the way a Linear issue does, and
where the board lacks one it is backfilled. Status is
derived on every row ([derived-row-state](derived-row-state.md)); a priority is the `priority:` a doc declares, and
`handover set-priority` is the verb that writes it.

```bash
slopweaver handover set-priority <slug>... --priority p0|p1|p2|p3 --because "<why>"
slopweaver handover set-priority --backfill            # dry: the census of what it would write
slopweaver handover set-priority --backfill --apply    # writes it
```

- **A stated band is a judgement.** `--priority` with `--because` may replace any band, writes the reason as
  `priorityBecause:`, and drops a `priorityFrom:` marker — somebody chose this one. Restating the band a row already
  holds as a choice is `unchanged`.
- **The backfill writes each row that declares nothing its KIND's default** (`DEFAULT_PRIORITY`: an ask p1, a doc p2)
  with `priorityFrom: default`. The band is the one the row already ranked in, so no ranking moves. It touches no row
  that declares a band, so a re-run is a no-op.
- **The marker is load-bearing.** `rank.ts` counts a declared priority as GROOMED — PLACED in
  [one-board](one-board.md) — and the supervisor's idle-capacity gate owes a seat to every groomed ready doc. An
  unmarked backfill would have claimed a judgement on every row at once, so a `priorityFrom: default` row ranks as
  unplaced, exactly as before it was written. `list --json` publishes `priorityFrom` beside `priority`.
- **One residue, stated:** `sweep board --priority <band>` matches the declared band, so after a backfill it
  includes rows that only hold their default.

MEASURED: 1587 of 4544 rows declared no priority; the dry census wrote 926 at p1 and 662 at p2, refusing
none — `slopweaver handover list --json --all | jq '[.rows[] | select(.priority == null)] | length'`.

A Queue card's priority reads the rows it belongs to, and draws a default as one:
[queue card properties](../../../docs/console/queue-card-properties.md).
