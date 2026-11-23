/**
 * Every word and figure the Fleet page's live machine block draws, off one held reading. Pure, so the exact sentences
 * are tested rather than eyeballed.
 *
 * Every figure is used out of total. The
 * heaviest process outside the fleet earns its place only where it explains why the fleet is not spawning, folded
 * into the numbers. So a meter names it only when it outweighs the whole fleet on that meter.
 *
 * The verdict is the MACHINE half of whether the fleet may take another session, judged on this same live reading by
 * the supervisor's own thresholds (`src/live/machine/cpuLoadHold.ts` and `capacity.ts`), restated here because
 * `site/` never imports `src/`; `site/__tests__/unit/liveMachineMirror.test.ts` binds every number to its original.
 */
import type { LiveMachineReading, LiveSessionUse } from "./liveMachine";
import { type LiveFreshness, type LiveMachineHeld, liveFreshnessOf } from "./liveMachineClient";
import { gbWords, IDLE_HOLD_FLOOR_PCT } from "./machineSeries";

/** The 1-minute load a spawn holds at, per core (`src/live/machine/cpuLoadHold.ts`). */
export const LOAD_HOLD_PER_CORE = 3;

/** Compressor segments in use, as a percentage of their limit, at which memory holds (`capacity.ts`). */
export const SEGMENTS_HOLD_PCT = 40;

/** Swapfiles on disk at which memory holds (`capacity.ts`). */
export const SWAPFILE_HOLD_COUNT = 12;

/** How many live sessions the table names before it counts the rest. */
export const SESSIONS_SHOWN = 5;

/** One coloured stretch of a meter's bar, as a percentage of the bar. */
export interface MeterSegment {
  readonly tone: "fleet" | "other";
  readonly pct: number;
}

/** One meter. */
export interface MeterView {
  readonly label: string;
  /** The figure, large. */
  readonly value: string;
  /** What it is out of, beside the figure. */
  readonly of: string;
  readonly segments: readonly MeterSegment[];
  readonly detail: string;
}

/** One live session's row; its title is joined on the page, by session id. */
export interface LiveSessionRow {
  readonly sessionId: string;
  readonly cpu: string;
  readonly memory: string;
}

/** The whole block. */
export interface LiveMachineView {
  readonly freshness: LiveFreshness;
  readonly verdict: { readonly tone: "room" | "held" | "unread"; readonly words: string };
  readonly meters: readonly MeterView[];
  readonly rows: readonly LiveSessionRow[];
  /** How many live sessions the table leaves out. */
  readonly more: number;
}

/**
 * The load a machine with this many cores holds at: `floor(3 x cores)`.
 *
 * @returns the hold
 */
export function loadHoldAt({ cores }: { cores: number }): number {
  return Math.floor(cores * LOAD_HOLD_PER_CORE);
}

/**
 * A figure to one decimal place.
 *
 * @returns the words
 */
function one({ value }: { value: number }): string {
  return value.toFixed(1);
}

/**
 * A share of a whole as a bar percentage, never past the whole.
 *
 * @returns the percentage
 */
function pctOf({ part, whole }: { part: number; whole: number }): number {
  if (whole <= 0) {
    return 0;
  }
  return Math.min(100, Math.max(0, Math.round((part / whole) * 1000) / 10));
}

/**
 * The CPU meter: busy cores out of all of them, split fleet and everything else.
 *
 * @returns the meter
 */
function cpuMeter({ reading }: { reading: LiveMachineReading }): MeterView {
  const { busyCores, fleetCores, otherCores } = reading.cpu;
  const of = `of ${String(reading.cores)} cores busy`;
  if (busyCores === undefined || fleetCores === undefined || otherCores === undefined) {
    return {
      detail: "CPU is the change between two readings, and the first two-second interval is still being measured.",
      label: "CPU",
      of,
      segments: [],
      value: "measuring",
    };
  }
  // Fleet and everything else are rounded so they add up to the busy figure drawn above them.
  const busy = Number(one({ value: busyCores }));
  const fleet = Number(one({ value: fleetCores }));
  const other = Math.max(0, busy - fleet);
  let detail = `fleet ${one({ value: fleet })} · everything else ${one({ value: other })} · free ${one({ value: Math.max(0, reading.cores - busy) })}`;
  const outsider = reading.topOtherCpu;
  if (outsider?.cpuCores !== undefined && outsider.cpuCores > fleetCores) {
    detail += ` · ${outsider.label} ${one({ value: outsider.cpuCores })} cores, more than the whole fleet`;
  }
  return {
    detail,
    label: "CPU",
    of,
    segments: [
      { pct: pctOf({ part: fleet, whole: reading.cores }), tone: "fleet" },
      { pct: pctOf({ part: other, whole: reading.cores }), tone: "other" },
    ],
    value: one({ value: busy }),
  };
}

/**
 * The memory meter: memory in use, as Activity Monitor counts it, out of the machine's, split fleet and everything else.
 *
 * @returns the meter
 */
function memoryMeter({ reading }: { reading: LiveMachineReading }): MeterView {
  const { usedBytes, totalBytes, fleetBytes } = reading.memory;
  let detail = `fleet ${gbWords({ bytes: fleetBytes })} · free ${gbWords({ bytes: totalBytes - usedBytes })}`;
  const outsider = reading.topOtherMemory;
  if (outsider !== undefined && outsider.memoryBytes > fleetBytes) {
    detail += ` · ${outsider.label} ${gbWords({ bytes: outsider.memoryBytes })}, more than the whole fleet`;
  }
  return {
    detail,
    label: "Memory",
    of: `of ${gbWords({ bytes: totalBytes })} used`,
    segments: [
      { pct: pctOf({ part: fleetBytes, whole: totalBytes }), tone: "fleet" },
      { pct: pctOf({ part: usedBytes - fleetBytes, whole: totalBytes }), tone: "other" },
    ],
    value: gbWords({ bytes: usedBytes }).replace(" GB", ""),
  };
}

