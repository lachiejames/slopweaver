/**
 * How much of the Claude plans' week went unused against the seats that ran, and how many WORKING seats the
 * plans can carry from here to their resets — the measurement behind the owner's question of how much plan usage
 * is left on the table each week, set against how many agents the fleet actually runs (six running agents
 * versus an expected twenty).
 *
 * Pure: samples and ticks in, one report out. `./seatCeilingRead.ts` reads them, `slopweaver fleet ceiling`
 * prints the report, the weekly recipe posts it, and the idle-capacity gate fills to its `ceiling`. The seat
 * history and the burn per working seat-hour are `./seatBurn.ts`'s.
 *
 * ## Working seats, not open seats
 *
 * A supervisor tick's watch lists every open session and the state it is in. Measured over several days,
 * ticks read 14 to 27 open seats and 1 to 12 of them `working`; the rest sat at `needs-input`, a
 * finished turn that draws nothing. A plan is drawn down by a seat that is working, so that is the count the
 * burn is divided by and the count the ceiling is in. Reproduce: `jq -r 'select(.sources.watch.status=="read")
 * | [.sources.watch.observedAtIso, (.sources.watch.facts.rows|length), ([.sources.watch.facts.rows[]|
 * select(.state=="working")]|length)] | @tsv' "$SLOPWEAVER_HOME/ledgers/supervisor/supervisor-ticks.jsonl"`.
 *
 * ## What each number does and does not claim
 *
 * - **Left on the table** is `measureUnusedCapacity`'s figure for each plan's seven-day window that reset in
 *   the span: `1 − the highest reading seen`, an UPPER BOUND, because use can rise after the last sample. Its
 *   denominator is the plan-weeks actually observed resetting, never "five" by assumption; a plan with no
 *   observed reset is named, never counted as zero.
 * - **Nothing after the span's end is read** — no tick and no plan reading — so a span measures exactly as it
 *   stood at its end, and a past slot replays to the same figures.
 * - **The ceiling** is how many working seats the plans' remaining weekly headroom (to each plan's effective
 *   ceiling, `claudeEffectiveUsageCeiling` — the house cap, or the owner's usage limit on the plan where that is
 *   lower) sustains at the burn until each plan resets. It is about the WEEKLY windows;
 *   five-hour throttling stays with the live `ceilings` admission, which is judged first. Each plan's headroom
 *   is its newest reading inside `planStatesFromSamples`' freshness bound, AS READ: the draw since that reading
 *   is not projected forward, because the burn is a fleet total no single plan's share of is known, so a
 *   reading near the bound can leave N above what the plans now carry. A plan whose week reset since that
 *   reading — the span ending on its reset, as a weekly firing's slot can — starts a fresh week at the reset,
 *   with the same blind spot: the draw since the reset is not seen.
 */
import { parseIsoMs } from "#lib/date.js";
import { err, ok, type Result } from "#lib/result.js";
import type { DrawdownSample } from "../claude/drawdownAnomaly.js";
import { claudeEffectiveUsageCeiling } from "../claude/select.js";
import { planStatesFromSamples } from "../claude/survivalForecast.js";
import type { SurvivalPlanState } from "../claude/survivalPlanState.js";
import type { ClaudeThresholds } from "../plans/thresholds.js";
import type { PlanAllowance, UsageLimitPercent } from "../plans/usageLimit.js";
import {
  burnOf,
  HOUR_MS,
  type SeatBurnMeasurement,
  type SeatHistoryMeasurement,
  type SeatTickSample,
  seatHistoryOf,
  seatIntervalsOf,
  timedTicksOf,
  weeklySamplesOf,
} from "./seatBurn.js";
import { measureUnusedCapacity, type PlanWindowSample } from "./unused.js";

/** One plan's seven-day windows that reset inside the span. */
export interface PlanUnusedMeasurement {
  readonly planAlias: string;
  /** How many of its weekly windows reset inside the span. */
  readonly expiredWindows: number;
  /** Upper bound on the plan-weeks those windows left unused; `null` when none reset inside the span. */
  readonly unusedPlanWeeksUpperBound: number | null;
  /** The widest gap from a window's last reading to its reset — how loose that bound is. */
  readonly widestLastReadingToResetSeconds: number | null;
}

