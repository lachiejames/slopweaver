# `console-sync-failed`: one card keyed by the last failure to arrive, across two files

A refresh the console started that failed lands in `live/console-sync-failures.jsonl`, or, when that ledger refuses
the row, in the home-root fallback `console-sync-failure-append-failures.jsonl` with the error it refused with. The
console writes both itself (`site/lib/consoleSyncFailureAppend.ts`), because the failure can be a verb that would not
start; the monitor reads both (`src/live/consoleSyncFailureStore.ts`, `src/monitor/consoleSyncFailed.ts`).

- **One subject** covers every failure inside 24 hours, keyed by the last to ARRIVE across both files, so each new
  failure re-cuts the card. A refused failure cards exactly as a kept one, its refusal named on the first detail line.
- **A damaged line is counted, never fatal**, and an unreadable file is the reading's blind spot while the other still
  holds a recent failure. With no recent failure and damage or an unreadable file, the reading is `unmeasurable`.

## Ordering the two files

Each file is in arrival order on its own. Across the two, every row records the OTHER file's size and generation as
it was written, and the writes are synchronous in one server process, so a row starting below a recorded size was
already there — while the file still has that generation.

- **A file's generation** is the SHA-256 of its first line, read from at most its first 4096 bytes. The writer opens
  every new or emptied file on a header, `{"generation":"<uuid>"}`, in the same write as its first row, so that line
  is unique to the file. A file deleted or emptied by hand comes back under a new generation; so does one whose first
  write tore, and a file written before the header existed is identified by its own first row.
- **The order of the arms**: the ledger row's `fallbackBytes` when it was recorded under the fallback's current
  generation; else the refused row's `ledgerBytes` under the ledger's; else the console's clock, a tie taking the
  refused row as the later. A recorded size of zero applies under any generation, since nothing starts below byte
  zero. A nonzero size recorded with no generation — a row written before the field existed — applies to nothing.

**The residue, stated.** The clock arm can misorder, and it is reached only when neither recorded size applies.
Editing a file's lines by hand other than the first, keeping its first line, is not seen. Two files whose first writes
both tore at the same byte share a generation.
