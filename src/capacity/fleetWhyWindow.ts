/**
 * The window half of `fleet why` (`./fleetWhy.ts`): what the sampled `machine capacity` readings observed inside the
 * last N minutes measured — how many held and on what, the 1-minute load against the hold its peak carried, busy and
 * unattributed cores, what hid from `top`, and the heaviest foreign processes. Pure: normalised readings in, one
 * summary out. The caveats it rides on (sampled, foreign cpu a captured lower bound) are in `./fleetWhy.ts`'s header.
 */
import { parseIsoMs } from "#lib/date.js";

/** One normalised reading and the tick that recorded it. */
export interface FleetWhySource<T> {
  /** Who recorded it — `tick-26`; the join key between the three current readings. */
  readonly by: string;
  readonly observedAtIso: string;
  readonly value: T;
}

/** One foreign process's cpu, as one capacity reading captured it. */
interface FleetWhyHog {
  readonly label: string;
  readonly cpuPct: number;
}

/** What one `machine capacity` reading says about the cpu and its hold. */
export interface FleetWhyMachineSample {
  readonly hold: boolean;
  readonly holdSubjects: readonly string[];
  readonly load1: number;
  readonly loadHold: number;
  /** `null` when the reading could not measure it. */
  readonly busyCores: number | null;
  readonly unattributedCores: number | null;
  readonly hiddenFromTop: readonly string[];
  /** The foreign hogs the reading captured, or `null` when its per-process cpu was not attributed. */
  readonly foreignHogs: readonly FleetWhyHog[] | null;
  /** Every fleet session's cpu plus fleet hogs no session owns — a lower bound; `null` when not attributed. */
  readonly fleetCpuPct: number | null;
}

/** A metric's spread over the window's readings. */
interface FleetWhySpread {
  readonly min: number;
  readonly max: number;
  readonly mean: number;
  readonly last: number;
}

/** The window: what the sampled capacity readings measured. */
export interface FleetWhyWindow {
  readonly fromIso: string;
  readonly toIso: string;
  readonly readings: number;
  readonly firstObservedAtIso: string | null;
  readonly lastObservedAtIso: string | null;
  /** The longest stretch between two readings, or from the window's edges to the first and last. */
  readonly widestGapSeconds: number | null;
  readonly heldReadings: number;
  readonly heldSubjects: readonly { readonly subject: string; readonly readings: number }[];
  readonly load1: FleetWhySpread | null;
  /** The load hold the PEAK 1-minute load's own reading carried. */
  readonly loadHold: number | null;
  readonly busyCores: FleetWhySpread | null;
  readonly unattributedCores: FleetWhySpread | null;
  readonly hiddenFromTop: readonly { readonly label: string; readonly readings: number }[];
  readonly topForeign: readonly {
    readonly label: string;
    readonly meanCapturedCpuPct: number;
    readonly readingsSeen: number;
  }[];
  readonly fleetCpuPct: FleetWhySpread | null;
}

/** How many foreign processes the window names. */
const TOP_FOREIGN = 3;

/**
 * Two strings in code-unit order. Not `localeCompare`: collation calls distinct strings equal, which would leave a tie
 * to the order the readings arrived in.
 *
 * @returns negative, zero or positive, as a sort comparator expects
 */
function byCodeUnit({ left, right }: { left: string; right: string }): number {
  if (left < right) {
    return -1;
  }
  if (left > right) {
    return 1;
  }
  return 0;
}

/**
 * Add to one key's running total, a key not yet seen starting from nothing.
 *
 * @returns nothing; the map is updated in place
 */
function addTo({ totals, key, by }: { totals: Map<string, number>; key: string; by: number }): void {
  const prior = totals.get(key);
  totals.set(key, prior === undefined ? by : prior + by);
}

/** One decimal place, the precision every capacity figure prints at. */
function round1({ value }: { value: number }): number {
  return Math.round(value * 10) / 10;
}

/**
 * A metric's spread over the readings that measured it, oldest first.
 *
 * @returns the spread, or `null` when no reading measured it
 */
function spreadOf({ values }: { values: readonly (number | null)[] }): FleetWhySpread | null {
  const measured = values.filter((value): value is number => value !== null);
  const last = measured.at(-1);
  if (last === undefined) {
    return null;
  }
  return {
    last,
    max: Math.max(...measured),
    mean: round1({ value: measured.reduce((sum, value) => sum + value, 0) / measured.length }),
    min: Math.min(...measured),
  };
}

/**
 * The widest stretch the window went unsampled, counting from its opening edge to the first reading and from the
 * last reading to its closing edge.
 *
 * @returns seconds, or `null` for an empty window
 */
function widestGapOf({
  instants,
  fromMs,
  toMs,
}: {
  instants: readonly number[];
  fromMs: number;
  toMs: number;
}): number | null {
  if (instants.length === 0) {
    return null;
  }
  const edges = [fromMs, ...instants, toMs];
  let widest = 0;
  for (let at = 1; at < edges.length; at += 1) {
    widest = Math.max(widest, edges[at]! - edges[at - 1]!);
  }
  return Math.round(widest / 1000);
}

/**
 * How many readings each label appears in, most first, then by label.
 *
 * @returns the counts
 */
