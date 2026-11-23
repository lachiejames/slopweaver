/**
 * The fleet ceiling's shared test fixtures: journal sample runs, seat ticks, the one-hour span the burn and ceiling
 * cases share, and the two-plan ceiling fixture. Used by the `seatCeiling/` tests and
 * `seatCeilingUsageLimit.test.ts`.
 */
import type { SeatTickSample } from "../../../capacity/seatBurn.js";
import { measureFleetCeiling as realMeasureFleetCeiling, type SeatCeilingPlan } from "../../../capacity/seatCeiling.js";
import type { DrawdownSample } from "../../../claude/drawdownAnomaly.js";
import { DEFAULT_THRESHOLDS } from "../../../plans/thresholds.js";
import { NO_USAGE_LIMIT, WEEKLY_WINDOW } from "../../../plans/usageLimit.js";
/**
 * {@link realMeasureFleetCeiling} under the register's default Claude thresholds, which every case not about a
 * threshold is judged by — so such a case reads exactly as it did before the bars moved into the register.
 *
 * @returns the fleet ceiling report, or why the span could not be measured
 */
export function measureFleetCeiling(
  options: Omit<Parameters<typeof realMeasureFleetCeiling>[0], "thresholds">,
): ReturnType<typeof realMeasureFleetCeiling> {
  return realMeasureFleetCeiling({ ...options, thresholds: DEFAULT_THRESHOLDS.claude });
}

const MINUTE_MS = 60_000;

/**
 * The instant `minutes` after `baseIso`, as ISO.
 *
 * @returns the shifted instant as an ISO string
 */
function after({ baseIso, minutes }: { baseIso: string; minutes: number }): string {
  return new Date(Date.parse(baseIso) + minutes * MINUTE_MS).toISOString();
}

/**
 * One seven-day (or stated-window) journal sample.
 *
 * @returns the journal sample
 */
export function sample({
  alias,
  observedAtIso,
  resetAtIso,
  utilization,
  window = "seven-day",
}: {
  alias: string;
  observedAtIso: string;
  resetAtIso: string;
  utilization: number;
  window?: DrawdownSample["window"];
}): DrawdownSample {
  return { kind: "sample", observedAtIso, planAlias: alias, resetAtIso, schemaVersion: 1, utilization, window };
}

/**
 * A run of seven-day samples ten minutes apart from `startIso`, one per stated utilization, one reset.
 *
 * @returns the samples, in order
 */
export function run({
  alias,
  startIso,
  resetAtIso,
  utilizations,
}: {
  alias: string;
  startIso: string;
  resetAtIso: string;
  utilizations: readonly number[];
}): readonly DrawdownSample[] {
  return utilizations.map((utilization, index) =>
    sample({ alias, observedAtIso: after({ baseIso: startIso, minutes: index * 10 }), resetAtIso, utilization }),
  );
}

/**
 * Weekly-window plans with no usage limit set — the shape every case measures unless it says otherwise.
 *
 * @returns one weekly plan per alias
 */
export function weekly(...aliases: string[]): readonly SeatCeilingPlan[] {
  return aliases.map((alias) => ({ alias, allowance: WEEKLY_WINDOW, usageLimitPercent: NO_USAGE_LIMIT }));
}

/**
 * One tick's seat counts.
 *
 * @returns the tick sample
 */
export function tick({ at, working, open }: { at: string; working: number; open: number }): SeatTickSample {
  return { observedAtIso: at, openSeats: open, workingSeats: working };
}

/** The one-hour span the burn and ceiling cases share, and their seven-day resets. */
export const HOUR_FROM = "2026-10-04T00:00:00.000Z";
export const HOUR_TO = "2026-10-04T01:00:00.000Z";
export const FAR_RESET = "2026-10-08T00:00:00.000Z";

/** alpha draws 0.02 per ten minutes over the hour — 0.12 in all. */
export const ALPHA_RUN = run({
  alias: "alpha",
  resetAtIso: FAR_RESET,
  startIso: HOUR_FROM,
  utilizations: [0.1, 0.12, 0.14, 0.16, 0.18, 0.2, 0.22],
});

/** beta draws 0.01 per ten minutes over the hour — 0.06 in all. */
export const BETA_RUN = run({
  alias: "beta",
  resetAtIso: FAR_RESET,
  startIso: HOUR_FROM,
  utilizations: [0.3, 0.31, 0.32, 0.33, 0.34, 0.35, 0.36],
});

/** Three working seats from 00:00 to the span's end: ticks every 20 minutes, the last held to 01:00. */
export const THREE_WORKING: readonly SeatTickSample[] = [
  tick({ at: "2026-10-04T00:00:00.000Z", open: 5, working: 3 }),
  tick({ at: "2026-10-04T00:20:00.000Z", open: 5, working: 3 }),
  tick({ at: "2026-10-04T00:40:00.000Z", open: 5, working: 3 }),
];

/**
 * alpha draws 0.001 and beta 0.0005 per ten minutes under three working seats: 0.009 over 3 seat-hours, a burn of
 * 0.003 plan-weeks per working seat-hour. Each ends the hour at the last utilization given.
 *
 * @returns alpha's and beta's runs over the shared hour
 */
export function ceilingFixture({
  alphaReset,
  betaReset,
  betaUtilizations = [0.747, 0.7475, 0.748, 0.7485, 0.749, 0.7495, 0.75],
}: {
  alphaReset: string;
  betaReset: string;
  betaUtilizations?: readonly number[];
}): readonly DrawdownSample[] {
  return [
    ...run({
      alias: "alpha",
      resetAtIso: alphaReset,
      startIso: HOUR_FROM,
      utilizations: [0.444, 0.445, 0.446, 0.447, 0.448, 0.449, 0.45],
    }),
    ...run({ alias: "beta", resetAtIso: betaReset, startIso: HOUR_FROM, utilizations: betaUtilizations }),
  ];
}
