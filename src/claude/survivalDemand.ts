/**
 * What the fleet drew, read off the drawdown journal: the demand `./survivalForecast.ts` runs the fleet at.
 * Pure: samples in, figures out.
 *
 * ## Demand is SERVED demand, so it is a floor
 *
 * The journal records what the plans gave, not what the fleet wanted. An hour in which every plan read at
 * its cap hid whatever demand arrived in it, so {@link FleetDemand.censoredHours} counts those hours and the
 * render says the figure is a lower bound whenever one is present. Each cycle's OPENING draw — the spend
 * between a reset and the first sample after it, which `drawdownRates` cannot see because it only pairs
 * samples inside one reset — is added as a delta from zero.
 *
 * ## A misread alias is dropped before anything is measured
 *
 * Three times an alias read ANOTHER account for a day or so, carrying that account's reset clock and its
 * numbers. Left in, each series counts the other plan's draw twice: it was the whole of the 3-hour spells that
 * an affected forecast showed. Every plan's week resets at its own instant, so two aliases
 * sharing one window's reset instant is one account read twice, and the alias with fewer samples on it is the
 * misread one ({@link withoutMisreadSeries}). Repro, the three pairs it drops (fewer samples first):
 * `jq -r 'select(.window=="seven-day")|"\(.resetAtIso) \(.planAlias)"' ~/.slopweaver/claude-accounts/drawdown.jsonl | sort | uniq -c`
 * — each line is a reset instant shared by two aliases, such as plan-one/plan-four, plan-four/plan-one and
 * plan-five/plan-one.
 */
import type { ClaudeThresholds } from "../plans/thresholds.js";
import type { UsageLimitPercent } from "../plans/usageLimit.js";
import type { DrawdownSample } from "./drawdownAnomaly.js";
import { drawdownRates } from "./drawdownAnomaly.js";
import { claudeEffectiveUsageCeiling } from "./select.js";

/** One plan the censor test asks: its alias, and the usage limit its cap sits at where that is under the house bar. */
export interface CensorPlan {
  readonly alias: string;
  readonly usageLimitPercent: UsageLimitPercent;
}

/** What the fleet drew over the trailing window, in plan-weeks. */
export interface FleetDemand {
  readonly fromIso: string;
  readonly toIso: string;
  /** Mean draw across the window. */
  readonly planWeeksPerHour: number;
  /** The heaviest whole UTC day inside the window, as a per-hour rate. */
  readonly peakPlanWeeksPerHour: number;
  readonly peakDay: string | undefined;
  /** Hours in the window when every plan read at its cap, hiding whatever demand arrived. */
  readonly censoredHours: number;
}

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
const WEEK_MS = 7 * DAY_MS;
/** Five hours, the span one five-hour window covers. */
const FIVE_HOURS = 5;
/** A cycle's first sample within this of its opening is an opening draw; the watch ticks every five minutes. */
const OPENING_GRACE_MS = HOUR_MS;

/** A sample's instant, epoch milliseconds. */
function msOf({ iso }: { iso: string }): number {
  return Date.parse(iso);
}

/** One alias's seven-day series on one reset instant: how many samples, and the span they were read over. */
interface SeriesSpan {
  readonly alias: string;
  count: number;
  fromIso: string;
  toIso: string;
}

/** Every alias's seven-day series, grouped by the reset instant it reads, each widened over every sample. */
function weeklySpansByReset({
  samples,
}: {
  samples: readonly DrawdownSample[];
}): ReadonlyMap<string, ReadonlyMap<string, SeriesSpan>> {
  const byReset = new Map<string, Map<string, SeriesSpan>>();
  for (const sample of samples.filter((candidate) => candidate.window === "seven-day")) {
    let byAlias = byReset.get(sample.resetAtIso);
    if (byAlias === undefined) {
      byAlias = new Map<string, SeriesSpan>();
      byReset.set(sample.resetAtIso, byAlias);
    }
    const held = byAlias.get(sample.planAlias);
    if (held === undefined) {
      byAlias.set(sample.planAlias, {
        alias: sample.planAlias,
        count: 1,
        fromIso: sample.observedAtIso,
        toIso: sample.observedAtIso,
      });
    } else {
      widenSpan({ atIso: sample.observedAtIso, span: held });
    }
  }
  return byReset;
}

