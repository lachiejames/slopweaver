/**
 * When the fleet starts drawing a plan down far faster than it normally does — the signal behind "our usage
 * is going nuts", computed from readings this machine already takes.
 *
 * ## The signal is the PLAN, not the token count, and that is a measurement rather than a preference
 *
 * The watch fires when usage runs ten times its own prior-week baseline, because of a real incident: the
 * owner hit Claude session limits twice inside 12 hours after months of hitting none.
 *
 * The obvious reading — fleet token spend against its own weekly baseline — CANNOT FIRE. MEASURED
 * across 492 hours of model-weighted notional spend: **zero hours exceeded 10x the median
 * hour, zero exceeded even 5x**, the largest hour was 3.3x the median, and daily spend never passed 1.68x
 * its own prior-seven-day median. The incident is inside that window and produced no spend spike at all,
 * because the fleet's token draw rose steadily rather than sharply. A detector built on it would be a check
 * that cannot fail, which this repository treats as worse than no check.
 *
 * What DID happen is that a plan's five-hour window was exhausted repeatedly. So the signal is the provider's
 * own rate-limit utilization, which `./usage.ts` already parses off every gauge probe — and 10x is entirely
 * plausible there, because a window's utilization can go from a trickle to exhausted inside one hour.
 *
 * ## Rates, not levels — and never across a reset
 *
 * `./fleetAlert.ts` already answers the LEVEL question ("which plan is about to close", at 75%). This answers
 * the RATE question, which is a different one: a plan at 60% climbing slowly is fine, and a plan at 30%
 * climbing tenfold is the thing the owner wants investigated before it closes.
 *
 * A rate is only meaningful between two samples of the SAME plan, the SAME window, and the same `resetAtIso`.
 * Bridging a reset would compute a large negative slope and then, worse, a vast positive one on the next
 * pair — so a pair that does not share a reset instant is not a rate at all rather than a rate of zero.
 *
 * Pure: samples in, a verdict out. The journal and the spawn live in `./drawdownJournal.ts` and
 * `./drawdownTick.ts`.
 */
import { pushInto } from "#lib/collections.js";
import type { ClaudeAccountGauge, ClaudeWindowReading } from "./contracts.js";

/** Which of a plan's windows a sample describes. */
export type DrawdownWindow = "five-hour" | "seven-day" | "fable-seven-day";

/**
 * How much history the baseline is standing on. A `warming` baseline never fires.
 *
 * @internal — reachable through {@link DrawdownBaseline}; nothing imports it by name.
 */
export type DrawdownBaselineMaturity = "warming" | "provisional" | "ready";

/** One window's utilization at one instant, as a journal row. */
export interface DrawdownSample {
  readonly kind: "sample";
  readonly schemaVersion: 1;
  readonly planAlias: string;
  readonly window: DrawdownWindow;
  readonly observedAtIso: string;
  /** The window's reset instant — the key that stops a rate being computed across a reset. */
  readonly resetAtIso: string;
  /** Fraction spent, 0..1, exactly as the provider header carries it. */
  readonly utilization: number;
}

/** Every number the detector can be tuned by, so none of them is buried in the algorithm. */
export interface DrawdownPolicy {
  /** How far back the baseline pools rates from. */
  readonly baselineWindowMs: number;
  /** How much of the RECENT past is withheld, so a live episode cannot train the baseline it is judged against. */
  readonly baselineExclusionMs: number;
  /** Below this span of history the baseline is `warming` and never fires. */
  readonly minimumBaselineSpanMs: number;
  /**
   * The span at which a baseline is `ready` rather than `provisional`.
   *
   * Deliberately SHORTER than {@link DrawdownPolicy.baselineWindowMs}: the pooled rates are already filtered
   * to that window, so the span between the oldest and newest of them can never reach its full width, and a
   * ready rule written as "span >= window" would be a state nothing could ever enter.
   */
  readonly readyBaselineSpanMs: number;
  /** Below this many positive rates the baseline is `warming` and never fires. */
  readonly minimumPositiveRates: number;
  /** How many times the baseline median a rate must reach to be a candidate. The owner's number: 10. */
  readonly ratioThreshold: number;
  /** How many consecutive candidate intervals make an incident, so one odd sample cannot fire it. */
  readonly consecutiveCandidateRates: number;
}

