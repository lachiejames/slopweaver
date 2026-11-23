/**
 * The Codex burn detector's arithmetic: is this account's budget draining far faster than its own normal?
 *
 * `src/claude/drawdownAnomaly.ts` is the BEHAVIOURAL reference — same question, same shape of answer — and
 * deliberately not the implementation. Codex's signal differs from Claude's in four ways that each change
 * the maths, so a copy would have been wrong in four places at once:
 *
 *  1. **Series identity is the WINDOW, never the slot.** Codex reports two rate-limit slots per event and
 *     the weekly window moves between them; `src/codex/gauge.ts` carries `slot` precisely so a reading can
 *     be traced back, not so anything can key off it. A series is `account · limit · duration · reset`, and
 *     keying on `primary`/`secondary` would splice the five-hour window's history onto the weekly one's the
 *     first time they swapped.
 *  2. **Codex's scale is 0..100, not 0..1.** `usedPercent` is the provider's own number. Every rate in this
 *     detector is PERCENTAGE POINTS per hour, said so in the field name, because the one place the two
 *     codebases could silently disagree is a threshold that means a hundredfold different thing.
 *  3. **Sampling is not under our control.** A Codex reading exists only when Codex wrote a `token_count`
 *     event, so a fanned-out `--concurrency 5` run emits five readings in a few seconds and an idle night
 *     emits none. A baseline pooled per-interval would be dominated by the busy minutes, so intervals are
 *     NON-OVERLAPPING and the baseline is DURATION-WEIGHTED: an hour of history counts as an hour however
 *     many readings happen to sit inside it.
 *  4. **An absent window is not a zero.** An exhaustion event nulls both slots, and a null premium window
 *     cannot produce a burn slope. Neither can a credits reading whose balance is null, which is every
 *     credits reading this machine has ever written.
 *
 * ## The four verdicts, and why `normal` is not the default
 *
 * {@link CodexDrawdownVerdict} is `warming` | `insufficient-coverage` | `normal` | `anomaly`, and the first
 * two exist so that "nothing fired" is never reported as though it proved ordinary consumption. A watch that
 * has run for ten minutes knows nothing about this account's normal pace; saying `normal` there is a claim
 * it has no evidence for, and it is the claim that would stop anyone looking.
 *
 * Pure. `./drawdownSeries.ts` turns the readings into series, slopes and baselines, `./drawdownJournalStore.ts`
 * holds the history, `./drawdownTick.ts` decides what to do about it.
 */

import { parseIsoMs } from "#lib/date.js";
import { baselinesOf, codexDrawdownRates, MS_PER_HOUR, orderSamples, spanOf } from "./drawdownSeries.js";

/**
 * One window's reading at one instant, as a journal row.
 *
 * `sourceEventId` is what makes a re-read idempotent: the watch re-opens the same bounded rollout tail on
 * every tick, so the same `token_count` event arrives again and again, and a series that counted each
 * arrival would manufacture a zero-elapsed interval per tick.
 */
export interface CodexDrawdownSample {
  readonly kind: "sample";
  readonly schemaVersion: 1;
  /**
   * A content identity for the source event: observed instant, limit, slot and percentage.
   *
   * Derived rather than provided, because a Codex rollout line carries no id of its own. It is the four
   * fields that would have to ALL match for two readings to be the same observation — and if they do match,
   * treating them as two observations is exactly the double count this field prevents.
   */
  readonly sourceEventId: string;
  /** Which account scope reported it — `codex` on ordinary readings, `premium` on exhaustion events. */
  readonly accountScope: string;
  /** The rate-limit id this window belongs to, as the provider named it. */
  readonly limitId: string;
  /**
   * The window's width in minutes. A window with no declared width cannot start a series — see
   * {@link ./drawdownSeries.codexDrawdownSamples}.
   */
  readonly windowMinutes: number;
  /** When this window resets. A change here ENDS the series rather than producing a negative slope. */
  readonly resetAtIso: string;
  readonly observedAtIso: string;
  /** 0..100, the provider's own scale. Never converted to a fraction anywhere in this detector. */
  readonly usedPercent: number;
}