/**
 * One plan's runway now: what it has left to its cap and how long it has to spend it.
 *
 * @internal
 */
export interface PlanRunwayMeasurement {
  readonly planAlias: string;
  readonly observedAtIso: string;
  readonly resetAtIso: string;
  readonly utilization: number;
  /** The week's effective ceiling, 0..1: the house cap, or the plan's usage limit where that is lower. */
  readonly spendCap: number;
  readonly hoursToReset: number;
  readonly sustainablePlanWeeksPerHour: number;
}

/** One configured Claude plan as the ceiling needs it: its alias and the usage policy the owner set on it. */
export interface SeatCeilingPlan {
  readonly alias: string;
  readonly allowance: PlanAllowance;
  readonly usageLimitPercent: UsageLimitPercent;
}

/** How many working seats the plans carry until their resets, or why that is unknown. */
export type WorkingSeatCeiling =
  | {
      readonly kind: "measured";
      readonly seats: number;
      readonly sustainablePlanWeeksPerHour: number;
      readonly burnPerWorkingSeatHour: number;
      readonly plans: readonly PlanRunwayMeasurement[];
    }
  | { readonly kind: "unmeasurable"; readonly reason: string };

/** The whole report. */
export interface FleetCeilingReport {
  readonly fromIso: string;
  readonly toIso: string;
  /** The configured, unpaused Claude plans the report is about. */
  readonly planAliases: readonly string[];
  readonly unusedByPlan: readonly PlanUnusedMeasurement[];
  /** Plan-weeks observed resetting inside the span — the denominator of {@link combinedUnusedShareUpperBound}. */
  readonly observedExpiredPlanWeeks: number;
  readonly unusedPlanWeeksUpperBound: number | null;
  readonly combinedUnusedShareUpperBound: number | null;
  readonly seats: SeatHistoryMeasurement;
  readonly burn: SeatBurnMeasurement;
  readonly ceiling: WorkingSeatCeiling;
  /** What a reader could not read: a journal, a tick line, an instant. A failure, never a coverage gap. */
  readonly problems: readonly string[];
  /**
   * Plans whose weekly window did not reset inside the span, one sentence per plan. A coverage gap, not a
   * failure: a plan newer than its first reset reads here, and the others are still counted without it. A
   * monthly-spend plan reads here too, first: it is judged in dollars, never on weekly windows, so it is neither burn
   * nor runway, and like a new plan it is a gap the page discloses rather than a reader that failed.
   */
  readonly uncountedPlans: readonly string[];
}

/** Each plan's seven-day windows that reset in the span, from `measureUnusedCapacity`. */
function unusedByPlanOf({
  samples,
  aliases,
  fromIso,
  toIso,
}: {
  samples: readonly DrawdownSample[];
  aliases: readonly string[];
  fromIso: string;
  toIso: string;
}): readonly PlanUnusedMeasurement[] {
  const weekly: PlanWindowSample[] = samples
    .filter((sample) => sample.window === "seven-day")
    .map((sample) => ({
      ceilingId: `claude:${sample.planAlias}`,
      observedAtIso: sample.observedAtIso,
      resetAtIso: sample.resetAtIso,
      usedPct: sample.utilization * 100,
      window: sample.window,
    }));
  const report = measureUnusedCapacity({ fromIso, loadHold: 1, problems: [], samples: weekly, ticks: [], toIso });
  return aliases.map((planAlias) => {
    const window = report.windows.find((measured) => measured.ceilingId === `claude:${planAlias}`);
    if (window?.unusedAtResetPct == null) {
      return {
        expiredWindows: 0,
        planAlias,
        unusedPlanWeeksUpperBound: null,
        widestLastReadingToResetSeconds: null,
      };
    }
    return {
      expiredWindows: window.expiredWindows,
      planAlias,
      unusedPlanWeeksUpperBound: (window.expiredWindows * window.unusedAtResetPct) / 100,
      widestLastReadingToResetSeconds: window.widestLastReadingToResetSeconds,
    };
  });
}

