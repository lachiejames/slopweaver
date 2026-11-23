/**
 * The narrow reader for `slopweaver machine series --json` (`src/live/machine/series.ts`'s `MachineSeriesDocument`):
 * the last hour of the machine, newest last. Same contract as every reader beside it: a shape it does not recognise is
 * `undefined`, never a plausible substitute, and one sample that will not read refuses the whole window, because a
 * chart with a row quietly dropped draws a gap as if it were measured.
 */
import { type Bag, bags, every, instant, isBag, num, str, sub } from "../../lib/bag";
import {
  loadHoldOf,
  type MachineLoadHold,
  type MachineOther,
  type MachineSample,
  type MachineSeries,
  type MachineSessionUse,
} from "../../lib/machineSeries";

/**
 * The one window the reader accepts, the hour `MACHINE_SERIES_WINDOW_MS` (`src/live/machine/series.ts`) keeps: the
 * charts' axes, caption and labels all say "hour", so any other width would draw under a false label.
 */
const WINDOW_SECONDS = 3600;

/**
 * A figure the verb printed: finite and never negative.
 *
 * @returns the figure, or `undefined`
 */
function amount({ bag, key }: { bag: Bag; key: string }): number | undefined {
  const value = num({ bag, key });
  if (value === undefined || value < 0) {
    return undefined;
  }
  return value;
}

/**
 * A count the verb printed: a whole number of at least one.
 *
 * @returns the count, or `undefined`
 */
function positiveCount({ bag, key }: { bag: Bag; key: string }): number | undefined {
  const value = num({ bag, key });
  if (value === undefined || !Number.isInteger(value) || value < 1) {
    return undefined;
  }
  return value;
}

/**
 * One other consumer group.
 *
 * @returns the group, or `undefined`
 */
function otherOf(bag: Bag): MachineOther | undefined {
  const label = str({ bag, key: "label" });
  const cpuPct = amount({ bag, key: "cpuPct" });
  const memoryBytes = amount({ bag, key: "memoryBytes" });
  const processCount = positiveCount({ bag, key: "processCount" });
  if (label === undefined || label === "" || cpuPct === undefined || memoryBytes === undefined) {
    return undefined;
  }
  if (processCount === undefined) {
    return undefined;
  }
  return { cpuPct, label, memoryBytes, processCount };
}

/**
 * One session's tree.
 *
 * @returns the tree, or `undefined`
 */
function sessionOf(bag: Bag): MachineSessionUse | undefined {
  const sessionId = str({ bag, key: "sessionId" });
  const cpuPct = amount({ bag, key: "cpuPct" });
  const memoryBytes = amount({ bag, key: "memoryBytes" });
  const processCount = positiveCount({ bag, key: "processCount" });
  if (sessionId === undefined || sessionId === "" || cpuPct === undefined || memoryBytes === undefined) {
    return undefined;
  }
  if (processCount === undefined) {
    return undefined;
  }
  return { cpuPct, memoryBytes, processCount, sessionId };
}

/**
 * One sample, every field required.
 *
 * @returns the sample, or `undefined`
 */
function sampleOf(bag: Bag): MachineSample | undefined {
  const observedAtIso = instant({ bag, key: "observedAtIso" });
  const cores = positiveCount({ bag, key: "cores" });
  const cpu = sub({ bag, key: "cpu" });
  const load = sub({ bag, key: "load" });
  const memory = sub({ bag, key: "memory" });
  if (observedAtIso === undefined || cores === undefined || cpu === undefined || load === undefined) {
    return undefined;
  }
  if (memory === undefined) {
    return undefined;
  }
  const fleetPct = amount({ bag: cpu, key: "fleetPct" });
  const otherPct = amount({ bag: cpu, key: "otherPct" });
  const load1 = amount({ bag: load, key: "load1" });
  const holdAt = amount({ bag: load, key: "holdAt" });
  const usedBytes = amount({ bag: memory, key: "usedBytes" });
  const totalBytes = amount({ bag: memory, key: "totalBytes" });
  const compressorSegmentsPct = amount({ bag: memory, key: "compressorSegmentsPct" });
  const swapUsedGb = amount({ bag: memory, key: "swapUsedGb" });
  const swapTotalGb = amount({ bag: memory, key: "swapTotalGb" });
  const sessions = every({ list: bags({ bag, key: "sessions" }), read: sessionOf });
  const topOtherCpu = every({ list: bags({ bag, key: "topOtherCpu" }), read: otherOf });
  const topOtherMemory = every({ list: bags({ bag, key: "topOtherMemory" }), read: otherOf });
  if (fleetPct === undefined || otherPct === undefined || load1 === undefined || holdAt === undefined) {
    return undefined;
  }
  if (usedBytes === undefined || totalBytes === undefined || compressorSegmentsPct === undefined) {
    return undefined;
  }
  if (swapUsedGb === undefined || swapTotalGb === undefined || sessions === undefined) {
    return undefined;
  }
  if (topOtherCpu === undefined || topOtherMemory === undefined || usedBytes > totalBytes) {
    return undefined;
  }
  // Idle is optional (a sample written before the field existed has none), but one that is present must be a percentage.
  const idlePct = amount({ bag: cpu, key: "idlePct" });
  const idleCarried = Object.hasOwn(cpu, "idlePct");
  if (idleCarried && (idlePct === undefined || idlePct > 100)) {
    return undefined;
  }
  return {
    cores,
    cpu: { fleetPct, otherPct, ...(idlePct === undefined ? {} : { idlePct }) },
    load: { holdAt, load1 },
    memory: { compressorSegmentsPct, swapTotalGb, swapUsedGb, totalBytes, usedBytes },
    observedAtIso,
    sessions,
    topOtherCpu,
    topOtherMemory,
  };
}

