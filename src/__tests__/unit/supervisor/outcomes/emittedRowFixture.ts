/**
 * Outcome rows built in the exact shape `handover reconcile --json` emits — typed against the emitter's own
 * `OutcomeCoverage`, `PlacedWork` and `BoardRow` — so a reader's test feeds it what reconcile really writes.
 */
import { outcomeFields } from "../../../../cli/commands/handover/reconcileOutcomes.js";
import type { BoardRow } from "../../../../handover/rank.js";
import type { PlacedWork } from "../../../../handover/reconcile.js";
import { type OutcomeCoverage, uncoveredIds } from "../../../../supervisor/outcomes/coverage.js";
import type { EmittedOutcomeFields, OutcomeSource } from "../../../../supervisor/outcomes/reconciledOutcomes.js";

/**
 * A document's whole outcome half around the rows given, written by reconcile's own `outcomeFields`: a present
 * register holding exactly those rows unless the caller names another source, and no unanchored entry.
 *
 * @param outcomes the coverage rows the register projected
 * @returns `outcomeSource`, `outcomes`, `uncoveredOutcomes` and `unanchoredOutcomes`, as reconcile emits them
 */
export function emittedFields({
  outcomes,
  outcomeSource = { count: outcomes.length, kind: "present" },
}: {
  outcomes: readonly OutcomeCoverage[];
  outcomeSource?: OutcomeSource;
}): EmittedOutcomeFields {
  return outcomeFields({
    coverage: { outcomeSource, outcomes: { outcomes, uncovered: uncoveredIds({ outcomes }) }, unanchored: [] },
  });
}

/**
 * A ready, groomed doc row, any field overridable.
 *
 * @returns the row as reconcile ranks it
 */
export function boardRow(over: Partial<BoardRow> & { id: string }): BoardRow {
  return {
    groomed: true,
    kind: "doc",
    label: over.id,
    openedIso: undefined,
    priority: "p2",
    ready: true,
    ruled: false,
    standing: "ready",
    waitingHours: 0,
    ...over,
  };
}

/**
 * A live session seated on an in-flight row of its own.
 *
 * @returns the placement reconcile reports for that seat
 */
export function seat({ session, rank }: { session: string; rank: number }): PlacedWork {
  return { rank, row: boardRow({ id: `seated-${String(rank)}`, ready: false, standing: "in-flight" }), session };
}

/**
 * One outcome's coverage row, its `rows` count derived from what sits under it.
 *
 * @returns the row as it appears under the document's `outcomes`
 */
export function emittedOutcome({
  id = "gcp-backups",
  live = [],
  unspawned = [],
}: {
  id?: string;
  live?: readonly PlacedWork[];
  unspawned?: readonly BoardRow[];
}): OutcomeCoverage {
  return {
    anchor: "transcript:s#t",
    id,
    live,
    rows: live.length + unspawned.length,
    title: "Scheduled backups landing in GCP",
    unspawned,
    words: "backups land in GCP on a schedule",
  };
}