/**
 * Every number the detector is tuned by, so none of them is buried in the arithmetic.
 *
 * @internal a field of the exported evaluation; callers pass {@link DEFAULT_CODEX_DRAWDOWN_POLICY}.
 */
export interface CodexDrawdownPolicy {
  /** How far back the baseline pools intervals from. */
  readonly baselineLookbackMs: number;
  /** Below this much OBSERVED span the verdict is `warming`, whatever the rates say. */
  readonly minimumObservedSpanMs: number;
  /** Below this many eligible baseline intervals the verdict is `warming`. */
  readonly minimumBaselineIntervals: number;
  /**
   * The shortest interval that can carry a rate.
   *
   * Two readings 40 seconds apart divide a rounding-width delta by a near-zero time and produce an enormous
   * slope that is an artefact of the sampling, not of the burn. Codex reports `used_percent` as an integer
   * on this machine, so one point of quantisation over 40 seconds already reads as 90 points per hour.
   */
  readonly minimumIntervalMs: number;
  /** The longest interval that can carry a rate — beyond it the two readings are not one episode. */
  readonly maximumIntervalMs: number;
  /**
   * The pace below which nothing is an anomaly however large its ratio.
   *
   * A baseline of 0.01 points per hour makes a perfectly ordinary 0.5 an instant 50x. The floor is what
   * stops a quiet week manufacturing an emergency out of the first hour of real work after it.
   */
  readonly absoluteBurnFloorPercentPerHour: number;
  /** How many times the baseline a current interval must reach to trigger. */
  readonly ratioThreshold: number;
  /** History older than this cannot contribute to a baseline at all — a stale series is not a normal. */
  readonly stalenessMs: number;
}

/**
 * The shipped policy.
 *
 * **These are candidate notification settings, and `ratioThreshold` is still the CLAUDE detector's number.**
 * It is the owner's 10, carried across because it is a reasonable place to start, not because anything has
 * measured Codex's own distribution of ratios. What HAS been measured is that it does not fire on ordinary
 * work, which is the weaker but load-bearing half: a threshold that alerted on a normal afternoon would be
 * worse than none.
 *
 * REPLAYED over 26.1 hours of this machine's real rollout history — 6,147 readings, three weekly
 * series after reset clustering, 62/57/70 eligible intervals, paces 9.37, 18.88 and 9.82 points per hour.
 * **Trigger count: zero**, with the highest series only 1.9x the lowest. Reproduce, without opening anything
 * or writing outside the throwaway home:
 *
 * ```bash
 * H=$(mktemp -d); slopweaver codex watch --once --home "$H"; slopweaver codex watch --once --dry-run --home "$H"
 * ```
 *
 * Two things that replay did NOT establish, stated so nobody reads it as more than it is: no five-hour
 * window appeared in the data at all (this plan reports only the weekly one), and a zero trigger count over
 * one ordinary day is evidence against false positives and no evidence at all about true ones.
 */
export const DEFAULT_CODEX_DRAWDOWN_POLICY: CodexDrawdownPolicy = {
  absoluteBurnFloorPercentPerHour: 5,
  baselineLookbackMs: 7 * 24 * 60 * 60 * 1000,
  maximumIntervalMs: 2 * 60 * 60 * 1000,
  minimumBaselineIntervals: 8,
  minimumIntervalMs: 5 * 60 * 1000,
  minimumObservedSpanMs: 12 * 60 * 60 * 1000,
  ratioThreshold: 10,
  stalenessMs: 14 * 24 * 60 * 60 * 1000,
};

/**
 * One measured slope between two compatible readings of one series.
 *
 * @internal a field of the exported evaluation, never imported by name.
 */
export interface CodexDrawdownRate {
  readonly seriesId: string;
  readonly accountScope: string;
  readonly limitId: string;
  readonly windowMinutes: number;
  readonly resetAtIso: string;
  readonly fromIso: string;
  readonly toIso: string;
  readonly elapsedMs: number;
  readonly usedPercentDelta: number;
  /** Percentage POINTS per hour. Never a fraction — see this module's header. */
  readonly percentPointsPerHour: number;
}

/**
 * What normal looks like for one series, and how much history says so.
 *
 * @internal a field of the exported evaluation, never imported by name.
 */