/**
 * The shipped policy.
 *
 * `ratioThreshold` is the owner's 10x, kept because the signal it now sits on can actually reach it. The rest is
 * shaped by what the baseline measurement showed: a 30-minute exclusion because an episode that has been
 * running half an hour would otherwise start raising its own baseline, and two consecutive intervals because
 * a single probe pair straddling a burst is a spike in the sampling rather than in the drawdown.
 */
export const DEFAULT_DRAWDOWN_POLICY: DrawdownPolicy = {
  baselineExclusionMs: 30 * 60 * 1000,
  baselineWindowMs: 7 * 24 * 60 * 60 * 1000,
  consecutiveCandidateRates: 2,
  minimumBaselineSpanMs: 24 * 60 * 60 * 1000,
  minimumPositiveRates: 12,
  ratioThreshold: 10,
  readyBaselineSpanMs: 6 * 24 * 60 * 60 * 1000,
};

/** One measured slope between two adjacent samples of one window. */
export interface DrawdownRate {
  readonly planAlias: string;
  readonly window: DrawdownWindow;
  readonly resetAtIso: string;
  readonly fromIso: string;
  readonly toIso: string;
  readonly utilizationDelta: number;
  readonly fractionPerHour: number;
}

/** What normal looks like for one window type, and how much history says so. */
export interface DrawdownBaseline {
  readonly window: DrawdownWindow;
  readonly maturity: DrawdownBaselineMaturity;
  readonly spanMs: number;
  readonly positiveRates: number;
  readonly medianFractionPerHour: number | undefined;
  readonly p95FractionPerHour: number | undefined;
  readonly maximumFractionPerHour: number | undefined;
}

/** One window of one plan, drawing down far faster than its own normal. */
export interface DrawdownTrigger {
  readonly planAlias: string;
  readonly window: DrawdownWindow;
  readonly resetAtIso: string;
  readonly ratio: number;
  readonly currentFractionPerHour: number;
  readonly baselineFractionPerHour: number;
  readonly maturity: Exclude<DrawdownBaselineMaturity, "warming">;
}

/** One episode worth investigating, however many windows it shows up in. */
export interface DrawdownIncident {
  readonly incidentId: string;
  readonly observedAtIso: string;
  readonly triggers: readonly DrawdownTrigger[];
}

/** Everything one evaluation resolved. */
export interface DrawdownEvaluation {
  readonly baselines: readonly DrawdownBaseline[];
  readonly incident: DrawdownIncident | undefined;
  readonly latestSampleAtIso: string | undefined;
}

/** The three windows a gauge can carry, in the order a report prints them. */
const WINDOWS: readonly DrawdownWindow[] = ["five-hour", "seven-day", "fable-seven-day"];

/** One gauge window as a sample, or nothing when the probe did not read that window. */
function sampleOf({
  alias,
  observedAtIso,
  window,
  reading,
}: {
  alias: string;
  observedAtIso: string;
  window: DrawdownWindow;
  reading: ClaudeWindowReading | undefined;
}): DrawdownSample | undefined {
  if (reading === undefined) {
    return undefined;
  }
  return {
    kind: "sample",
    observedAtIso,
    planAlias: alias,
    resetAtIso: reading.resetAtIso,
    schemaVersion: 1,
    utilization: reading.utilization,
    window,
  };
}

