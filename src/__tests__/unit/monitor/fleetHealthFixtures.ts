/**
 * Shared fixtures for the `fleet-unhealthy` verdict's test files: one window of probed slot attempts at one instant, the listener readings beside it, and the one subject a firing reading carries.
 */
import {
  RECIPE_SLOT_ATTEMPT_SCHEMA_VERSION,
  type RecipeSlotAttempt,
  type RecipeSlotOutcome,
} from "../../../live/automation/slotAttempt.js";
import type { ProbedAttempt } from "../../../monitor/fleetHealthAttempts.js";
import type { RowFate } from "../../../monitor/fleetHealthFate.js";
import type { MonitorReading, MonitorSubject } from "../../../monitor/types.js";

/** The instant every case is judged at — 01:37 in Melbourne, so a case's delivery holds for the owner's morning. */
export const NOW = "2026-09-29T15:37:00.000Z";
/** No failing row's fate is known — each line keeps its recorded why. */
export const NO_FATES: ReadonlyMap<string, RowFate> = new Map();
/** When every settled attempt settled. */
export const SETTLED = "2026-09-29T12:00:00.000Z";

/** A run that exited 0. */
export const SUCCEEDED: RecipeSlotOutcome = { exitCode: 0, kind: "succeeded", settledAtIso: SETTLED };
/** A run that exited 1 — typed as the failed member, so a case can spread it and replace its `detail`. */
export const FAILED: Extract<RecipeSlotOutcome, { kind: "failed" }> = {
  detail: "exit 1",
  exitCode: 1,
  kind: "failed",
  retryNotBeforeIso: "2026-09-29T13:00:00.000Z",
  settledAtIso: SETTLED,
};

/**
 * One probed attempt, started inside the window unless a case says otherwise.
 *
 * @param recipeId the row it ran
 * @param outcome how it ended — `null` while open
 * @param leaseExpiresIso when an open attempt is abandoned by lease
 * @param holderPid the pid performing it in process, or null for a seated run
 * @param holderAlive what the probe says about that pid
 * @returns the attempt and its probe
 */
export function probed({
  recipeId = "resync-corpus-slack",
  outcome = SUCCEEDED,
  startedAtIso = "2026-09-29T10:00:00.000Z",
  leaseExpiresIso = "2026-09-29T20:00:00.000Z",
  holderPid = null,
  holderAlive = null,
  runStartedAtIso = null,
}: {
  recipeId?: string;
  outcome?: RecipeSlotOutcome | null;
  startedAtIso?: string;
  leaseExpiresIso?: string;
  holderPid?: number | null;
  holderAlive?: boolean | null;
  runStartedAtIso?: string | null;
}): ProbedAttempt {
  const attempt: RecipeSlotAttempt = {
    attempt: 1,
    holder: "recipe run-due",
    holderPid,
    holderToken: "token",
    leaseExpiresIso,
    outcome,
    recipeId,
    runStartedAtIso,
    schemaVersion: RECIPE_SLOT_ATTEMPT_SCHEMA_VERSION,
    slotIso: startedAtIso,
    startedAtIso,
  };
  return { attempt, holderAlive };
}

/**
 * `count` attempts of one shape.
 *
 * @param count how many
 * @param shape the shape each takes
 * @returns the attempts
 */
export function many({ count, shape }: { count: number; shape: Parameters<typeof probed>[0] }): ProbedAttempt[] {
  return Array.from({ length: count }, () => probed(shape));
}

/** `bot-off-the-air` reading the listener on the air. */
export const BOT_CLEAR: MonitorReading = { monitorId: "bot-off-the-air", state: "clear" };

/**
 * The one subject off a reading that must be firing — throwing, like `unwrap`, when it is not.
 *
 * @returns its subject
 */
export function subjectOf({ reading }: { reading: MonitorReading }): MonitorSubject {
  if (reading.state !== "firing") {
    throw new Error(`expected a firing reading, read ${reading.state}`);
  }
  return reading.subjects[0]!;
}

/** A lease run out with nothing settling it — a seated run that started, then died. */
export const DIED_BY_LEASE = {
  leaseExpiresIso: "2026-09-29T11:00:00.000Z",
  outcome: null,
  runStartedAtIso: "2026-09-29T10:01:00.000Z",
} as const;