/**
 * The samples observed at or before `nowMs`, each instant re-spelled in UTC, because the newest-reading pick
 * downstream orders by string: an offset spelling would otherwise outrank a later UTC one.
 */
function currentSamplesOf({
  samples,
  nowMs,
}: {
  samples: readonly DrawdownSample[];
  nowMs: number;
}): readonly DrawdownSample[] {
  const current: DrawdownSample[] = [];
  for (const sample of samples) {
    const observedMs = parseIsoMs({ tsIso: sample.observedAtIso });
    const resetMs = parseIsoMs({ tsIso: sample.resetAtIso });
    if (observedMs !== undefined && resetMs !== undefined && observedMs <= nowMs) {
      current.push({
        ...sample,
        observedAtIso: new Date(observedMs).toISOString(),
        resetAtIso: new Date(resetMs).toISOString(),
      });
    }
  }
  return current;
}

/** One placed plan's weekly runway: its spend cap at the install's thresholds and its own usage limit. */
function runwayOf({
  nowMs,
  state,
  thresholds,
}: {
  nowMs: number;
  state: SurvivalPlanState;
  thresholds: ClaudeThresholds;
}): PlanRunwayMeasurement {
  const { utilization: spendCap } = claudeEffectiveUsageCeiling({
    claim: "seven_day",
    observedAtIso: state.observedAtIso,
    resetAtIso: state.resetAtIso,
    thresholds,
    usageLimitPercent: state.usageLimitPercent,
  });
  const hoursToReset = (parseIsoMs({ tsIso: state.resetAtIso })! - nowMs) / HOUR_MS;
  return {
    hoursToReset,
    observedAtIso: state.observedAtIso,
    planAlias: state.alias,
    resetAtIso: state.resetAtIso,
    spendCap,
    sustainablePlanWeeksPerHour: Math.max(0, spendCap - state.utilization) / hoursToReset,
    utilization: state.utilization,
  };
}

/** How many working seats the plans' remaining weekly headroom sustains until each resets. */
function ceilingOf({
  samples,
  configured,
  burn,
  thresholds,
  toIso,
}: {
  samples: readonly DrawdownSample[];
  configured: readonly SeatCeilingPlan[];
  burn: SeatBurnMeasurement;
  thresholds: ClaudeThresholds;
  toIso: string;
}): WorkingSeatCeiling {
  if (burn.kind === "unmeasurable") {
    return { kind: "unmeasurable", reason: `the burn per working seat is unknown because ${burn.reason}` };
  }
  const nowMs = parseIsoMs({ tsIso: toIso })!;
  const placed = planStatesFromSamples({
    nowIso: toIso,
    plans: configured,
    samples: currentSamplesOf({ nowMs, samples }),
    thresholds,
  });
  if ("because" in placed) {
    return { kind: "unmeasurable", reason: placed.because };
  }
  // Each placed state carries its own plan's usage limit, copied off `configured` by `planStatesFromSamples`.
  const plans = placed.states.map((state) => runwayOf({ nowMs, state, thresholds }));
  const sustainablePlanWeeksPerHour = plans.reduce((sum, plan) => sum + plan.sustainablePlanWeeksPerHour, 0);
  const seats = Math.floor(sustainablePlanWeeksPerHour / burn.planWeeksPerWorkingSeatHour);
  if (!Number.isFinite(seats)) {
    return { kind: "unmeasurable", reason: "the burn per working seat is too small to divide the plans' headroom by" };
  }
  return {
    burnPerWorkingSeatHour: burn.planWeeksPerWorkingSeatHour,
    kind: "measured",
    plans,
    seats,
    sustainablePlanWeeksPerHour,
  };
}

