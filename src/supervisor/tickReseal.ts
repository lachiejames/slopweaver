/**
 * Reseal one tick row: recompute its `stats` when they are the ONLY thing wrong with it.
 *
 * A row's `stats` are measured over its own content, and `./tickSchema.ts` refuses a row whose recorded numbers
 * disagree. A home carried between machines through a sanitiser that shortened names inside the rows keeps every
 * row sound and every recorded number stale — and because `./tickLedgerCheck.ts` refuses the whole read at the
 * first defect, one stale number silences every reader of the ledger. The readers stay strict; this is the repair.
 *
 * It tolerates exactly one defect. The schema and every cross-field check run as `parseSupervisorTickRow` runs
 * them, through the one shared {@link auditSupervisorTickRow}, so a row refused for anything else stays refused.
 *
 * Pure — no clock, no filesystem. `./tickResealStore.ts` is the edge.
 */
import { err, ok, type Result } from "../lib/result.js";
import { auditSupervisorTickRow } from "./tickSchema.js";
import type { SupervisorTickRow, SupervisorTickStats } from "./tickTypes.js";

/** One row after its reseal: the row to write, whether it changed, and its stats either side. */
export interface TickRowReseal {
  /** The row with stats measured over its own content — the input row itself when nothing changed. */
  readonly row: SupervisorTickRow;
  /** Whether the recorded stats disagreed with the content and were replaced. */
  readonly changed: boolean;
  /** The stats the row recorded. */
  readonly before: SupervisorTickStats;
  /** The stats the row's content measures to, which the resealed row carries. */
  readonly after: SupervisorTickStats;
}

/**
 * Reseal one parsed ledger value: its stats recomputed when they are its only defect.
 *
 * `stats` keeps its key position in the row, so a resealed row renders in the same field order it was read in.
 *
 * @param value the parsed JSON of one ledger line, whatever shape it is in
 * @returns the reseal, or one line per defect other than the stats disagreement
 */
export function resealSupervisorTickRow({ value }: { value: unknown }): Result<TickRowReseal> {
  return auditSupervisorTickRow({ value }).andThen((audit) => {
    if (audit.defects.length > 0) {
      return err([...audit.defects]);
    }
    const before = audit.row.stats;
    const after = audit.computedStats;
    if (audit.statsDefect === undefined) {
      return ok({ after, before, changed: false, row: audit.row });
    }
    return ok({ after, before, changed: true, row: { ...audit.row, stats: after } });
  });
}
