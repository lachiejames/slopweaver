/*
 * The tick rows, due readings, holds and actions `./supervisorStops.test.ts` builds its ledgers from: one Slack row
 * that last ran at a fixed instant, and a valid tick row around whatever due reading a case supplies.
 */
import { unwrap } from "../../../../lib/result.js";
import { parseSupervisorTickRow, supervisorTickStatsOf } from "../../../../supervisor/tickSchema.js";
import {
  SUPERVISOR_TICK_SCHEMA_VERSION,
  type SupervisorJudgement,
  type SupervisorTickAction,
  type SupervisorTickRow,
  TICK_SOURCE_KINDS,
} from "../../../../supervisor/tickTypes.js";

export const SLACK = { id: "resync-corpus-slack", kind: "recipe", label: "Slack history sync" } as const;
export const LAST_RUN = "2026-10-09T03:23:24.000Z";

/**
 * A due reading naming each row as waiting to run, held by `heldBy`.
 *
 * @returns the reading, as the tick ledger stores a read source
 */
export function dueReading({
  observedAtIso,
  ids,
  heldBy = null,
}: {
  observedAtIso: string;
  ids: readonly string[];
  heldBy?: string | null;
}): Record<string, unknown> {
  return {
    facts: { rows: ids.map((id) => ({ heldBy, id, label: id, lateMinutes: 30, runs: "spawn" })) },
    observedAtIso,
    status: "read",
    witness: { command: "slopweaver automation due --json", exitCode: 0 },
  };
}

/**
 * One valid tick row, every source unavailable but the due reading given.
 *
 * @param recipeDue the due reading, or none for an unavailable one
 * @returns the row
 */
export function tick({
  tickId,
  finalisedIso,
  recipeDue,
  actions = [],
  judgements = [],
}: {
  tickId: string;
  finalisedIso: string;
  recipeDue?: Record<string, unknown>;
  actions?: SupervisorTickAction[];
  judgements?: SupervisorJudgement[];
}): SupervisorTickRow {
  const startedIso = new Date(Date.parse(finalisedIso) - 60_000).toISOString();
  const sources: Record<string, unknown> = {};
  for (const kind of TICK_SOURCE_KINDS) {
    sources[kind] = {
      diagnostic: "not read by this fixture",
      observedAtIso: startedIso,
      status: "unavailable",
      witness: { command: `slopweaver ${kind}`, exitCode: null },
    };
  }
  if (recipeDue !== undefined) {
    sources["recipeDue"] = recipeDue;
  }
  const parts = {
    actions,
    judgements,
    ownerTurns: {
      coverage: { earliestIso: undefined, linksKnown: 1, reachesSince: true, unreadable: [], walked: ["a1"] },
      sinceIso: null,
      status: "read" as const,
      turns: [],
    },
    sources,
  };
  const value = {
    ...parts,
    finalisedIso,
    handoff: "handoff-9300",
    schemaVersion: SUPERVISOR_TICK_SCHEMA_VERSION,
    startedIso,
    stats: supervisorTickStatsOf(parts),
    tickId,
    workspace: "workspace:1",
  };
  // Decoded rather than cast, so a fixture the ledger schema would refuse fails here, at its builder.
  return unwrap(parseSupervisorTickRow({ value }));
}

/**
 * A hold-rationale judgement on a subject, the Slack row unless a case names another.
 *
 * @returns the judgement
 */
export function hold({
  claim,
  recordedIso,
  subject = SLACK,
  relatedSubjects,
}: {
  claim: string;
  recordedIso: string;
  subject?: SupervisorJudgement["subject"];
  relatedSubjects?: SupervisorJudgement["relatedSubjects"];
}): SupervisorJudgement {
  return {
    claim,
    judgementId: "j1",
    kind: "hold-rationale",
    recordedIso,
    relatedSubjects,
    subject,
    whyNotDerived: "operational-context",
    witness: { kind: "command", ref: "slopweaver automation due" },
  };
}

/**
 * An action the supervisor recorded on the Slack row.
 *
 * @param actionId its id, which the ledger schema requires to be unique within one tick
 * @returns the action
 */
export function action({
  actionId = "a1",
  kind,
  recordedIso,
  detail,
  outcome = "completed",
}: {
  actionId?: string;
  kind: SupervisorTickAction["kind"];
  recordedIso: string;
  detail?: string;
  outcome?: SupervisorTickAction["outcome"];
}): SupervisorTickAction {
  return {
    actionId,
    detail,
    kind,
    outcome,
    recordedIso,
    subject: SLACK,
    witness: { kind: "command", ref: "slopweaver automation seat" },
  };
}
