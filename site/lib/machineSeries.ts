/**
 * The Fleet page's machine charts, as arithmetic: what `slopweaver machine series --json` prints, where each sample
 * sits on a chart, and the words each one is named by. Pure; `../components/live/MachineCharts*.tsx` only draws.
 *
 * The page reads the machine's load as charts, not bare numbers, because bare numbers are not believable and are read
 * up to an hour late. The owner wants CPU and memory over time the way Activity Monitor draws them, real time, with the
 * hold's cutoff and the moment the hold started on it, fleet split from everything else, and one beside each session.
 * These charts live in the Past view; the live figures and each session's own CPU and memory are Now's two-second
 * Machine tile (`./liveMachineView.ts`).
 *
 * Two rules decide the shapes here. A stretch with no sample is a GAP in the line, never a line drawn across it: the
 * verb samples only while a page polls it, so an hour with the page closed was not measured and must not look as if it
 * were. And the load hold is a LOAD figure, so its line sits on the load chart, never on the CPU one.
 */
import { ageAt } from "./ageOf";

/** One session's whole process tree in one sample. */
export interface MachineSessionUse {
  /** The bare Claude Code session id, the card's `transcriptId`. */
  readonly sessionId: string;
  readonly cpuPct: number;
  readonly memoryBytes: number;
  readonly processCount: number;
}

/** One group of other processes sharing a `comm` name. */
export interface MachineOther {
  readonly label: string;
  readonly cpuPct: number;
  readonly memoryBytes: number;
  readonly processCount: number;
}

/** One sample of the machine. */
export interface MachineSample {
  readonly observedAtIso: string;
  readonly cores: number;
  /** `idlePct` is `top`'s whole-machine idle, absent on a sample written before the verb recorded it. */
  readonly cpu: { readonly fleetPct: number; readonly otherPct: number; readonly idlePct?: number };
  readonly load: { readonly load1: number; readonly holdAt: number };
  readonly memory: {
    readonly usedBytes: number;
    readonly totalBytes: number;
    readonly compressorSegmentsPct: number;
    readonly swapUsedGb: number;
    readonly swapTotalGb: number;
  };
  readonly sessions: readonly MachineSessionUse[];
  readonly topOtherCpu: readonly MachineOther[];
  readonly topOtherMemory: readonly MachineOther[];
}

/** Whether the load is over its hold now, and since when as far as the window can see. */
export type MachineLoadHold =
  | { readonly kind: "clear" }
  | { readonly kind: "since"; readonly startedAtIso: string }
  | { readonly kind: "after-gap"; readonly earliestHeldIso: string }
  | { readonly kind: "before-window"; readonly oldestObservedAtIso: string };

/** What the verb prints: the window, newest last. */
export interface MachineSeries {
  /** The newest sample's instant. */
  readonly observedAtIso: string;
  readonly windowSeconds: number;
  readonly minimumSampleGapSeconds: number;
  /** Oldest first, never empty. */
  readonly samples: readonly MachineSample[];
  readonly currentLoadHold: MachineLoadHold;
}

/** The box a chart draws in, and the span of time across it. */
export interface ChartFrame {
  readonly fromMs: number;
  readonly toMs: number;
  readonly width: number;
  readonly height: number;
}

/** One point on a chart, in the frame's own units. */
export interface ChartPoint {
  readonly x: number;
  readonly y: number;
}

/**
 * How many minimum gaps two samples may sit apart and still be joined by a line. The verb's
 * `MACHINE_SERIES_JOIN_GAPS` (`src/live/machine/series.ts`) dates a hold on the same bound. An open page samples about every
 * forty seconds (a thirty-second gap met on a twenty-second poll), and a poll held behind the three shared read slots
 * lands later still, so a tighter join would break an open page's own line. The page says this bound in words
 * ({@link joinWordsOf}) rather than claiming every unsampled moment is a gap.
 */
const JOIN_GAPS = 4;

/**
 * The longest stretch without a sample that is still drawn as a line, in words.
 *
 * @returns e.g. "two minutes" for a thirty-second gap
 */
export function joinWordsOf({ series }: { series: MachineSeries }): string {
  const seconds = series.minimumSampleGapSeconds * JOIN_GAPS;
  if (seconds % 60 !== 0) {
    return `${String(seconds)} seconds`;
  }
  const minutes = seconds / 60;
  if (minutes === 1) {
    return "a minute";
  }
  if (minutes === 2) {
    return "two minutes";
  }
  return `${String(minutes)} minutes`;
}