/**
 * Turn a tick's gauges into journal samples.
 *
 * The Fable window is absent whenever the probe did not ask for a Fable model, and that absence is a
 * legitimate reading rather than a zero — so it produces no sample rather than a sample of zero, which would
 * otherwise look like a whole unspent Fable week.
 *
 * @param gauges the readings this tick took
 * @returns one sample per plan per window actually read
 */
export function drawdownSamples({ gauges }: { gauges: readonly ClaudeAccountGauge[] }): readonly DrawdownSample[] {
  return gauges.flatMap((gauge) =>
    [
      sampleOf({
        alias: gauge.alias,
        observedAtIso: gauge.observedAtIso,
        reading: gauge.fiveHour,
        window: "five-hour",
      }),
      sampleOf({
        alias: gauge.alias,
        observedAtIso: gauge.observedAtIso,
        reading: gauge.sevenDay,
        window: "seven-day",
      }),
      sampleOf({
        alias: gauge.alias,
        observedAtIso: gauge.observedAtIso,
        reading: gauge.sevenDayFable,
        window: "fable-seven-day",
      }),
    ].filter((sample): sample is DrawdownSample => sample !== undefined),
  );
}

/** A sample's instant in milliseconds, or `undefined` when it does not parse. */
function instantOf({ iso }: { iso: string }): number | undefined {
  const parsed = Date.parse(iso);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/**
 * The positive slopes between adjacent samples of one plan-window-reset series.
 *
 * Only RISING deltas become rates. A flat interval says the fleet spent nothing, which is real but tells the
 * detector nothing about pace, and a falling one can only mean a reset the `resetAtIso` key did not catch.
 *
 * @param samples every sample available, in any order
 * @returns one rate per adjacent rising pair
 */
export function drawdownRates({ samples }: { samples: readonly DrawdownSample[] }): readonly DrawdownRate[] {
  const series = new Map<string, DrawdownSample[]>();
  for (const sample of samples) {
    pushInto({ buckets: series, key: `${sample.planAlias} ${sample.window} ${sample.resetAtIso}`, value: sample });
  }
  const rates: DrawdownRate[] = [];
  for (const group of series.values()) {
    const ordered = group.toSorted((left, right) => left.observedAtIso.localeCompare(right.observedAtIso));
    for (let index = 1; index < ordered.length; index += 1) {
      const previous = ordered[index - 1]!;
      const current = ordered[index]!;
      const from = instantOf({ iso: previous.observedAtIso });
      const to = instantOf({ iso: current.observedAtIso });
      if (from === undefined || to === undefined || to <= from) {
        continue;
      }
      const delta = current.utilization - previous.utilization;
      if (delta <= 0) {
        continue;
      }
      rates.push({
        fractionPerHour: delta / ((to - from) / 3_600_000),
        fromIso: previous.observedAtIso,
        planAlias: current.planAlias,
        resetAtIso: current.resetAtIso,
        toIso: current.observedAtIso,
        utilizationDelta: delta,
        window: current.window,
      });
    }
  }
  return rates;
}

/** The value at a quantile of an already-sorted list. */
function quantileOf({ sorted, fraction }: { sorted: readonly number[]; fraction: number }): number | undefined {
  if (sorted.length === 0) {
    return undefined;
  }
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))];
}

/** How much history a set of rates spans. */
function spanOf({ rates }: { rates: readonly DrawdownRate[] }): number {
  const instants = rates
    .map((rate) => instantOf({ iso: rate.toIso }))
    .filter((instant): instant is number => instant !== undefined);
  if (instants.length === 0) {
    return 0;
  }
  return Math.max(...instants) - Math.min(...instants);
}

/** Which maturity a pooled baseline has earned. */
function maturityOf({
  spanMs,
  positiveRates,
  policy,
}: {
  spanMs: number;
  positiveRates: number;
  policy: DrawdownPolicy;
}): DrawdownBaselineMaturity {
  if (spanMs < policy.minimumBaselineSpanMs || positiveRates < policy.minimumPositiveRates) {
    return "warming";
  }
  if (spanMs < policy.readyBaselineSpanMs) {
    return "provisional";
  }
  return "ready";
}

