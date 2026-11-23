# `codex-fleet-capped`: the cap is told, never bought out of

Every Codex account once sat capped for days and the owner learned it from a seat screen: rule 9's fallback kept
every seat working, so nothing the owner reads said Codex had stopped. The fleet lets the owner know when Codex is
capped, and the answer is to wait for the reset: no plan purchase and no money ask. The other monitors: [the monitors](the-monitors.md).

- **Two halves, the same seam as a sign-out.** `readCodexFleetSnapshot` ranks what it read and files one row per
  account — eligible, or the exclusion kind — in the store's singleton `codex_fleet_cap` row
  (`src/codex/fleetCapRecord.ts`, `src/codex/fleetCapPort.ts`), a near-cap row dated by the latest of its windows at
  the bar, a refusing one by its evidence. One upsert, so a read judged earlier never overwrites a later one; a store
  that cannot be read is `unmeasurable`, never clear, and a filing that fails warns without failing the read.
- **Fires** when no row is eligible and at least one is out for capacity (`near-cap` or `quota-refused`) — wider
  than the landing gates' cap (`src/codex/fleetCap.ts`), which needs a refusal: a fleet all at the pause bar (99% by default) takes no
  pass either. Paused and signed-out rows are not capacity.
- **A NOTICE, one for the fleet.** _Codex is capped on `<n>` of `<m>` accounts until `<first reset>` — Claude
  fallbacks plan and review meanwhile_, every account's reset in `unblocks`, on no queue and asking nothing,
  raised by `--fire`. Keyed by the first reset rounded up to the minute, held while firing, and settled once that
  minute passes (`lapsesAt`); past it the filed read is `unmeasurable` until the next Codex read files again.
- **Who posts it.** The monitor lane, which the seat refusal (`src/hand/seatPost.ts`) leaves to the chair; a seat
  never posts a cap note of its own.
- **Unmeasurable, never clear**, before any read has filed or when the row will not decode; a record write that
  fails warns and never fails the Codex read, since routing outranks the note.
- **A failed filing never leaves an earlier read standing in for it.** A filing first marks the row with its read's
  instant (`src/codex/fleetCapUnfiled.ts`), then files, and on a refusal marks it again with why; a marker strictly
  later than the record reads `unfiled`, drawn unmeasurable until a record at or after it lands. The residue: a
  store refusing the marker too leaves no trace, so the earlier record is read again until the next Codex read files.