export interface CodexDrawdownBaseline {
  readonly seriesId: string;
  readonly windowMinutes: number;
  /** The number of eligible intervals pooled. */
  readonly intervals: number;
  /** The total DURATION those intervals cover — the denominator that makes a busy minute not outvote an hour. */
  readonly coveredMs: number;
  /** The span from the earliest to the latest reading, which is what `minimumObservedSpanMs` judges. */
  readonly observedSpanMs: number;
  /**
   * Total points burned over total time covered.
   *
   * A duration-weighted mean rather than a mean of the per-interval rates: five readings inside one busy
   * minute and one reading an hour later are six observations of ONE hour, and averaging their six slopes
   * would count that minute five times.
   */
  readonly percentPointsPerHour: number | undefined;
}

/**
 * One series burning far faster than its own normal.
 *
 * @internal a field of the exported evaluation, never imported by name.
 */
export interface CodexDrawdownTrigger {
  readonly seriesId: string;
  readonly accountScope: string;
  readonly limitId: string;
  readonly windowMinutes: number;
  readonly resetAtIso: string;
  readonly ratio: number;
  readonly currentPercentPointsPerHour: number;
  readonly baselinePercentPointsPerHour: number;
  readonly fromIso: string;
  readonly toIso: string;
}

/**
 * One episode, however many series it shows up in.
 *
 * `episodeId` is derived from the series identities that fired — NOT from the poll instant — so the same
 * anomaly continuing over four ticks is one episode with one id, and a genuinely new one after a reset gets
 * a different one. Deriving it from `nowIso` is the bug this field exists to not have: it would mint a fresh
 * id every poll and open a workspace on every one of them.
 */
export interface CodexDrawdownEpisode {
  readonly episodeId: string;
  readonly observedAtIso: string;
  readonly triggers: readonly CodexDrawdownTrigger[];
}

/**
 * What one evaluation concluded.
 *
 * `warming` and `insufficient-coverage` are separate on purpose: the first says the watch has not run long
 * enough, the second says it has but THIS series has too few eligible intervals — a machine sampled twice a
 * day for a fortnight is the second, not the first, and the fix is different.
 *
 * @internal a field of the exported evaluation, never imported by name.
 */
export type CodexDrawdownVerdict = "warming" | "insufficient-coverage" | "normal" | "anomaly";

/** Everything one evaluation resolved. */
export interface CodexDrawdownEvaluation {
  readonly verdict: CodexDrawdownVerdict;
  /** Why the verdict is what it is, in one sentence a report can print verbatim. */
  readonly why: string;
  readonly baselines: readonly CodexDrawdownBaseline[];
  /** Present only on `anomaly`. Nothing else may open an investigation. */
  readonly episode: CodexDrawdownEpisode | undefined;
  readonly latestSampleAtIso: string | undefined;
  /** How many distinct readings the evaluation stood on, after deduplication. */
  readonly samples: number;
  readonly observedSpanMs: number;
}

/**
 * Judge the current readings against the history.
 *
 * The current intervals are kept OUT of their own baseline — `history` and `current` are separate parameters
 * for that reason, not for tidiness. An episode that has been running an hour would otherwise be raising the
 * very baseline it is judged against, and the longer it ran the more ordinary it would look.
 *
 * @param history the readings already journalled, which the baseline is built from
 * @param current the readings this tick just took, which are judged
 * @param nowIso the instant lookback and staleness are measured from
 * @param policy the tuning
 * @returns the verdict, its reason, the baselines and — only on `anomaly` — the episode
 */