/**
 * What normal looks like for one window type, pooled across every plan.
 *
 * Pooled rather than per-plan on purpose: a plan the fleet has only just started using has no history of its
 * own, and the question "is this pace unusual" is answered perfectly well by what the other plans do.
 *
 * @param window the window type to describe
 * @param rates every rate inside the baseline period for that window
 * @param policy the tuning in force
 * @returns the baseline
 */
export function drawdownBaseline({
  window,
  rates,
  policy = DEFAULT_DRAWDOWN_POLICY,
}: {
  window: DrawdownWindow;
  rates: readonly DrawdownRate[];
  policy?: DrawdownPolicy;
}): DrawdownBaseline {
  const values = rates.map((rate) => rate.fractionPerHour).toSorted((left, right) => left - right);
  const spanMs = spanOf({ rates });
  return {
    maturity: maturityOf({ policy, positiveRates: values.length, spanMs }),
    maximumFractionPerHour: values.at(-1),
    medianFractionPerHour: quantileOf({ fraction: 0.5, sorted: values }),
    p95FractionPerHour: quantileOf({ fraction: 0.95, sorted: values }),
    positiveRates: values.length,
    spanMs,
    window,
  };
}

/** A stable id for one episode, so a journal can suppress a second spawn for the same thing. */
function incidentIdOf({ triggers }: { triggers: readonly DrawdownTrigger[] }): string {
  return triggers
    .map((trigger) => `${trigger.planAlias}:${trigger.window}:${trigger.resetAtIso}`)
    .toSorted()
    .join("|");
}

/**
 * Every window of every plan drawing down far faster than this baseline's normal.
 *
 * Split out of {@link evaluateDrawdown} so the candidate rule — newest intervals, all past the threshold,
 * the newest one current — reads as the single decision it is.
 *
 * @param baseline what normal looks like for this window type
 * @param allRates every rate computed this pass
 * @param baselineCeiling the instant past which a rate counts as CURRENT rather than as history
 * @param policy the tuning in force
 * @returns one trigger per plan-window-reset series that qualifies
 */
function triggersFor({
  baseline,
  allRates,
  baselineCeiling,
  policy,
}: {
  baseline: DrawdownBaseline;
  allRates: readonly DrawdownRate[];
  baselineCeiling: number;
  policy: DrawdownPolicy;
}): readonly DrawdownTrigger[] {
  const median = baseline.medianFractionPerHour;
  if (baseline.maturity === "warming" || median === undefined || median <= 0) {
    return [];
  }
  const byPlan = new Map<string, DrawdownRate[]>();
  for (const rate of allRates) {
    if (rate.window !== baseline.window) {
      continue;
    }
    pushInto({ buckets: byPlan, key: `${rate.planAlias} ${rate.resetAtIso}`, value: rate });
  }
  const triggers: DrawdownTrigger[] = [];
  for (const group of byPlan.values()) {
    const ordered = group.toSorted((left, right) => left.toIso.localeCompare(right.toIso));
    const tail = ordered.slice(-policy.consecutiveCandidateRates);
    if (tail.length < policy.consecutiveCandidateRates) {
      continue;
    }
    // The exclusion window bounds the BASELINE, never the candidate set. With a sampling interval as long as
    // the exclusion, at most one interval could ever sit past the ceiling, so requiring two of them there
    // would make this unable to fire at all — the check-that-cannot-fail this module exists to avoid. The
    // candidates are simply the newest intervals; only the newest has to be current.
    const newest = tail.at(-1)!;
    const newestAt = instantOf({ iso: newest.toIso });
    if (newestAt === undefined || newestAt <= baselineCeiling) {
      continue;
    }
    if (!tail.every((rate) => rate.fractionPerHour >= policy.ratioThreshold * median)) {
      continue;
    }
    triggers.push({
      baselineFractionPerHour: median,
      currentFractionPerHour: newest.fractionPerHour,
      maturity: baseline.maturity,
      planAlias: newest.planAlias,
      ratio: newest.fractionPerHour / median,
      resetAtIso: newest.resetAtIso,
      window: baseline.window,
    });
  }
  return triggers;
}