/** Count one more sample into a span, and stretch it to cover that sample's instant. */
function widenSpan({ span, atIso }: { span: SeriesSpan; atIso: string }): void {
  span.count += 1;
  if (atIso < span.fromIso) {
    span.fromIso = atIso;
  }
  if (atIso > span.toIso) {
    span.toIso = atIso;
  }
}

/**
 * The journal with every misread alias's readings removed.
 *
 * Where two aliases carry a seven-day series on the same reset instant, the alias with the most samples on it
 * owns that account; every other alias's samples in ANY window, over the span its copy was read, are dropped,
 * because the five-hour and Fable readings of that span came off the same wrong account. Only the weekly
 * window is compared: five-hour resets are shared by genuine accounts every day. Two genuine accounts whose
 * weeks reset in the same hour would read as one, so the loser is `unmeasurable`, never forecast wrong.
 *
 * @param samples journal samples
 * @returns the same samples, less each span an alias read off another's account
 */
export function withoutMisreadSeries({ samples }: { samples: readonly DrawdownSample[] }): readonly DrawdownSample[] {
  const misread = [...weeklySpansByReset({ samples }).values()].flatMap((byAlias) =>
    [...byAlias.values()]
      .toSorted((left, right) => right.count - left.count || left.alias.localeCompare(right.alias))
      .slice(1),
  );
  return samples.filter(
    (sample) =>
      !misread.some(
        (span) =>
          span.alias === sample.planAlias && sample.observedAtIso >= span.fromIso && sample.observedAtIso <= span.toIso,
      ),
  );
}

/**
 * Sum of positive same-reset deltas of one window, per plan, plus each cycle's opening draw.
 *
 * @param samples journal samples, every window
 * @param window which window's draw to total
 * @returns each plan's total draw in that window, as a fraction of the window
 */
export function drawByPlan({
  samples,
  window,
}: {
  samples: readonly DrawdownSample[];
  window: DrawdownSample["window"];
}): ReadonlyMap<string, number> {
  const ofWindow = samples.filter((sample) => sample.window === window);
  const totals = new Map<string, number>();
  for (const rate of drawdownRates({ samples: ofWindow })) {
    addInto({ amount: rate.utilizationDelta, key: rate.planAlias, totals });
  }
  for (const opening of openingSamples({ samples: ofWindow })) {
    addInto({ amount: opening.utilization, key: opening.planAlias, totals });
  }
  return totals;
}

/** Add to a running total, where a key not yet seen has drawn nothing — absence here is zero by design. */
function addInto({ totals, key, amount }: { totals: Map<string, number>; key: string; amount: number }): void {
  const held = totals.get(key);
  if (held === undefined) {
    totals.set(key, amount);
    return;
  }
  totals.set(key, held + amount);
}

/**
 * The first sample of each plan-reset series, kept only when the watch read it within
 * {@link OPENING_GRACE_MS} of the cycle opening. A series first seen mid-cycle — the journal started, or a
 * trailing window cut in — carries draw from before it was watched, which is not an opening.
 */
function openingSamples({ samples }: { samples: readonly DrawdownSample[] }): readonly DrawdownSample[] {
  const first = new Map<string, DrawdownSample>();
  for (const sample of samples) {
    const key = `${sample.planAlias} ${sample.resetAtIso}`;
    const held = first.get(key);
    if (held === undefined || sample.observedAtIso < held.observedAtIso) {
      first.set(key, sample);
    }
  }
  const cycleSpan = new Map<string, number>([
    ["five-hour", FIVE_HOURS * HOUR_MS],
    ["seven-day", WEEK_MS],
    ["fable-seven-day", WEEK_MS],
  ]);
  return [...first.values()].filter((sample) => {
    const openedMs = msOf({ iso: sample.resetAtIso }) - cycleSpan.get(sample.window)!;
    return msOf({ iso: sample.observedAtIso }) - openedMs <= OPENING_GRACE_MS;
  });
}