/**
 * The frame for a series: its whole window, ending at the newest sample.
 *
 * @returns the frame
 */
export function frameOf({
  series,
  width,
  height,
}: {
  series: MachineSeries;
  width: number;
  height: number;
}): ChartFrame {
  const toMs = Date.parse(series.observedAtIso);
  return { fromMs: toMs - series.windowSeconds * 1000, height, toMs, width };
}

/**
 * Where an instant sits across the frame, clamped inside it.
 *
 * @returns the x
 */
export function xOf({ iso, frame }: { iso: string; frame: ChartFrame }): number {
  const span = frame.toMs - frame.fromMs;
  const at = (Date.parse(iso) - frame.fromMs) / span;
  return Math.min(frame.width, Math.max(0, at * frame.width));
}

/**
 * Where a value sits up the frame, zero on its floor and `top` at its ceiling.
 *
 * @param top the value the frame's ceiling stands for
 * @returns the y, SVG-down
 */
export function yOf({ value, top, frame }: { value: number; top: number; frame: ChartFrame }): number {
  const share = Math.min(1, Math.max(0, value / top));
  return frame.height - share * frame.height;
}

/**
 * The samples split wherever two neighbours sit further apart than {@link JOIN_GAPS} minimum gaps, so a stretch
 * nobody measured for longer than that draws as a gap.
 *
 * @returns the runs, oldest first, each non-empty
 */
export function runsOf({ series }: { series: MachineSeries }): readonly (readonly MachineSample[])[] {
  const joinMs = series.minimumSampleGapSeconds * 1000 * JOIN_GAPS;
  const runs: MachineSample[][] = [];
  let previousMs: number | undefined;
  for (const sample of series.samples) {
    const atMs = Date.parse(sample.observedAtIso);
    const run = runs.at(-1);
    if (run === undefined || previousMs === undefined || atMs - previousMs > joinMs) {
      runs.push([sample]);
    } else {
      run.push(sample);
    }
    previousMs = atMs;
  }
  return runs;
}

/**
 * The idle percentage at or above which a load over its hold does not hold — `IDLE_HOLD_FLOOR_PCT` in
 * `src/live/machine/capacityHolds.ts`, mirrored because the site cannot import it, and pinned equal by a test.
 */
export const IDLE_HOLD_FLOOR_PCT = 20;

/**
 * Whether one sample holds, by the verb's `cpuLoadHolding`: load at or over its hold while idle is under
 * {@link IDLE_HOLD_FLOOR_PCT}, or load alone when the sample carries no idle.
 *
 * @returns true when held
 */
export function sampleHeld({ sample }: { sample: MachineSample }): boolean {
  if (sample.load.load1 < sample.load.holdAt) {
    return false;
  }
  return sample.cpu.idlePct === undefined || sample.cpu.idlePct < IDLE_HOLD_FLOOR_PCT;
}

/**
 * The hold the samples themselves show, by the verb's own rule (`currentLoadHoldOf`, `src/live/machine/series.ts`):
 * walk back from the newest while held, stopping at a clear sample or at a gap {@link runsOf} would draw. The reader
 * refuses a payload whose hold disagrees, so a marker only ever names what a sample observed.
 *
 * @param samples the window, oldest first and non-empty
 * @param minimumSampleGapSeconds the verb's cadence, which bounds a measured stretch
 * @returns the hold
 */
export function loadHoldOf({
  samples,
  minimumSampleGapSeconds,
}: {
  samples: readonly MachineSample[];
  minimumSampleGapSeconds: number;
}): MachineLoadHold {
  const held = (sample: MachineSample): boolean => sampleHeld({ sample });
  const newest = samples.at(-1);
  if (newest === undefined || !held(newest)) {
    return { kind: "clear" };
  }
  const joinMs = minimumSampleGapSeconds * 1000 * JOIN_GAPS;
  for (let at = samples.length - 2; at >= 0; at -= 1) {
    const after = samples[at + 1];
    if (Date.parse(after.observedAtIso) - Date.parse(samples[at].observedAtIso) > joinMs) {
      return { earliestHeldIso: after.observedAtIso, kind: "after-gap" };
    }
    if (!held(samples[at])) {
      return { kind: "since", startedAtIso: after.observedAtIso };
    }
  }
  return { kind: "before-window", oldestObservedAtIso: samples[0].observedAtIso };
}