export function evaluateCodexDrawdown({
  history,
  current,
  nowIso,
  policy,
}: {
  history: readonly CodexDrawdownSample[];
  current: readonly CodexDrawdownSample[];
  nowIso: string;
  policy: CodexDrawdownPolicy;
}): CodexDrawdownEvaluation {
  const baselines = baselinesOf({ history, nowIso, policy });
  const observedSpanMs = spanOf({ samples: history });
  const latestSampleAtIso = latestOf({ samples: [...history, ...current] });
  const shape = { baselines, latestSampleAtIso, observedSpanMs, samples: history.length };
  if (observedSpanMs < policy.minimumObservedSpanMs) {
    return {
      ...shape,
      episode: undefined,
      verdict: "warming",
      why:
        `the journal spans ${hours({ ms: observedSpanMs })} and the baseline needs ` +
        `${hours({ ms: policy.minimumObservedSpanMs })} — nothing here says consumption is ordinary, only that ` +
        "there is not yet a normal to compare it against",
    };
  }
  const usable = baselines.filter((baseline) => baseline.intervals >= policy.minimumBaselineIntervals);
  if (usable.length === 0) {
    return {
      ...shape,
      episode: undefined,
      verdict: "insufficient-coverage",
      why:
        `no series has the ${String(policy.minimumBaselineIntervals)} eligible interval(s) a baseline needs — ` +
        "the watch has run long enough, but the readings inside that span are too sparse to establish a pace",
    };
  }
  const triggers = triggersFor({ baselines: usable, current, history, policy });
  if (triggers.length === 0) {
    return {
      ...shape,
      episode: undefined,
      verdict: "normal",
      why: `every current interval sits inside ${String(policy.ratioThreshold)}x its series' own measured pace`,
    };
  }
  return {
    ...shape,
    episode: {
      episodeId: episodeIdOf({ triggers }),
      observedAtIso: episodeInstant({ latestSampleAtIso, nowIso }),
      triggers,
    },
    verdict: "anomaly",
    why: `${String(triggers.length)} series burning at or past ${String(policy.ratioThreshold)}x its own pace`,
  };
}

/**
 * Every current interval that reaches the threshold, over a baseline that is itself above the floor.
 *
 * @param baselines the usable baselines
 * @param current this tick's readings
 * @param history the journalled readings, so a current interval can pair with the last journalled one
 * @param policy the tuning
 * @returns one trigger per series that fired
 */
function triggersFor({
  baselines,
  current,
  history,
  policy,
}: {
  baselines: readonly CodexDrawdownBaseline[];
  current: readonly CodexDrawdownSample[];
  history: readonly CodexDrawdownSample[];
  policy: CodexDrawdownPolicy;
}): readonly CodexDrawdownTrigger[] {
  const currentIds = new Set(current.map((sample) => sample.sourceEventId));
  // The current intervals are computed over history PLUS current, because the newest journalled reading is
  // what a fresh one pairs with — but only an interval ENDING on a current reading is judged, so nothing
  // already in the baseline is scored twice.
  const rates = codexDrawdownRates({ policy, samples: [...history, ...current] });
  const triggers: CodexDrawdownTrigger[] = [];
  for (const rate of rates) {
    const endsOnCurrent = current.some(
      (sample) => sample.observedAtIso === rate.toIso && currentIds.has(sample.sourceEventId),
    );
    if (!endsOnCurrent) {
      continue;
    }
    const baseline = baselines.find((entry) => entry.seriesId === rate.seriesId);
    const normal = baseline?.percentPointsPerHour;
    if (baseline === undefined || normal === undefined || normal <= 0) {
      continue;
    }
    if (rate.percentPointsPerHour < policy.absoluteBurnFloorPercentPerHour) {
      continue;
    }
    const ratio = rate.percentPointsPerHour / normal;
    if (ratio < policy.ratioThreshold) {
      continue;
    }
    triggers.push({
      accountScope: rate.accountScope,
      baselinePercentPointsPerHour: normal,
      currentPercentPointsPerHour: rate.percentPointsPerHour,
      fromIso: rate.fromIso,
      limitId: rate.limitId,
      ratio,
      resetAtIso: rate.resetAtIso,
      seriesId: rate.seriesId,
      toIso: rate.toIso,
      windowMinutes: rate.windowMinutes,
    });
  }
  return triggers;
}

/**
 * An episode's identity, from the SERIES that fired and never from the clock.
 *
 * The same anomaly on the next tick produces the same id, so suppression holds; a genuinely new one after a
 * reset produces a different one, because the reset instant is part of every series identity.
 *
 * @param triggers the series that fired
 * @returns a stable id
 */
