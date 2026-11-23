/**
 * Tick rows for the reseal tests: a sound one built through the real parser, and the two ways a carried row goes
 * wrong — stale stats alone, and a defect a reseal must not repair.
 */
import { unwrap } from "../../../lib/result.js";
import { parseSupervisorTickRow, supervisorTickStatsOf } from "../../../supervisor/tickSchema.js";
import {
  SUPERVISOR_TICK_SCHEMA_VERSION,
  type SupervisorTickRow,
  TICK_SOURCE_KINDS,
} from "../../../supervisor/tickTypes.js";

/** How many bytes a stale row over-records, as a sanitiser that shortened names inside it would leave it. */
export const STALE_BYTES = 23;

/**
 * Every source, `unavailable` at the given instant.
 *
 * @param observedAtIso when each was observed
 * @returns one observation per source kind
 */
function allUnavailable({ observedAtIso }: { observedAtIso: string }): Record<string, unknown> {
  const sources: Record<string, unknown> = {};
  for (const kind of TICK_SOURCE_KINDS) {
    sources[kind] = {
      diagnostic: "not read by this fixture",
      observedAtIso,
      status: "unavailable",
      witness: { command: `slopweaver ${kind}`, exitCode: null },
    };
  }
  return sources;
}

/**
 * One sound row finalised at the given instant, read through the real parser so its stats are the computed ones.
 *
 * @param tickId the row's own id
 * @param finalisedIso when it was written; the tick started a minute earlier
 * @returns the row
 */
export function soundTick({ tickId, finalisedIso }: { tickId: string; finalisedIso: string }): SupervisorTickRow {
  const startedIso = new Date(Date.parse(finalisedIso) - 60_000).toISOString();
  const parts = {
    actions: [],
    judgements: [],
    ownerTurns: {
      coverage: { linksKnown: 1, reachesSince: true, unreadable: [], walked: ["a1"] },
      sinceIso: null,
      status: "read",
      turns: [],
    },
    sources: allUnavailable({ observedAtIso: startedIso }),
  };
  return unwrap(
    parseSupervisorTickRow({
      value: {
        ...parts,
        finalisedIso,
        handoff: "handoff-9226",
        schemaVersion: SUPERVISOR_TICK_SCHEMA_VERSION,
        startedIso,
        stats: supervisorTickStatsOf(parts),
        tickId,
        workspace: "workspace:61",
      },
    }),
  );
}

/**
 * The same row with its structured byte count over-recorded — the only defect a reseal repairs.
 *
 * @param row a sound row
 * @returns the row, its stats stale by {@link STALE_BYTES}
 */
export function staleTick({ row }: { row: SupervisorTickRow }): SupervisorTickRow {
  return { ...row, stats: { ...row.stats, structuredUtf8Bytes: row.stats.structuredUtf8Bytes + STALE_BYTES } };
}

/**
 * The same row finalised before it started, with stale stats too — a defect no reseal may paper over.
 *
 * @param row a sound row
 * @returns the defective row
 */
export function backwardsTick({ row }: { row: SupervisorTickRow }): SupervisorTickRow {
  return staleTick({ row: { ...row, finalisedIso: new Date(Date.parse(row.startedIso) - 1000).toISOString() } });
}