/**
 * An SVG path through points, or a short flat dash for a lone one so a single sample still shows.
 *
 * @returns the path's `d`
 */
export function linePath({ points }: { points: readonly ChartPoint[] }): string {
  const first = points.at(0);
  if (first === undefined) {
    return "";
  }
  if (points.length === 1) {
    return `M${String(first.x - 1)},${String(first.y)}L${String(first.x + 1)},${String(first.y)}`;
  }
  return points.map((point, index) => `${index === 0 ? "M" : "L"}${String(point.x)},${String(point.y)}`).join("");
}

/**
 * A filled band between an upper and a lower edge over the same xs, closed back along the lower one.
 *
 * @returns the path's `d`
 */
export function bandPath({ upper, lower }: { upper: readonly ChartPoint[]; lower: readonly ChartPoint[] }): string {
  if (upper.length === 0) {
    return "";
  }
  let top = upper;
  let bottom = lower;
  if (upper.length === 1) {
    // A lone sample is a sliver two units wide, so it shows rather than vanishing into a zero-width polygon.
    const [u] = upper;
    const [l] = lower;
    top = [
      { x: u.x - 1, y: u.y },
      { x: u.x + 1, y: u.y },
    ];
    bottom = [
      { x: l.x - 1, y: l.y },
      { x: l.x + 1, y: l.y },
    ];
  }
  const back = bottom.toReversed().map((point) => `L${String(point.x)},${String(point.y)}`);
  return `${linePath({ points: top })}${back.join("")}Z`;
}

/**
 * The CPU chart's ceiling in cores: the machine's cores, or more when `top`'s per-process sums ran past them.
 *
 * @returns the ceiling
 */
export function cpuTopOf({ series }: { series: MachineSeries }): number {
  return series.samples.reduce(
    (top, sample) => Math.max(top, sample.cores, (sample.cpu.fleetPct + sample.cpu.otherPct) / 100),
    1,
  );
}

/**
 * The load chart's ceiling: the hold with headroom over it, or the highest load the window saw.
 *
 * @returns the ceiling
 */
export function loadTopOf({ series }: { series: MachineSeries }): number {
  const highest = series.samples.reduce(
    (top, sample) => Math.max(top, sample.load.load1, sample.load.holdAt * 1.25),
    1,
  );
  return Math.ceil(highest);
}

/**
 * The memory chart's ceiling: the machine's physical memory.
 *
 * @returns the ceiling in bytes
 */
export function memoryTopOf({ series }: { series: MachineSeries }): number {
  return series.samples.reduce((top, sample) => Math.max(top, sample.memory.totalBytes, sample.memory.usedBytes), 1);
}

/**
 * Bytes as gigabytes to one decimal.
 *
 * @returns the figure, unit included
 */
export function gbWords({ bytes }: { bytes: number }): string {
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}

/**
 * `top`'s percentage of one core as cores, one decimal.
 *
 * @returns the figure, unit included
 */
export function coresWords({ pct }: { pct: number }): string {
  return `${(pct / 100).toFixed(1)} cores`;
}

/** How often the charts re-read the wall clock, so a label can be stale by at most this between two reads. */
export const NOW_TICK_MS = 10_000;

/**
 * The oldest a newest sample may be, at the clock's last read, and still be called "now": a minute less one tick, so
 * between two reads a "now" never sits on a sample a minute old or more.
 *
 * What this does not close: a tick the browser delivers late, a blocked main thread or a throttled tab,
 * leaves the last render's words standing past the minute. No rendered label survives that, whatever its rule, since
 * nothing repaints until the thread runs again; the freshness line's dated "live sample" age is the honest reading
 * on the next repaint.
 */
const NOW_MS = 60_000 - NOW_TICK_MS;

/**
 * The word the charts end their axis and their figures on, judged by the newest sample's AGE rather than by how the
 * reading reached the page: a reading kept after a failed poll and one kept over a remount while it
 * refreshes are both old, and both are dated rather than called "now".
 *
 * @param nowMs the page's clock, read when it renders
 * @returns "now" for a sample still under a minute old at the next clock read, else "at 14:52"
 */
