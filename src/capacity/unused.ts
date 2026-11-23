/**
 * How much of each plan and of the machine went UNUSED over a span of days — the measurement behind the owner's
 * concern that plan usage is left on the table across Claude, Codex and machine resources.
 *
 * Pure: every sample in, one report out. `./unusedRead.ts` reads the three histories and `slopweaver machine
 * unused` prints them.
 *
 * ## What a number here does and does not claim
 *
 * **A plan's window is one INSTANCE per reset.** Samples are grouped by the instant their window resets, and no
 * group is ever bridged across a reset. A window that reset inside the span has EXPIRED, and `100 - the highest
 * reading seen in it` is an UPPER BOUND on what it left unused: use can still have risen after the last sample,
 * so the gap from that sample to the reset is carried beside the bound rather than hidden. A window still open at
 * the end of the span has not "gone unused" yet — it reports what is unused NOW and when it resets.
 *
 * **No sample is unknown, never idle.** A Claude five-hour window opens on first use, and a Codex reading exists
 * only when Codex ran, so a stretch with no readings is not a stretch of 100% unused — this counts only window
 * instances somebody observed and reports how many samples and how wide a gap stand behind each figure.
 *
 * **The machine has no reset.** Its figure is the tick-sampled share of the load hold left free, and the share
 * of ticks that read a hold. The hold it is measured against is TODAY's (3 × this machine's cores), because a
 * tick row does not record the hold it was judged under; the report says so.
 */
import { parseIsoMs } from "#lib/date.js";

/** Readings of one window whose resets lie within this many milliseconds of each other are the same instance. */
const SAME_RESET_TOLERANCE_MS = 15 * 60 * 1000;

/** One provider reading of one window, as a percentage used of 100. */
export interface PlanWindowSample {
  /** `claude:<alias>` or `codex:<alias>`. */
  readonly ceilingId: string;
  /** The provider's own window name — `five-hour`, `seven-day`, `fable-seven-day`, `weekly`. */
  readonly window: string;
  readonly observedAtIso: string;
  readonly resetAtIso: string;
  /** 0..100. Claude's 0..1 fraction is scaled by the reader, so both providers print the same unit. */
  readonly usedPct: number;
}

/** One supervisor tick's machine reading. */
export interface MachineTickSample {
  readonly observedAtIso: string;
  readonly load1: number;
  readonly hold: boolean;
}

/** One window of one plan, measured over the span. */
export interface UnusedWindowMeasurement {
  readonly ceilingId: string;
  readonly window: string;
  /** Instances that reset inside the span — the ones that can have GONE unused. */
  readonly expiredWindows: number;
  /**
   * Mean over the expired instances of `100 - highest reading`, an upper bound on unused share at reset.
   * `null` when no instance expired inside the span.
   */
  readonly unusedAtResetPct: number | null;
  /** The widest gap, over the expired instances, from the last reading to the reset — how loose the bound is. */
  readonly widestLastReadingToResetSeconds: number | null;
  /** The instance still open at the span's end, when one was observed. */
  readonly open: { readonly usedPct: number; readonly resetAtIso: string } | null;
  readonly samples: number;
  readonly firstObservedAtIso: string;
  readonly lastObservedAtIso: string;
  /** The widest gap between consecutive readings of this window, unknown time rather than idle time. */
  readonly widestGapSeconds: number;
}

/** The machine, measured over the span. */
interface MachineUnusedMeasurement {
  readonly ticks: number;
  /** Share of ticks that read a hold, 0..100. `null` when no tick fell in the span. */
  readonly heldPct: number | null;
  readonly meanLoad1: number | null;
  /** Mean over ticks of the load hold left free, 0..100, a held tick counting 0. */
  readonly unusedLoadPct: number | null;
  /** The hold the load was measured against — today's, which a tick row does not record. */
  readonly loadHold: number;
  readonly widestGapSeconds: number | null;
}

/** The whole measurement. */
export interface UnusedCapacityReport {
  readonly fromIso: string;
  readonly toIso: string;
  readonly windows: readonly UnusedWindowMeasurement[];
  readonly machine: MachineUnusedMeasurement;
  /** What the readers could not see — skipped files, unparseable lines, a register that would not read. */
  readonly problems: readonly string[];
}