/**
 * Judge the current pace against the baseline.
 *
 * @param history every sample already journalled
 * @param current this tick's samples, not yet journalled
 * @param nowIso the instant the baseline window is measured back from
 * @param policy the tuning in force
 * @returns the baselines, and the incident when there is one
 */
export function evaluateDrawdown({
  history,
  current,
  nowIso,
  policy = DEFAULT_DRAWDOWN_POLICY,
}: {
  history: readonly DrawdownSample[];
  current: readonly DrawdownSample[];
  nowIso: string;
  policy?: DrawdownPolicy;
}): DrawdownEvaluation {
  const now = instantOf({ iso: nowIso }) ?? 0;
  const everything = [...history, ...current];
  const allRates = drawdownRates({ samples: everything });
  const baselineFloor = now - policy.baselineWindowMs;
  const baselineCeiling = now - policy.baselineExclusionMs;
  const baselines = WINDOWS.map((window) =>
    drawdownBaseline({
      policy,
      rates: allRates.filter((rate) => {
        const at = instantOf({ iso: rate.toIso });
        return rate.window === window && at !== undefined && at >= baselineFloor && at <= baselineCeiling;
      }),
      window,
    }),
  );
  const triggers = baselines.flatMap((baseline) => triggersFor({ allRates, baseline, baselineCeiling, policy }));
  const latest = everything
    .map((sample) => sample.observedAtIso)
    .toSorted()
    .at(-1);
  return {
    baselines,
    incident:
      triggers.length === 0 ? undefined : { incidentId: incidentIdOf({ triggers }), observedAtIso: nowIso, triggers },
    latestSampleAtIso: latest,
  };
}

/** A fraction-per-hour rendered as the percentage points per hour a reader thinks in. */
function renderPace({ fractionPerHour }: { fractionPerHour: number }): string {
  return `${(fractionPerHour * 100).toFixed(1)}%/h`;
}

/**
 * The evaluation as the lines a supervisor reads.
 *
 * A `warming` baseline is PRINTED rather than hidden, because "this cannot fire yet" is the single most
 * useful thing a young watch can say about itself.
 *
 * @param evaluation what the detector resolved
 * @returns the lines, in order
 */
export function renderDrawdownEvaluation({ evaluation }: { evaluation: DrawdownEvaluation }): readonly string[] {
  const baselineLines = evaluation.baselines.map((baseline) => {
    const median = baseline.medianFractionPerHour;
    const normal = median === undefined ? "no rate yet" : renderPace({ fractionPerHour: median });
    return `  ${baseline.window.padEnd(16)} ${baseline.maturity.padEnd(11)} normal ${normal}  (${String(baseline.positiveRates)} rates over ${(baseline.spanMs / 3_600_000).toFixed(1)}h)`;
  });
  const incident = evaluation.incident;
  if (incident === undefined) {
    return ["plan drawdown: no anomaly", ...baselineLines];
  }
  return [
    `plan drawdown: ANOMALY — ${String(incident.triggers.length)} window(s) drawing down far faster than normal`,
    ...incident.triggers.map(
      (trigger) =>
        `  ${trigger.planAlias} ${trigger.window} at ${renderPace({ fractionPerHour: trigger.currentFractionPerHour })}` +
        ` = ${trigger.ratio.toFixed(1)}x its normal ${renderPace({ fractionPerHour: trigger.baselineFractionPerHour })}` +
        ` (baseline ${trigger.maturity})`,
    ),
    ...baselineLines,
  ];
}