export function endWordOf({
  series,
  nowMs,
  timeZone,
}: {
  series: MachineSeries;
  nowMs: number;
  timeZone: string;
}): string {
  // A sample the wall clock has stepped back behind, by any amount, has not happened yet on this clock, so it is
  // dated too.
  const ageMs = nowMs - Date.parse(series.observedAtIso);
  if (ageMs >= 0 && ageMs < NOW_MS) {
    return "now";
  }
  return `at ${clockLabel({ iso: series.observedAtIso, timeZone })}`;
}

/**
 * The time axis's left end, the window's own start on the owner's clock. Never relative: "an hour ago" is false of a stale or
 * future-dated window, whose start is not an hour before the page's clock.
 *
 * @returns e.g. "from 13:52"
 */
export function startWordOf({ series, timeZone }: { series: MachineSeries; timeZone: string }): string {
  // The frame's own left edge, as `frameOf` computes it.
  const fromMs = Date.parse(series.observedAtIso) - series.windowSeconds * 1000;
  const fromIso = new Date(fromMs).toISOString();
  return `from ${clockLabel({ iso: fromIso, timeZone })}`;
}

/**
 * An instant's age on the freshness line, the live sample's or the fleet verdict's reading, measured to the same
 * `nowMs` the axes' words are, so one render never reads two clocks. `ageAt` clamps a negative age to
 * "just now", so an instant the wall clock has stepped back behind, by any amount, is dated instead.
 *
 * @param iso when the reading was taken
 * @param nowMs the page's clock, read once when it renders
 * @returns e.g. "14s ago", or "stamped 08:04, ahead of this clock"
 */
export function ageWordsOf({ iso, nowMs, timeZone }: { iso: string; nowMs: number; timeZone: string }): string {
  if (Date.parse(iso) > nowMs) {
    return `stamped ${clockLabel({ iso, timeZone })}, ahead of this clock`;
  }
  return ageAt({ iso, nowMs });
}

/**
 * An instant as the owner's wall clock prints it, `14:52`.
 *
 * @param timeZone an IANA zone, the owner's browser's own
 * @returns the label
 */
export function clockLabel({ iso, timeZone }: { iso: string; timeZone: string }): string {
  return new Date(Date.parse(iso)).toLocaleTimeString("en-AU", {
    hour: "2-digit",
    hour12: false,
    minute: "2-digit",
    timeZone,
  });
}

/**
 * One sample said in full: the hover title on its slot and its row in the table.
 *
 * @returns the sentence
 */
export function sampleWords({ sample, timeZone }: { sample: MachineSample; timeZone: string }): string {
  const cpu = `CPU fleet ${coresWords({ pct: sample.cpu.fleetPct })}, other ${coresWords({ pct: sample.cpu.otherPct })} of ${String(sample.cores)}`;
  const load = `load ${String(sample.load.load1)} against a hold at ${String(sample.load.holdAt)}`;
  const memory = `memory ${gbWords({ bytes: sample.memory.usedBytes })} of ${gbWords({ bytes: sample.memory.totalBytes })}`;
  return `${clockLabel({ iso: sample.observedAtIso, timeZone })}: ${cpu}; ${load}; ${memory}`;
}

/**
 * The hold as the load chart marks it: where the vertical "held from" line goes, and the words under the chart.
 *
 * @returns nothing to mark when clear, else the marker's x (absent when every sample kept is held, so no start was seen) and words
 */
export function holdMarkerOf({
  series,
  frame,
  timeZone,
}: {
  series: MachineSeries;
  frame: ChartFrame;
  timeZone: string;
}): { readonly x: number | undefined; readonly words: string } | undefined {
  const hold = series.currentLoadHold;
  if (hold.kind === "clear") {
    return undefined;
  }
  if (hold.kind === "since") {
    return {
      words: `held since ${clockLabel({ iso: hold.startedAtIso, timeZone })}`,
      x: xOf({ frame, iso: hold.startedAtIso }),
    };
  }
  if (hold.kind === "after-gap") {
    return {
      words: `held since at least ${clockLabel({ iso: hold.earliestHeldIso, timeZone })}, unsampled before it`,
      x: xOf({ frame, iso: hold.earliestHeldIso }),
    };
  }
  return {
    words: `held since at least ${clockLabel({ iso: hold.oldestObservedAtIso, timeZone })}, the oldest sample kept`,
    x: undefined,
  };
}