/** A sample with its two instants already parsed, so no function below re-parses a string. */
interface TimedSample {
  readonly sample: PlanWindowSample;
  readonly observedMs: number;
  readonly resetMs: number;
}

/** The widest gap between consecutive instants, in whole seconds; 0 for fewer than two. */
function widestGapSeconds({ instantsMs }: { instantsMs: readonly number[] }): number {
  const sorted = instantsMs.toSorted((left, right) => left - right);
  let widest = 0;
  for (let index = 1; index < sorted.length; index += 1) {
    widest = Math.max(widest, sorted[index]! - sorted[index - 1]!);
  }
  return Math.round(widest / 1000);
}

/** The mean of a non-empty list. */
function mean({ values }: { values: readonly number[] }): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/**
 * Group one window's samples into reset instances, merging resets within {@link SAME_RESET_TOLERANCE_MS} so a
 * provider rounding its reset a few seconds differently between readings cannot split one window into many.
 */
function instancesOf({ samples }: { samples: readonly TimedSample[] }): readonly (readonly TimedSample[])[] {
  const byReset = samples.toSorted((left, right) => left.resetMs - right.resetMs);
  const instances: TimedSample[][] = [];
  for (const sample of byReset) {
    const current = instances.at(-1);
    const anchor = current?.[0];
    if (current !== undefined && anchor !== undefined && sample.resetMs - anchor.resetMs <= SAME_RESET_TOLERANCE_MS) {
      current.push(sample);
      continue;
    }
    instances.push([sample]);
  }
  return instances;
}

/** Measure one window of one plan from its samples, which are non-empty and already inside the span. */
function measureWindow({ samples, toMs }: { samples: readonly TimedSample[]; toMs: number }): UnusedWindowMeasurement {
  const first = samples[0]!;
  const byObserved = samples.toSorted((left, right) => left.observedMs - right.observedMs);
  const expiredUnused: number[] = [];
  const expiredGaps: number[] = [];
  let open: UnusedWindowMeasurement["open"] = null;
  for (const instance of instancesOf({ samples })) {
    const latest = instance.toSorted((left, right) => right.observedMs - left.observedMs)[0]!;
    const resetMs = Math.max(...instance.map((sample) => sample.resetMs));
    if (resetMs > toMs) {
      open = { resetAtIso: latest.sample.resetAtIso, usedPct: latest.sample.usedPct };
      continue;
    }
    expiredUnused.push(100 - Math.max(...instance.map((sample) => sample.sample.usedPct)));
    expiredGaps.push(Math.round((resetMs - latest.observedMs) / 1000));
  }
  return {
    ceilingId: first.sample.ceilingId,
    expiredWindows: expiredUnused.length,
    firstObservedAtIso: byObserved[0]!.sample.observedAtIso,
    lastObservedAtIso: byObserved.at(-1)!.sample.observedAtIso,
    open,
    samples: samples.length,
    unusedAtResetPct: expiredUnused.length === 0 ? null : mean({ values: expiredUnused }),
    widestGapSeconds: widestGapSeconds({ instantsMs: samples.map((sample) => sample.observedMs) }),
    widestLastReadingToResetSeconds: expiredGaps.length === 0 ? null : Math.max(...expiredGaps),
    window: first.sample.window,
  };
}

/** Measure the machine from the ticks inside the span. */
function measureMachine({
  ticks,
  loadHold,
}: {
  ticks: readonly { readonly tick: MachineTickSample; readonly observedMs: number }[];
  loadHold: number;
}): MachineUnusedMeasurement {
  if (ticks.length === 0) {
    return { heldPct: null, loadHold, meanLoad1: null, ticks: 0, unusedLoadPct: null, widestGapSeconds: null };
  }
  const free = ticks.map(({ tick }) => (tick.hold ? 0 : Math.max(0, 1 - tick.load1 / loadHold) * 100));
  return {
    heldPct: (ticks.filter(({ tick }) => tick.hold).length / ticks.length) * 100,
    loadHold,
    meanLoad1: mean({ values: ticks.map(({ tick }) => tick.load1) }),
    ticks: ticks.length,
    unusedLoadPct: mean({ values: free }),
    widestGapSeconds: widestGapSeconds({ instantsMs: ticks.map(({ observedMs }) => observedMs) }),
  };
}