/**
 * Measure the fleet's seven-day draw over the window ending at `nowIso`.
 *
 * @param samples every journal sample at or before `nowIso`
 * @param nowIso the window's end
 * @param windowMs how far back the window reaches
 * @param plans the plans whose simultaneous cap marks an hour censored, each with its own usage limit
 * @param thresholds the install's Claude thresholds, which set the house bar each limit may lower
 * @returns the mean and peak draw, and the hours whose demand the caps hid
 */
export function measureDemand({
  samples,
  nowIso,
  windowMs,
  plans,
  thresholds,
}: {
  samples: readonly DrawdownSample[];
  nowIso: string;
  windowMs: number;
  plans: readonly CensorPlan[];
  thresholds: ClaudeThresholds;
}): FleetDemand {
  const nowMs = msOf({ iso: nowIso });
  const fromMs = nowMs - windowMs;
  const inWindow = samples.filter(
    (sample) => sample.window === "seven-day" && msOf({ iso: sample.observedAtIso }) >= fromMs,
  );
  const byDay = new Map<string, number>();
  let total = 0;
  for (const rate of drawdownRates({ samples: inWindow })) {
    total += rate.utilizationDelta;
    addInto({ amount: rate.utilizationDelta, key: rate.toIso.slice(0, 10), totals: byDay });
  }
  for (const opening of openingSamples({ samples: inWindow })) {
    total += opening.utilization;
    // The opening draw is spent inside the hour after a reset, so it belongs to the day that hour falls in.
    addInto({ amount: opening.utilization, key: opening.observedAtIso.slice(0, 10), totals: byDay });
  }
  const wholeDays = [...byDay.entries()].filter(([day]) => {
    const dayMs = msOf({ iso: `${day}T00:00:00.000Z` });
    return dayMs >= fromMs && dayMs + DAY_MS <= nowMs;
  });
  const peak = wholeDays.toSorted((left, right) => right[1] - left[1])[0];
  return {
    censoredHours: censoredHours({ plans, samples: inWindow, thresholds }),
    fromIso: new Date(fromMs).toISOString(),
    peakDay: peak === undefined ? undefined : peak[0],
    peakPlanWeeksPerHour: peak === undefined ? 0 : peak[1] / 24,
    planWeeksPerHour: total / (windowMs / HOUR_MS),
    toIso: nowIso,
  };
}

/**
 * Hours in which every plan's NEWEST seven-day sample of the hour read at its own cap — its effective ceiling, the
 * house bar lowered to its usage limit, exactly as `claudeEffectiveUsageCeiling` judges a spawn. So an unlimited plan
 * caps at the route bar, or the spend-out bar in the week's final hours, and a 50% plan caps at 50%.
 *
 * @param samples seven-day samples in the window
 * @param plans the plans that must all be capped
 * @param thresholds the install's Claude thresholds, which set the house bar each limit may lower
 * @returns how many hours hid demand
 */
function censoredHours({
  samples,
  plans,
  thresholds,
}: {
  samples: readonly DrawdownSample[];
  plans: readonly CensorPlan[];
  thresholds: ClaudeThresholds;
}): number {
  const newestByHour = new Map<string, Map<string, DrawdownSample>>();
  for (const sample of samples.filter((candidate) => candidate.window === "seven-day")) {
    const hour = sample.observedAtIso.slice(0, 13);
    const byAlias = newestByHour.get(hour);
    if (byAlias === undefined) {
      newestByHour.set(hour, new Map([[sample.planAlias, sample]]));
      continue;
    }
    const held = byAlias.get(sample.planAlias);
    if (held === undefined || sample.observedAtIso > held.observedAtIso) {
      byAlias.set(sample.planAlias, sample);
    }
  }
  const atCap = ({ sample, plan }: { sample: DrawdownSample; plan: CensorPlan }): boolean =>
    sample.utilization >=
    claudeEffectiveUsageCeiling({
      claim: "seven_day",
      observedAtIso: sample.observedAtIso,
      resetAtIso: sample.resetAtIso,
      thresholds,
      usageLimitPercent: plan.usageLimitPercent,
    }).utilization;
  return [...newestByHour.values()].filter((byAlias) =>
    plans.every((plan) => {
      const sample = byAlias.get(plan.alias);
      return sample !== undefined && atCap({ plan, sample });
    }),
  ).length;
}
