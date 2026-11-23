/**
 * Where one plan's week stands at an instant, from the drawdown journal's samples: the newest sample still open, a
 * fresh week rolled forward past a reset, or the sentence saying why the plan cannot be placed. Pure; the survival
 * forecast (`./survivalForecast.ts`) places every plan through it.
 */
import type { DrawdownSample } from "./drawdownAnomaly.js";

const HOUR_MS = 3_600_000;
/** One week, the span a seven-day window covers. */
export const WEEK_MS = 7 * 24 * HOUR_MS;
/** A journal whose newest sample is older than this is a watch that stopped, not a fleet that is quiet. */
export const FORECAST_STALE_AFTER_MS = 2 * HOUR_MS;

/**
 * A sample's instant, epoch milliseconds.
 *
 * @returns the instant
 */
export function msOf({ iso }: { iso: string }): number {
  return Date.parse(iso);
}

/** Orders two samples newest first by instant, never by text: the journal accepts an offset-bearing timestamp. */
function newerFirst({ left, right }: { left: DrawdownSample; right: DrawdownSample }): number {
  return msOf({ iso: right.observedAtIso }) - msOf({ iso: left.observedAtIso });
}

/**
 * One plan-window's newest sample, however old.
 *
 * @returns the sample, or undefined when the journal never read that plan-window
 */
export function newestOfAnyAge({
  samples,
  alias,
  window,
}: {
  samples: readonly DrawdownSample[];
  alias: string;
  window: DrawdownSample["window"];
}): DrawdownSample | undefined {
  return samples
    .filter((sample) => sample.planAlias === alias && sample.window === window)
    .toSorted((left, right) => newerFirst({ left, right }))[0];
}

/**
 * A sampled week as it stands at `nowMs`: as read while it is open, else a fresh week at its next weekly reset.
 *
 * @returns the week's reset and utilization, and whether it was rolled past a reset
 */
export function rolledForward({ sample, nowMs }: { sample: DrawdownSample; nowMs: number }): {
  readonly resetAtIso: string;
  readonly utilization: number;
  readonly rolled: boolean;
} {
  const resetMs = msOf({ iso: sample.resetAtIso });
  if (resetMs > nowMs) {
    return { resetAtIso: sample.resetAtIso, rolled: false, utilization: sample.utilization };
  }
  const weeksPast = Math.floor((nowMs - resetMs) / WEEK_MS) + 1;
  return { resetAtIso: new Date(resetMs + weeksPast * WEEK_MS).toISOString(), rolled: true, utilization: 0 };
}

/** The sentence a plan the watch stopped reading is refused with. */
function staleWeekBecause({ alias, observedAtIso }: { alias: string; observedAtIso: string }): string {
  return (
    `${alias}'s newest seven-day sample is from ${observedAtIso.slice(0, 16)}Z, over two hours old — ` +
    "the watch has stopped reading that plan, so where it stands now is unknown"
  );
}

/**
 * One spendable plan's current week: its newest sample whose reset is still ahead, as read; else, when its newest
 * sample's week reset since that reading, a fresh week placed AT that reset.
 *
 * The rolled case is the instant just after a weekly reset, before the watch's next reading — MEASURED,
 * a `fleet-ceiling-weekly` firing fell on a plan's own reset instant, and its span ends at the slot,
 * so no new-week sample could exist and the whole ceiling read unmeasurable (repro: `slopweaver fleet ceiling --now
 * <a plan's reset instant>` on a build without this). A reset to zero is the provider's rule, not a guess; what it leaves
 * unseen is the draw since the reset, bounded by the same two-hour freshness every as-read sample carries. It is
 * placed only from a reading taken BEFORE its own reset: one taken after it is a reading already stale when observed
 * (`./select.ts`), and no new week is inferred from it.
 *
 * The NEWEST sample decides whether a reset has passed: an older sample still naming a later reset — a reset the
 * provider has since moved — never masks a fresher reading whose week already reset.
 *
 * @param nowMs the instant the plan is placed at
 * @returns the week, or the sentence saying why the plan could not be placed
 */
export function currentWeekOf({
  samples,
  alias,
  nowMs,
}: {
  samples: readonly DrawdownSample[];
  alias: string;
  nowMs: number;
}):
  | { readonly week: Pick<DrawdownSample, "observedAtIso" | "resetAtIso" | "utilization"> }
  | { readonly because: string } {
  const newest = newestOfAnyAge({ alias, samples, window: "seven-day" });
  if (newest !== undefined && resetSinceFreshReading({ nowMs, sample: newest })) {
    return { week: freshWeekAtReset({ nowMs, sample: newest }) };
  }
  const open = newestOf({ alias, nowMs, samples, window: "seven-day" });
  if (open !== undefined) {
    if (nowMs - msOf({ iso: open.observedAtIso }) > FORECAST_STALE_AFTER_MS) {
      return { because: staleWeekBecause({ alias, observedAtIso: open.observedAtIso }) };
    }
    return { week: open };
  }
  const last = newestOfAnyAge({ alias, samples, window: "seven-day" });
  if (last === undefined) {
    return { because: `${alias} has no seven-day sample whose reset is still ahead, so where it stands is unknown` };
  }
  const observedMs = msOf({ iso: last.observedAtIso });
  if (nowMs - observedMs > FORECAST_STALE_AFTER_MS) {
    return { because: staleWeekBecause({ alias, observedAtIso: last.observedAtIso }) };
  }
  if (msOf({ iso: last.resetAtIso }) < observedMs) {
    return {
      because:
        `${alias}'s newest seven-day sample was read after its own reset at ${last.resetAtIso.slice(0, 16)}Z, ` +
        "so where its new week stands is unknown",
    };
  }
  return { week: freshWeekAtReset({ nowMs, sample: last }) };
}

/** Whether a sample is fresh, was read before its own reset, and that reset has since passed — a week to roll. */
function resetSinceFreshReading({ sample, nowMs }: { sample: DrawdownSample; nowMs: number }): boolean {
  const observedMs = msOf({ iso: sample.observedAtIso });
  const resetMs = msOf({ iso: sample.resetAtIso });
  return nowMs - observedMs <= FORECAST_STALE_AFTER_MS && resetMs >= observedMs && resetMs <= nowMs;
}

/** The fresh week that opened at a sample's own reset, observed at that reset. */
function freshWeekAtReset({
  sample,
  nowMs,
}: {
  sample: DrawdownSample;
  nowMs: number;
}): Pick<DrawdownSample, "observedAtIso" | "resetAtIso" | "utilization"> {
  const rolled = rolledForward({ nowMs, sample });
  return {
    observedAtIso: new Date(msOf({ iso: sample.resetAtIso })).toISOString(),
    resetAtIso: rolled.resetAtIso,
    utilization: rolled.utilization,
  };
}

/**
 * The newest sample of one plan-window whose reset is still ahead of `nowMs`.
 *
 * @returns the sample, or undefined when none of that plan-window's weeks is still open
 */
export function newestOf({
  samples,
  alias,
  window,
  nowMs,
}: {
  samples: readonly DrawdownSample[];
  alias: string;
  window: DrawdownSample["window"];
  nowMs: number;
}): DrawdownSample | undefined {
  return samples
    .filter(
      (sample) => sample.planAlias === alias && sample.window === window && msOf({ iso: sample.resetAtIso }) > nowMs,
    )
    .toSorted((left, right) => newerFirst({ left, right }))[0];
}