/** The plan samples that count toward the span, grouped by ceiling and window, and how many did not parse. */
function windowGroupsOf({
  samples,
  fromMs,
  toMs,
}: {
  samples: readonly PlanWindowSample[];
  fromMs: number;
  toMs: number;
}): { readonly groups: ReadonlyMap<string, TimedSample[]>; readonly unparsed: number } {
  const groups = new Map<string, TimedSample[]>();
  let unparsed = 0;
  for (const sample of samples) {
    const observedMs = parseIsoMs({ tsIso: sample.observedAtIso });
    const resetMs = parseIsoMs({ tsIso: sample.resetAtIso });
    if (observedMs === undefined || resetMs === undefined) {
      unparsed += 1;
      continue;
    }
    if (observedMs > toMs || resetMs <= fromMs) {
      continue;
    }
    const key = `${sample.ceilingId}\u0000${sample.window}`;
    const timed = { observedMs, resetMs, sample };
    const group = groups.get(key);
    if (group === undefined) {
      groups.set(key, [timed]);
      continue;
    }
    group.push(timed);
  }
  return { groups, unparsed };
}

/** The machine ticks observed inside the span, and how many did not parse. */
function ticksInSpanOf({
  ticks,
  fromMs,
  toMs,
}: {
  ticks: readonly MachineTickSample[];
  fromMs: number;
  toMs: number;
}): {
  readonly inSpan: readonly { readonly tick: MachineTickSample; readonly observedMs: number }[];
  readonly unparsed: number;
} {
  const inSpan: { tick: MachineTickSample; observedMs: number }[] = [];
  let unparsed = 0;
  for (const tick of ticks) {
    const observedMs = parseIsoMs({ tsIso: tick.observedAtIso });
    if (observedMs === undefined) {
      unparsed += 1;
      continue;
    }
    if (observedMs >= fromMs && observedMs <= toMs) {
      inSpan.push({ observedMs, tick });
    }
  }
  return { inSpan, unparsed };
}

/**
 * Measure how much of every plan window and of the machine went unused between two instants.
 *
 * A plan sample counts when it was observed at or before `toIso` and its window resets after `fromIso` — so a
 * window that reset inside the span is measured over ALL of its readings, including the ones taken before the
 * span began. A sample whose instants do not parse is counted as a problem, never silently dropped.
 *
 * @param samples every plan-window reading the readers found, in any order
 * @param ticks every machine tick reading the readers found, in any order
 * @param fromIso the span's start
 * @param toIso the span's end — the instant a window must reset by to count as expired
 * @param loadHold the machine's 1-minute load hold the tick loads are measured against
 * @param problems what the readers already could not see, carried through
 * @returns one measurement per plan window, sorted by ceiling then window, and the machine's
 */
export function measureUnusedCapacity({
  samples,
  ticks,
  fromIso,
  toIso,
  loadHold,
  problems,
}: {
  samples: readonly PlanWindowSample[];
  ticks: readonly MachineTickSample[];
  fromIso: string;
  toIso: string;
  loadHold: number;
  problems: readonly string[];
}): UnusedCapacityReport {
  const fromMs = parseIsoMs({ tsIso: fromIso })!;
  const toMs = parseIsoMs({ tsIso: toIso })!;
  const found = [...problems];
  const { groups, unparsed: unparsedSamples } = windowGroupsOf({ fromMs, samples, toMs });
  const { inSpan, unparsed: unparsedTicks } = ticksInSpanOf({ fromMs, ticks, toMs });
  const unparsed = unparsedSamples + unparsedTicks;
  if (unparsed > 0) {
    found.push(`${String(unparsed)} reading(s) carried an instant that does not parse, and were not counted`);
  }
  const windows = [...groups.values()]
    .map((group) => measureWindow({ samples: group, toMs }))
    .toSorted(
      (left, right) => left.ceilingId.localeCompare(right.ceilingId) || left.window.localeCompare(right.window),
    );
  return { fromIso, machine: measureMachine({ loadHold, ticks: inSpan }), problems: found, toIso, windows };
}
