/**
 * The Fleet page's live machine reading: what the console server reads every two seconds while a Now tab is open,
 * turned into the figures its four meters and session table draw. Pure; the reads are `./liveMachineRead.ts`'s.
 *
 * The owner wants live numbers like `top`, each reading saying how old it is, with two-second updates of CPU, memory
 * and sessions. So CPU is the kernel's own
 * busy count, the figure `top`'s header and Activity Monitor show, taken as the difference between two snapshots of
 * `os.cpus()` counters; a process's share is the difference between two snapshots of its CPU time. A reading with no
 * baseline carries no CPU at all rather than a guess; the server warms one first (`./liveMachineRead.ts`).
 *
 * Who is fleet restates `src/live/machine/series.ts`: a pid is fleet when it, or an ancestor, is a live Claude Code
 * session root, an orphaned Claude tool shell, or a process whose argv names claude, cmux or slopweaver; the nearest
 * undisputed session root owns the tree. Other processes are named by `comm`, never argv.
 */

import { err, ok, type Result } from "neverthrow";
import { type LiveMachineError, LiveMachineErrors, type LiveProcessStat } from "./liveMachineParse";
import { argvSessionIdOf } from "./liveSessionArgv";

/** The kernel's per-core counters, summed. */
export interface CpuTickSnapshot {
  readonly cores: number;
  readonly idleMs: number;
  readonly totalMs: number;
}

/** A session root the registry names: the `claude` pid and the session id it runs. */
export interface LiveSessionRoot {
  readonly pid: number;
  readonly sessionId: string;
}

/** Everything one read captured, kept server-side as the next read's baseline. */
export interface LiveMachineSnapshot {
  readonly observedAtIso: string;
  readonly monotonicMs: number;
  readonly cpu: CpuTickSnapshot;
  readonly load1: number;
  readonly totalMemoryBytes: number;
  readonly usedMemoryBytes: number;
  readonly processes: readonly LiveProcessStat[];
  readonly argvByPid: ReadonlyMap<number, string>;
  readonly registry: readonly LiveSessionRoot[];
  readonly compressorSegmentsPct: number | undefined;
  readonly swapfileCount: number | undefined;
  readonly diagnostics: readonly string[];
}

/** One live session's whole process tree. */
export interface LiveSessionUse {
  /** The Claude Code session id, the bare uuid a Fleet card's transcript opens by. */
  readonly sessionId: string;
  /** Cores the tree used over the interval; `undefined` on the first read. */
  readonly cpuCores: number | undefined;
  /** Resident memory summed over the tree, which can count a shared page twice. */
  readonly memoryBytes: number;
  readonly processCount: number;
}

/** The heaviest group of processes outside the fleet sharing one `comm` name. */
export interface LiveOtherUse {
  readonly label: string;
  readonly cpuCores: number | undefined;
  readonly memoryBytes: number;
}

/** One live reading, as the route serves it. */
export interface LiveMachineReading {
  readonly observedAtIso: string;
  readonly cores: number;
  /** Every figure is `undefined` on the first read, which has no earlier snapshot to measure an interval from. */
  readonly cpu: {
    readonly busyCores: number | undefined;
    readonly idlePct: number | undefined;
    readonly fleetCores: number | undefined;
    readonly otherCores: number | undefined;
  };
  readonly load1: number;
  readonly memory: {
    readonly usedBytes: number;
    readonly totalBytes: number;
    /** Fleet resident memory, never more than `usedBytes`. */
    readonly fleetBytes: number;
    readonly compressorSegmentsPct: number | undefined;
    readonly swapfileCount: number | undefined;
  };
  readonly sessions: readonly LiveSessionUse[];
  readonly topOtherCpu: LiveOtherUse | undefined;
  readonly topOtherMemory: LiveOtherUse | undefined;
  readonly diagnostics: readonly string[];
}

/**
 * The oldest a baseline may be and still be differenced against. A page reads every two seconds, so a baseline older
 * than this was left by a tab since closed or hidden, and CPU against it would be an average over however long
 * nobody looked, drawn as live.
 */