/**
 * The window's hold, in whichever of its four states the verb printed.
 *
 * @returns the hold, or `undefined`
 */
function holdOf({ bag }: { bag: Bag }): MachineLoadHold | undefined {
  const kind = str({ bag, key: "kind" });
  if (kind === "clear") {
    return { kind };
  }
  if (kind === "since") {
    const startedAtIso = instant({ bag, key: "startedAtIso" });
    if (startedAtIso === undefined) {
      return undefined;
    }
    return { kind, startedAtIso };
  }
  if (kind === "after-gap") {
    const earliestHeldIso = instant({ bag, key: "earliestHeldIso" });
    if (earliestHeldIso === undefined) {
      return undefined;
    }
    return { earliestHeldIso, kind };
  }
  if (kind === "before-window") {
    const oldestObservedAtIso = instant({ bag, key: "oldestObservedAtIso" });
    if (oldestObservedAtIso === undefined) {
      return undefined;
    }
    return { kind, oldestObservedAtIso };
  }
  return undefined;
}

/**
 * The one instant a hold names, so two holds compare by kind and instant alone.
 *
 * @returns the instant, or `undefined` for a clear one
 */
function holdInstantOf({ hold }: { hold: MachineLoadHold }): string | undefined {
  if (hold.kind === "since") {
    return hold.startedAtIso;
  }
  if (hold.kind === "after-gap") {
    return hold.earliestHeldIso;
  }
  if (hold.kind === "before-window") {
    return hold.oldestObservedAtIso;
  }
  return undefined;
}

/**
 * Whether the printed hold is the one the samples themselves show, so a marker never names an instant no sample
 * observed or a hold a sample saw clear.
 *
 * @returns true when the kind and its instant both match {@link loadHoldOf}'s
 */
function holdMatchesSamples({
  hold,
  samples,
  minimumSampleGapSeconds,
}: {
  hold: MachineLoadHold;
  samples: readonly MachineSample[];
  minimumSampleGapSeconds: number;
}): boolean {
  const derived = loadHoldOf({ minimumSampleGapSeconds, samples });
  return derived.kind === hold.kind && holdInstantOf({ hold: derived }) === holdInstantOf({ hold });
}

/**
 * Project `machine series --json` into the charts' shape.
 *
 * @returns the window, or `undefined` when the payload is not one, a sample will not read, the samples are out of
 *   order, the document's instant is not its newest sample's, the window is not the hour or narrower than the gap, or
 *   the samples span more than the window, the samples disagree on the core count or the hold, or the hold is not
 *   the one the samples show
 */
export function readMachineSeries(payload: unknown): MachineSeries | undefined {
  if (!isBag(payload)) {
    return undefined;
  }
  const observedAtIso = instant({ bag: payload, key: "observedAtIso" });
  const windowSeconds = positiveCount({ bag: payload, key: "windowSeconds" });
  const minimumSampleGapSeconds = positiveCount({ bag: payload, key: "minimumSampleGapSeconds" });
  const holdBag = sub({ bag: payload, key: "currentLoadHold" });
  const samples = every({ list: bags({ bag: payload, key: "samples" }), read: sampleOf });
  if (observedAtIso === undefined || windowSeconds === undefined || minimumSampleGapSeconds === undefined) {
    return undefined;
  }
  if (holdBag === undefined || samples === undefined || samples.length === 0) {
    return undefined;
  }
  const currentLoadHold = holdOf({ bag: holdBag });
  if (currentLoadHold === undefined || samples.at(-1)!.observedAtIso !== observedAtIso) {
    return undefined;
  }
  const ordered = samples.every(
    (sample, index) => index === 0 || Date.parse(samples[index - 1].observedAtIso) < Date.parse(sample.observedAtIso),
  );
  if (!ordered) {
    return undefined;
  }
  // Every figure `runsOf` compares is then a whole millisecond count far under 2^53, so a gap is exact.
  const spanMs = Date.parse(observedAtIso) - Date.parse(samples[0].observedAtIso);
  if (windowSeconds !== WINDOW_SECONDS || minimumSampleGapSeconds > windowSeconds) {
    return undefined;
  }
  if (spanMs > windowSeconds * 1000) {
    return undefined;
  }
  // The verb derives the hold from the core count (`loadHoldFor`), both fixed per machine, and the charts draw the
  // newest's across the whole window, so a window that varies either is one it never printed.
  const newest = samples.at(-1)!;
  const oneMachine = samples.every(
    (sample) => sample.cores === newest.cores && sample.load.holdAt === newest.load.holdAt,
  );
  if (!oneMachine || !holdMatchesSamples({ hold: currentLoadHold, minimumSampleGapSeconds, samples })) {
    return undefined;
  }
  return { currentLoadHold, minimumSampleGapSeconds, observedAtIso, samples, windowSeconds };
}
