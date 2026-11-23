/*
 * The pure fixtures every `automation seat` test file shares: the clock, the definition rows a store is seeded
 * with, the composed report rows a seat is planned over, and the slot ledger's own words for a refused row.
 */
import { RECIPE_DEFINITION_SCHEMA_VERSION } from "../../../../../../live/automation/definition.js";
import type { DueAskReport, DueAskRow } from "../../../../../../live/automation/dueReport.js";
import { BUMP_FIX_KIND, RESYNC_KIND } from "../../../../../../live/automation/kinds.js";

export const NOW_ISO = "2026-09-15T23:05:00.000Z";
/** A landing READ trimmed to the fields the packet check reads — what `github landing --json` prints. */
export const LANDING_PACKET = '{"kind":"read","rows":[],"dispatchable":[],"tally":{}}';
/** The declared main checkout a seat resolves before it writes anything — see `seatCheckout`. */
export const SEAT_CHECKOUT = "/checkouts/slopweaver";

/**
 * One `resync` row — the kind a supervisor pass seats a session for.
 *
 * Hourly rather than the four-hourly cadence these rows really carry: an hourly slot is the same instant in
 * every whole-hour zone, so the watermark these cases assert does not move when the lane runs in UTC rather
 * than the author's own zone. `runDue/fixtures.ts` carries the same note for the same reason.
 *
 * @returns the row as a definition file holds it
 */
export function resyncRow(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    cadence: "0 * * * *",
    destination: { kind: "local-atlas" },
    effect: "read",
    kind: RESYNC_KIND,
    onMissed: "backfill",
    params: { argv: ["recipe", "resync", "--atlas", "trelica"] },
    recipeId: "resync-atlas-trelica",
    schemaVersion: RECIPE_DEFINITION_SCHEMA_VERSION,
    ...over,
  };
}

/**
 * One `bump-fix` row, hourly for the same whole-hour-zone reason {@link resyncRow} gives.
 *
 * @returns the row as a definition file holds it
 */
export function bumpFixRow(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    cadence: "0 * * * *",
    destination: { kind: "local-atlas" },
    effect: "read-write",
    kind: BUMP_FIX_KIND,
    onMissed: "skip",
    params: { argv: ["github", "bump-drive", "--repo", "lachiejames/slopweaver", "--dry-run"] },
    recipeId: "bump-fix-slopweaver",
    schemaVersion: RECIPE_DEFINITION_SCHEMA_VERSION,
    ...over,
  };
}

/**
 * One `verb-run` row — the kind the seating tick runs in its own process.
 *
 * @returns the row as a definition file holds it
 */
export function verbRunRow(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    cadence: "0 * * * *",
    destination: { kind: "local-atlas" },
    effect: "read",
    kind: "verb-run",
    params: { argv: ["atlas", "freshness"] },
    recipeId: "atlas-rolling-window",
    schemaVersion: RECIPE_DEFINITION_SCHEMA_VERSION,
    ...over,
  };
}

/**
 * One composed report row, for the pure planning cases.
 *
 * @returns a due, actionable, spawn-shaped `resync` row unless a case overrides a field
 */
export function reportRow(over: Partial<DueAskRow> = {}): DueAskRow {
  return {
    actionable: true,
    cadence: "0 */4 * * *",
    claim: undefined,
    due: true,
    effect: "read",
    firingsSinceWatermark: 1,
    kind: RESYNC_KIND,
    lastRunAtIso: null,
    onMissed: "backfill",
    recipeId: "resync-atlas-trelica",
    shape: "spawn",
    slotIso: "2026-09-15T20:00:00.000Z",
    slotsOwedAfterThis: 0,
    tolerance: { band: "comfortable", lateByMs: 0, nextFiringInMs: 3_600_000 },
    ...over,
  };
}

/** The instant a failed attempt in these cases may next be retried — after {@link NOW_ISO}, so it cools. */
export const RETRY_NOT_BEFORE_ISO = "2026-09-15T23:34:44.600Z";

/** The ledger's own words for a first attempt that failed and has not reached its floor. */
export const COOLING_WHY = `COOLING · attempt 1 failed at 2026-09-15T23:02:00.000Z (exit 1); the next may start at ${RETRY_NOT_BEFORE_ISO}`;

/** The ledger's own words for a firing that has spent every attempt it gets. */
export const EXHAUSTED_WHY = "EXHAUSTED · every attempt this slot gets has been spent, the last on exit 1";

/**
 * A whole report from the given rows.
 *
 * @returns a report judged at {@link NOW_ISO} carrying those rows and nothing missing, rejected or stranded
 */
export function report({ rows }: { rows: readonly DueAskRow[] }): DueAskReport {
  return { missing: [], nowIso: NOW_ISO, rejected: [], repositoryDrift: [], rows, stranded: [], superseded: [] };
}