/** The plans observed resetting, their plan-weeks, and the unused upper bound summed over them. */
function unusedTotalsOf({ unusedByPlan }: { unusedByPlan: readonly PlanUnusedMeasurement[] }): {
  readonly observedExpiredPlanWeeks: number;
  readonly unusedPlanWeeksUpperBound: number | null;
  readonly combinedUnusedShareUpperBound: number | null;
} {
  const observed = unusedByPlan.filter((plan) => plan.unusedPlanWeeksUpperBound !== null);
  const observedExpiredPlanWeeks = observed.reduce((sum, plan) => sum + plan.expiredWindows, 0);
  if (observed.length === 0) {
    return { combinedUnusedShareUpperBound: null, observedExpiredPlanWeeks, unusedPlanWeeksUpperBound: null };
  }
  const unusedPlanWeeksUpperBound = observed.reduce((sum, plan) => sum + plan.unusedPlanWeeksUpperBound!, 0);
  return {
    combinedUnusedShareUpperBound: unusedPlanWeeksUpperBound / observedExpiredPlanWeeks,
    observedExpiredPlanWeeks,
    unusedPlanWeeksUpperBound,
  };
}

/**
 * Measure what the Claude plans left unused over a span, the seats that ran, and the working seats the plans
 * carry from the span's end until their resets.
 *
 * @param samples every drawdown journal sample, any window, any order
 * @param ticks every supervisor tick's seat counts, any order
 * @param plans the configured, unpaused Claude plans with their usage policy — a paused plan is neither burn nor
 *   runway, and a monthly-spend one is left out of both with a problem line, since nothing here measures it
 * @param fromIso the span's start
 * @param toIso the span's end, which is also "now" for the ceiling
 * @param problems what the readers already could not see, carried through
 * @param thresholds the install's Claude thresholds, which set each plan's spend cap
 * @returns the report, or why the span itself is unusable
 */
export function measureFleetCeiling({
  samples,
  ticks,
  plans,
  fromIso,
  toIso,
  problems,
  thresholds,
}: {
  samples: readonly DrawdownSample[];
  ticks: readonly SeatTickSample[];
  plans: readonly SeatCeilingPlan[];
  fromIso: string;
  toIso: string;
  problems: readonly string[];
  thresholds: ClaudeThresholds;
}): Result<FleetCeilingReport> {
  const fromMs = parseIsoMs({ tsIso: fromIso });
  const toMs = parseIsoMs({ tsIso: toIso });
  if (fromMs === undefined || toMs === undefined || toMs <= fromMs) {
    return err([`the span ${fromIso} → ${toIso} is not two ISO instants in order`]);
  }
  const configured = plans.filter((plan) => plan.allowance.kind === "weekly-window");
  const notMeasured = plans
    .filter((plan) => plan.allowance.kind !== "weekly-window")
    .map(
      (plan) =>
        `${plan.alias}: a monthly-spend plan is judged in dollars, never weekly windows, so it is neither burn nor runway here`,
    );
  const aliases = configured.map((plan) => plan.alias);
  const timed = timedTicksOf({ ticks, toMs });
  const unusedByPlan = unusedByPlanOf({ aliases, fromIso, samples, toIso });
  const uncountedPlans = unusedByPlan
    .filter((plan) => plan.unusedPlanWeeksUpperBound === null)
    .map((plan) => `${plan.planAlias}: no weekly window was observed resetting in the span, so it is not counted`);
  const seatIntervals = seatIntervalsOf({ fromMs, ticks: timed.timed, toMs });
  const burn = burnOf({ aliases, fromMs, samples: weeklySamplesOf({ samples, toMs }), seatIntervals, toMs });
  return ok({
    ...unusedTotalsOf({ unusedByPlan }),
    burn,
    ceiling: ceilingOf({ burn, configured, samples, thresholds, toIso }),
    fromIso,
    planAliases: aliases,
    problems: [...problems, ...timed.problems],
    seats: seatHistoryOf({ fromMs, intervals: seatIntervals, ticks: timed.timed, toMs }),
    toIso,
    uncountedPlans: [...notMeasured, ...uncountedPlans],
    unusedByPlan,
  });
}
