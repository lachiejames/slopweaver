/**
 * The one bound on how much of a fleet journal a read sees — a leaf, so the pure judgements that must keep a line
 * inside it (`../cmux/hangNaming.ts`) name the same number the store read uses (`./storePort.ts`).
 */
import type { FleetJournalName } from "../store/schema/fleet.js";

/**
 * How many of a journal's newest entries a read returns. A ROW bound, never a byte one, so it cannot cut an entry in
 * half: 4,096 is hundreds of recovery attempts of a fifteen-seat fleet, and over two days of minute-by-minute cmux
 * probes. The file it replaces was read as a 256 KiB tail; `fleet/storePort.test.ts` measures that 4,096 of the
 * smallest event either journal can hold already exceed that window, so the row bound reaches at least as far back
 * as the file did.
 */
export const FLEET_JOURNAL_TAIL_ROWS = 4096;

/**
 * The kinds a read keeps even from BEFORE the tail, per journal. A row bound has no time-density guarantee: a burst of
 * dialog dismissals, which are never rate-limited, can fill 4,096 rows inside the hour, and the restart limiter
 * (`../cmux/hang.ts`'s `restartAllowance`) and the recurrence judgement (`../cmux/recurrence.ts`) would then not see
 * the restart that should hold the next one. Every kind those two read is kept, ahead of the
 * tail and in order, so a kept row is still older than every tail row.
 */
export const FLEET_JOURNAL_KEPT_KINDS: Readonly<Record<FleetJournalName, readonly string[]>> = {
  "cmux-revive": ["restart-started", "restart-finished", "restart-held", "recurring"],
  resume: [],
};

/**
 * How many kept rows OF EACH KIND from before the tail a read returns, the newest of that kind, so a flood of holds
 * never pushes out the starts the daily cap counts. Restarts are capped at three a day
 * (`../cmux/hang.ts`'s `RESTART_DAILY_CAP`) and each writes a start, a finish and at most a hold and a recurrence, so
 * 64 is several days of them, against the one day the limiter reads.
 */
export const FLEET_JOURNAL_KEPT_ROWS = 64;