export const BASELINE_FRESH_MS = 10_000;

/**
 * The baseline a read may difference against: the last snapshot, when it is fresh.
 *
 * @param baseline the last complete snapshot this server took, when there is one
 * @param nowMs the server's monotonic clock now
 * @returns the baseline, or `undefined` when there is none fit to measure an interval from
 */
export function freshBaselineOf({
  baseline,
  nowMs,
}: {
  baseline: LiveMachineSnapshot | undefined;
  nowMs: number;
}): LiveMachineSnapshot | undefined {
  if (baseline === undefined || nowMs - baseline.monotonicMs > BASELINE_FRESH_MS) {
    return undefined;
  }
  return baseline;
}

/** What makes a process fleet in itself, `src/live/machine/classify.ts`'s pattern. */
const FLEET_ARGV = /\bclaude\b|cmux|slopweaver/iu;

/** A Claude Code tool shell's snapshot, `src/live/machine/fleetLoad.ts`'s pattern. */
const SHELL_SNAPSHOT = /(\/[^\s'"]*\/shell-snapshots\/snapshot-[^\s'"]+\.sh)/u;

/** The pid every orphan reparents to. */
const LAUNCHD_PID = 1;

/** Where one pid sits. */
interface Placement {
  readonly fleet: boolean;
  readonly sessionId: string | undefined;
}

/**
 * Every pid's placement: climb its parent chain, itself first, to the nearest session root; a disputed root, a
 * session root or a fleet-in-itself ancestor makes it fleet.
 *
 * @returns placement by pid
 */
function placementsOf({ snapshot }: { snapshot: LiveMachineSnapshot }): ReadonlyMap<number, Placement> {
  const registry = new Map(snapshot.registry.map((root) => [root.pid, root.sessionId]));
  const sessionByPid = new Map<number, string>();
  const disputed = new Set<number>();
  const fleetSelf = new Set<number>();
  const ppidOf = new Map(snapshot.processes.map((row) => [row.pid, row.ppid]));
  for (const row of snapshot.processes) {
    const argv = snapshot.argvByPid.get(row.pid);
    const fromRegistry = registry.get(row.pid);
    const fromArgv = argv === undefined ? undefined : argvSessionIdOf({ argv });
    if (fromRegistry !== undefined && fromArgv !== undefined && fromRegistry !== fromArgv) {
      disputed.add(row.pid);
    } else if (fromRegistry !== undefined) {
      sessionByPid.set(row.pid, fromRegistry);
    } else if (fromArgv !== undefined) {
      sessionByPid.set(row.pid, fromArgv);
    }
    const orphanShell = row.ppid === LAUNCHD_PID && argv !== undefined && SHELL_SNAPSHOT.test(argv);
    if (orphanShell || (argv !== undefined && FLEET_ARGV.test(argv))) {
      fleetSelf.add(row.pid);
    }
  }
  // The nearest session root up the chain decides; with none, any fleet-in-itself ancestor does.
  const placementOf = ({ pid }: { pid: number }): Placement => {
    let fleet = false;
    const passed = new Set<number>();
    let current: number | undefined = pid;
    while (current !== undefined && !passed.has(current)) {
      passed.add(current);
      if (disputed.has(current)) {
        return { fleet: true, sessionId: undefined };
      }
      if (sessionByPid.has(current)) {
        return { fleet: true, sessionId: sessionByPid.get(current) };
      }
      fleet = fleet || fleetSelf.has(current);
      current = ppidOf.get(current);
    }
    return { fleet, sessionId: undefined };
  };
  return new Map(snapshot.processes.map((row) => [row.pid, placementOf({ pid: row.pid })]));
}

/**
 * The cores one process used over the interval: its CPU-time difference over the elapsed time. A process the
 * baseline does not hold — absent from it, or a reused pid whose `comm` changed or whose time went backwards —
 * started after the baseline was taken, so every millisecond of its CPU time was spent inside the interval and its
 * whole time is the difference (counting it as zero would draw a measured "0.00 cores" for a new session).
 * A pid reused under the same name with more time than before is indistinguishable from the old process; that is the
 * one residue, accepted rather than closed. `ps` gives a start time only to the second, so it cannot
 * close it; and darwin hands out pids in sequence, so reuse inside a ten-second baseline needs the whole pid space to
 * wrap within it. MEASURED at load ~40: pids rose 61,602 to 62,751 over ten seconds, about 115 a second,
 * one wrap in about fourteen minutes. Reproduce with `ps -axo etime=,pid= | sort | head -25`.
 *
 * @returns the cores, or `undefined` with no baseline
 */
function processCoresOf({
  row,
  before,
  elapsedMs,
}: {
  row: LiveProcessStat;
  before: ReadonlyMap<number, LiveProcessStat> | undefined;
  elapsedMs: number;
}): number | undefined {
  if (before === undefined) {
    return undefined;
  }
  const prior = before.get(row.pid);
  if (prior === undefined || prior.comm !== row.comm || row.cpuTimeMs < prior.cpuTimeMs) {
    return row.cpuTimeMs / elapsedMs;
  }
  return (row.cpuTimeMs - prior.cpuTimeMs) / elapsedMs;
}

/** A running total. */
interface Tally {
  cpuCores: number | undefined;
  memoryBytes: number;
  processCount: number;
}

/**
 * Add one process to a keyed tally; a measured interval adds to the CPU, an unmeasured one leaves it as it was.
 *
 * @returns nothing; the map is updated in place
 */
function addTo({
  tallies,
  key,
  cores,
  memoryBytes,
  measured,
}: {
  tallies: Map<string, Tally>;
  key: string;
  cores: number | undefined;
  memoryBytes: number;
  measured: boolean;
}): void {
  let tally = tallies.get(key);
  if (tally === undefined) {
    // With a baseline every process has a measured interval, so a group's CPU starts at zero; without one, none does.
    tally = { cpuCores: measured ? 0 : undefined, memoryBytes: 0, processCount: 0 };
    tallies.set(key, tally);
  }
  if (cores !== undefined && tally.cpuCores !== undefined) {
    tally.cpuCores += cores;
  }
  tally.memoryBytes += memoryBytes;
  tally.processCount += 1;
}

/**
 * A group's weight on one axis; an unmeasured CPU weighs nothing, so it is never named the heaviest.
 *
 * @returns the weight
 */
function weightOf({ other, by }: { other: LiveOtherUse; by: "cpuCores" | "memoryBytes" }): number {
  const value = other[by];
  if (value === undefined) {
    return 0;
  }
  return value;
}

/**
 * The heaviest tally on one axis.
 *
 * @returns it, or `undefined` when none weighs anything
 */
function heaviest({
  others,
  by,
}: {
  others: ReadonlyMap<string, Tally>;
  by: "cpuCores" | "memoryBytes";
}): LiveOtherUse | undefined {
  const ranked = [...others]
    .map(([label, tally]) => ({ cpuCores: tally.cpuCores, label, memoryBytes: tally.memoryBytes }))
    .filter((other) => weightOf({ by, other }) > 0)
    .toSorted((a, b) => weightOf({ by, other: b }) - weightOf({ by, other: a }) || a.label.localeCompare(b.label));
  return ranked[0];
}

/**
 * One figure to two decimal places, so the wire carries no float noise.
 *
 * @returns the rounded figure
 */
function round2({ value }: { value: number }): number {
  return Math.round(value * 100) / 100;
}

/**
 * The reading a snapshot makes against the one before it. With no baseline (the server's first read) every CPU
 * figure is `undefined`, and memory, load and the sessions still read.
 *
 * @param current this read's snapshot
 * @param previous the last complete snapshot this server took, when there is one
 * @returns the reading, or why the CPU counters could not be differenced
 */
export function liveMachineReadingOf({
  current,
  previous,
}: {
  current: LiveMachineSnapshot;
  previous: LiveMachineSnapshot | undefined;
}): Result<LiveMachineReading, LiveMachineError> {
  let busyCores: number | undefined;
  let idlePct: number | undefined;
  let before: ReadonlyMap<number, LiveProcessStat> | undefined;
  const elapsedMs = previous === undefined ? 0 : current.monotonicMs - previous.monotonicMs;
  if (previous !== undefined) {
    // Every caller's path ends here, so the bound holds whatever happened before: a warming read whose one-second
    // timer fired late, after a sleep, is refused rather than drawn as an interval of minutes.
    if (elapsedMs > BASELINE_FRESH_MS) {
      return err(LiveMachineErrors.intervalTooLong({ elapsedMs }));
    }
    const totalDelta = current.cpu.totalMs - previous.cpu.totalMs;
    const idleDelta = current.cpu.idleMs - previous.cpu.idleMs;
    if (totalDelta <= 0 || idleDelta < 0 || idleDelta > totalDelta || elapsedMs <= 0) {
      return err(LiveMachineErrors.cpuCountersInvalid());
    }
    idlePct = (idleDelta / totalDelta) * 100;
    busyCores = ((totalDelta - idleDelta) / totalDelta) * current.cpu.cores;
    before = new Map(previous.processes.map((row) => [row.pid, row]));
  }
  const measured = before !== undefined;
  const placements = placementsOf({ snapshot: current });
  const bySession = new Map<string, Tally>();
  const byLabel = new Map<string, Tally>();
  let fleetCores = 0;
  let fleetBytes = 0;
  for (const row of current.processes) {
    const placement = placements.get(row.pid)!;
    const cores = processCoresOf({ before, elapsedMs, row });
    const amounts = { cores, measured, memoryBytes: row.residentBytes };
    if (placement.sessionId !== undefined) {
      addTo({ ...amounts, key: placement.sessionId, tallies: bySession });
    }
    if (placement.fleet) {
      if (cores !== undefined) {
        fleetCores += cores;
      }
      fleetBytes += row.residentBytes;
      continue;
    }
    addTo({ ...amounts, key: row.comm.slice(row.comm.lastIndexOf("/") + 1), tallies: byLabel });
  }
  let cpu: LiveMachineReading["cpu"] = {
    busyCores: undefined,
    fleetCores: undefined,
    idlePct: undefined,
    otherCores: undefined,
  };
  if (busyCores !== undefined && idlePct !== undefined) {
    // The fleet's share is capped at the kernel's busy count, so fleet and everything else add up to that count.
    const fleet = Math.min(fleetCores, busyCores);
    cpu = {
      busyCores: round2({ value: busyCores }),
      fleetCores: round2({ value: fleet }),
      idlePct: round2({ value: idlePct }),
      otherCores: round2({ value: busyCores - fleet }),
    };
  }
  return ok({
    cores: current.cpu.cores,
    cpu,
    diagnostics: current.diagnostics,
    load1: round2({ value: current.load1 }),
    memory: {
      compressorSegmentsPct: current.compressorSegmentsPct,
      fleetBytes: Math.min(fleetBytes, current.usedMemoryBytes),
      swapfileCount: current.swapfileCount,
      totalBytes: current.totalMemoryBytes,
      usedBytes: current.usedMemoryBytes,
    },
    observedAtIso: current.observedAtIso,
    sessions: [...bySession]
      .map(([sessionId, tally]): LiveSessionUse => ({
        cpuCores: tally.cpuCores === undefined ? undefined : round2({ value: tally.cpuCores }),
        memoryBytes: tally.memoryBytes,
        processCount: tally.processCount,
        sessionId,
      }))
      .toSorted((a, b) => a.sessionId.localeCompare(b.sessionId)),
    topOtherCpu: heaviest({ by: "cpuCores", others: byLabel }),
    topOtherMemory: heaviest({ by: "memoryBytes", others: byLabel }),
  });
}