function episodeIdOf({ triggers }: { triggers: readonly CodexDrawdownTrigger[] }): string {
  return triggers
    .map((trigger) => trigger.seriesId)
    .toSorted()
    .join("|");
}

/** The latest datable observed instant among some samples, or undefined when none can be dated. */
function latestOf({ samples }: { samples: readonly CodexDrawdownSample[] }): string | undefined {
  const ordered = orderSamples({ samples }).filter(
    (sample) => parseIsoMs({ tsIso: sample.observedAtIso }) !== undefined,
  );
  return ordered[ordered.length - 1]?.observedAtIso;
}

/**
 * The instant an episode is stamped with.
 *
 * The latest READING, not the poll clock, whenever there is one: an episode is about what the account did,
 * and dating it by when the watch happened to look would move its stamp on every tick. The poll clock is the
 * stated fallback for an episode whose readings are all undatable, which nothing has produced.
 *
 * @param latestSampleAtIso the latest datable reading, when there is one
 * @param nowIso the poll instant
 * @returns the instant to stamp with
 */
function episodeInstant({
  latestSampleAtIso,
  nowIso,
}: {
  latestSampleAtIso: string | undefined;
  nowIso: string;
}): string {
  if (latestSampleAtIso === undefined) {
    return nowIso;
  }
  return latestSampleAtIso;
}

/** When the last datable reading was seen, or the stated fact that none has been. */
function latestSeen({ evaluation }: { evaluation: CodexDrawdownEvaluation }): string {
  if (evaluation.latestSampleAtIso === undefined) {
    return "never";
  }
  return evaluation.latestSampleAtIso;
}

/** A duration in whole hours, for a message. */
function hours({ ms }: { ms: number }): string {
  return `${(ms / MS_PER_HOUR).toFixed(1)}h`;
}

/**
 * Render an evaluation.
 *
 * The first line always names the VERDICT, including `warming` and `insufficient-coverage`, so a reader can
 * never take a quiet report as evidence that consumption was checked and found ordinary.
 *
 * @param evaluation what {@link evaluateCodexDrawdown} resolved
 * @returns the lines to print, in order
 */
export function renderCodexDrawdown({ evaluation }: { evaluation: CodexDrawdownEvaluation }): readonly string[] {
  const lines = [
    `codex burn: ${evaluation.verdict.toUpperCase()} — ${evaluation.why}`,
    // The count is the history this pass was JUDGED against — what the journal held when the pass started,
    // not what it holds now. Saying so is the difference between a reader believing the watch has seen
    // nothing and knowing it has just recorded its first batch, which is the state every first run is in.
    `  baseline stood on ${String(evaluation.samples)} journalled reading(s) spanning ` +
      `${hours({ ms: evaluation.observedSpanMs })}; latest reading seen ${latestSeen({ evaluation })}`,
  ];
  for (const baseline of evaluation.baselines) {
    const pace = baseline.percentPointsPerHour;
    const paceText = pace === undefined ? "no measured pace" : `${pace.toFixed(2)} points/h`;
    // The SERIES id, not just the width. Measured on 26.1h of this machine's own history: six baselines
    // printed, every one of them a 10080-minute window, distinguishable only by the reset instant inside
    // their series id — so a line naming the width alone is six identical rows. Reproduce with the run in
    // `./gaugeSeries.ts`'s own measurement note.
    lines.push(
      `  ${baseline.seriesId}: ${paceText} over ${String(baseline.intervals)} interval(s)` +
        ` covering ${hours({ ms: baseline.coveredMs })}`,
    );
  }
  const episode = evaluation.episode;
  if (episode === undefined) {
    return lines;
  }
  lines.push(`  episode ${episode.episodeId} at ${episode.observedAtIso}:`);
  for (const trigger of episode.triggers) {
    lines.push(
      `    ${trigger.accountScope}/${trigger.limitId} ${String(trigger.windowMinutes)}-minute window: ` +
        `${trigger.currentPercentPointsPerHour.toFixed(2)} points/h, ${trigger.ratio.toFixed(1)}x its normal ` +
        `${trigger.baselinePercentPointsPerHour.toFixed(2)} (${trigger.fromIso} … ${trigger.toIso})`,
    );
  }
  return lines;
}