function labelCountsOf({ lists }: { lists: readonly (readonly string[])[] }): readonly {
  readonly label: string;
  readonly readings: number;
}[] {
  const counts = new Map<string, number>();
  for (const list of lists) {
    for (const label of new Set(list)) {
      addTo({ by: 1, key: label, totals: counts });
    }
  }
  return [...counts.entries()]
    .map(([label, readings]) => ({ label, readings }))
    .toSorted((left, right) => right.readings - left.readings || byCodeUnit({ left: left.label, right: right.label }));
}

/**
 * The heaviest foreign labels by mean captured cpu over the readings that attributed cpu, a reading a label fell out
 * of counting as zero. PIDs churn, so a label is the process.
 *
 * @returns up to {@link TOP_FOREIGN} labels
 */
function topForeignOf({ samples }: { samples: readonly FleetWhyMachineSample[] }): FleetWhyWindow["topForeign"] {
  const attributed = samples.flatMap((sample) => (sample.foreignHogs === null ? [] : [sample.foreignHogs]));
  const sums = new Map<string, number>();
  const seen = new Map<string, number>();
  for (const hogs of attributed) {
    const perLabel = new Map<string, number>();
    for (const hog of hogs) {
      addTo({ by: hog.cpuPct, key: hog.label, totals: perLabel });
    }
    for (const [label, cpuPct] of perLabel) {
      addTo({ by: cpuPct, key: label, totals: sums });
      addTo({ by: 1, key: label, totals: seen });
    }
  }
  // Ranked on the unrounded mean, so two labels that print alike never trade places in the top few.
  return [...sums.entries()]
    .map(([label, sum]) => ({ label, mean: sum / attributed.length }))
    .toSorted((left, right) => right.mean - left.mean || byCodeUnit({ left: left.label, right: right.label }))
    .slice(0, TOP_FOREIGN)
    .map(({ label, mean }) => ({
      label,
      meanCapturedCpuPct: round1({ value: mean }),
      // Every summed label was counted seen in the same pass.
      readingsSeen: seen.get(label)!,
    }));
}

/**
 * The load hold in force at the window's peak 1-minute load — the peak's own reading, so the sentence comparing the two
 * never pairs one reading's load with another's hold.
 *
 * @returns the hold, or `null` for an empty window
 */
function peakLoadHoldOf({ samples }: { samples: readonly FleetWhyMachineSample[] }): number | null {
  let peak: FleetWhyMachineSample | undefined;
  for (const sample of samples) {
    if (peak === undefined || sample.load1 > peak.load1) {
      peak = sample;
    }
  }
  if (peak === undefined) {
    return null;
  }
  return peak.loadHold;
}

/**
 * The window's summary over the capacity readings observed inside it.
 *
 * @param readings the capacity readings observed inside the window, in any order: the ledger appends by RECORDED
 *   time, so they are put in observed order here before a `last`, an edge or a gap is read off them
 * @returns the window
 */
export function measureFleetWhyWindow({
  readings: unordered,
  fromIso,
  toIso,
  fromMs,
  toMs,
}: {
  readings: readonly FleetWhySource<FleetWhyMachineSample>[];
  fromIso: string;
  toIso: string;
  fromMs: number;
  toMs: number;
}): FleetWhyWindow {
  // An observed instant inside the window always parses: the reader selected on it. Two readings at one instant are
  // ordered by tick, then by content, so no `last` or peak ever depends on the order they arrived in.
  const readings = unordered
    .map((reading) => ({
      atMs: parseIsoMs({ tsIso: reading.observedAtIso })!,
      content: JSON.stringify(reading.value),
      reading,
    }))
    .toSorted(
      (left, right) =>
        left.atMs - right.atMs ||
        byCodeUnit({ left: left.reading.by, right: right.reading.by }) ||
        byCodeUnit({ left: left.content, right: right.content }),
    );
  const samples = readings.map(({ reading }) => reading.value);
  const held = samples.filter((sample) => sample.hold);
  const first = readings.at(0);
  const last = readings.at(-1);
  return {
    busyCores: spreadOf({ values: samples.map((sample) => sample.busyCores) }),
    firstObservedAtIso: first === undefined ? null : first.reading.observedAtIso,
    fleetCpuPct: spreadOf({ values: samples.map((sample) => sample.fleetCpuPct) }),
    fromIso,
    heldReadings: held.length,
    heldSubjects: labelCountsOf({ lists: held.map((sample) => sample.holdSubjects) }).map((count) => ({
      readings: count.readings,
      subject: count.label,
    })),
    hiddenFromTop: labelCountsOf({ lists: samples.map((sample) => sample.hiddenFromTop) }),
    lastObservedAtIso: last === undefined ? null : last.reading.observedAtIso,
    load1: spreadOf({ values: samples.map((sample) => sample.load1) }),
    loadHold: peakLoadHoldOf({ samples }),
    readings: readings.length,
    toIso,
    topForeign: topForeignOf({ samples }),
    unattributedCores: spreadOf({ values: samples.map((sample) => sample.unattributedCores) }),
    widestGapSeconds: widestGapOf({ fromMs, instants: readings.map(({ atMs }) => atMs), toMs }),
  };
}