/**
 * The load meter, out of the load that holds a new session.
 *
 * @returns the meter
 */
function loadMeter({ reading }: { reading: LiveMachineReading }): MeterView {
  const holdAt = loadHoldAt({ cores: reading.cores });
  return {
    detail: `Work running or waiting for a core. It only holds when the CPU is also under ${String(IDLE_HOLD_FLOOR_PCT)}% idle.`,
    label: "Load",
    of: `holds new sessions at ${String(holdAt)}`,
    segments: [{ pct: pctOf({ part: reading.load1, whole: holdAt }), tone: "fleet" }],
    value: one({ value: reading.load1 }),
  };
}

/**
 * Why the machine holds a new session now, by the supervisor's thresholds; memory pressure unread is its own answer.
 *
 * @returns the reasons, empty when nothing holds, or `"unread"` when neither memory gauge read
 */
export function machineHoldsOf({ reading }: { reading: LiveMachineReading }): readonly string[] | "unread" {
  const { compressorSegmentsPct, swapfileCount } = reading.memory;
  if (compressorSegmentsPct === undefined && swapfileCount === undefined) {
    return "unread";
  }
  const reasons: string[] = [];
  const holdAt = loadHoldAt({ cores: reading.cores });
  const idle = reading.cpu.idlePct;
  if (reading.load1 >= holdAt && (idle === undefined || idle < IDLE_HOLD_FLOOR_PCT)) {
    let idleWords = "idle CPU not measured yet";
    if (idle !== undefined) {
      idleWords = `${String(Math.round(idle))}% idle CPU`;
    }
    reasons.push(`load ${one({ value: reading.load1 })} at or over the hold at ${String(holdAt)}, with ${idleWords}`);
  }
  if (compressorSegmentsPct !== undefined && compressorSegmentsPct >= SEGMENTS_HOLD_PCT) {
    reasons.push(
      `compressor at ${String(compressorSegmentsPct)}% of its segments limit, hold at ${String(SEGMENTS_HOLD_PCT)}%`,
    );
  }
  if (swapfileCount !== undefined && swapfileCount >= SWAPFILE_HOLD_COUNT) {
    reasons.push(`${String(swapfileCount)} swapfiles, hold at ${String(SWAPFILE_HOLD_COUNT)}`);
  }
  return reasons;
}

/**
 * The verdict line.
 *
 * @returns the tone and words
 */
function verdictOf({ reading }: { reading: LiveMachineReading }): LiveMachineView["verdict"] {
  const holds = machineHoldsOf({ reading });
  if (holds === "unread") {
    return {
      tone: "unread",
      words: "Whether this machine has room is not measured: neither memory pressure gauge read.",
    };
  }
  if (holds.length > 0) {
    return { tone: "held", words: `This machine holds new sessions: ${holds.join("; ")}.` };
  }
  const free = gbWords({ bytes: reading.memory.totalBytes - reading.memory.usedBytes });
  return {
    tone: "room",
    words: `Room for more sessions on this machine: load ${one({ value: reading.load1 })} against the hold at ${String(loadHoldAt({ cores: reading.cores }))}, and ${free} of memory free.`,
  };
}

/**
 * A session's CPU for sorting; an unmeasured one sorts below every measured one.
 *
 * @returns the weight
 */
function cpuWeight({ session }: { session: LiveSessionUse }): number {
  if (session.cpuCores === undefined) {
    return -1;
  }
  return session.cpuCores;
}

/**
 * The live sessions, heaviest CPU first, then memory, then id.
 *
 * @returns the rows shown, and how many more there are
 */
export function sessionRowsOf({ sessions }: { sessions: readonly LiveSessionUse[] }): {
  rows: readonly LiveSessionRow[];
  more: number;
} {
  const sorted = sessions.toSorted(
    (a, b) =>
      cpuWeight({ session: b }) - cpuWeight({ session: a }) ||
      b.memoryBytes - a.memoryBytes ||
      a.sessionId.localeCompare(b.sessionId),
  );
  const rows = sorted.slice(0, SESSIONS_SHOWN).map((session): LiveSessionRow => {
    let cpu = "measuring";
    if (session.cpuCores !== undefined) {
      cpu = `${session.cpuCores.toFixed(2)} cores`;
    }
    return { cpu, memory: gbWords({ bytes: session.memoryBytes }), sessionId: session.sessionId };
  });
  return { more: Math.max(0, sorted.length - SESSIONS_SHOWN), rows };
}

/**
 * The block, off the held reading.
 *
 * @param held what the page holds
 * @param nowMs the page's clock, which ages the stamp
 * @returns the view, or `undefined` while no reading has answered yet
 */
export function liveMachineViewOf({
  held,
  nowMs,
}: {
  held: LiveMachineHeld;
  nowMs: number;
}): LiveMachineView | undefined {
  const reading = held.reading;
  if (reading === undefined) {
    return undefined;
  }
  const sessions = sessionRowsOf({ sessions: reading.sessions });
  const count = reading.sessions.length;
  return {
    freshness: liveFreshnessOf({ nowMs, observedAtIso: reading.observedAtIso, why: held.why }),
    meters: [
      cpuMeter({ reading }),
      memoryMeter({ reading }),
      loadMeter({ reading }),
      {
        detail: "Counted from the processes themselves, so the count does not depend on cmux.",
        label: "Live sessions",
        of: "running now",
        segments: [],
        value: String(count),
      },
    ],
    more: sessions.more,
    rows: sessions.rows,
    verdict: verdictOf({ reading }),
  };
}
