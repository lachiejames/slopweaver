/**
 * The pure core of `slopweaver machine series`: one sample of the machine as the Fleet page charts it. The hour of
 * samples it keeps, and when the current load hold began, are `./seriesRing.ts`'s.
 *
 * ## What the Fleet page needs, and why each part has the shape it has
 *
 * A page of bare numbers with no charts is not believable, least of all off a reading up to an hour old. It wants
 * Activity Monitor style CPU and memory over time, a global chart that is real time, one beside each session, the
 * hold's cutoff and the moment the hold started on it, and fleet usage split from everything else with the biggest
 * other consumers named (a security agent or a tracing tool at five hundred percent CPU).
 *
 * - **Fleet is a process TREE, never a process name.** cmux's own `%CPU` row leaves out every agent, hook and build
 *   running under it. So a pid is fleet when it, or any
 *   ancestor, is a live Claude Code session, an orphaned Claude tool shell, or a process `./classify.ts` already
 *   calls fleet (the cmux app, `claude`, a slopweaver worktree). Everything else is other.
 * - **A session's figure is its whole tree**, summed under the nearest session root, keyed by the session id the
 *   Fleet page's cards already carry. A session whose id disagrees between its argv and its registry file gets no
 *   row: a figure on the wrong card is worse than none, and its tree still counts as fleet.
 * - **Other consumers are named by `comm`, never argv**, grouped by that name, for the reason `./cpuHogs.ts`
 *   gives: an argv can carry a token in a flag value and this row is written to disk.
 * - **The load hold is a load figure, never a CPU one.** `load1` counts runnable work while `%CPU` measures
 *   execution, so the hold line belongs on the load trace only. The threshold is `./capacityHolds.ts`'s.
 */
import type { ProcessRow } from "../standing/processes.js";
import { loadHoldFor } from "./capacityHolds.js";
import { basename, type CompressorGauge, type ProcessComm, type SwapUsage } from "./capacityParse.js";
import { classifyProcess } from "./classify.js";
import { shellSnapshotOf } from "./fleetLoad.js";
import type { MachineTopSnapshot } from "./seriesParse.js";
import type { ClaudeSession } from "./sessionOwner.js";

/** How many other consumers a sample names on each axis. */
const MACHINE_SERIES_TOP_OTHERS = 3;

/** The one label every other process `ps` printed no `comm` for is grouped under. */
export const UNNAMED_LABEL = "a process ps did not name";

/** The pid every orphan reparents to. */
const LAUNCHD_PID = 1;

/** The kernel's own pid, which `top` measures and `ps -ax` does not list, so it has no `comm` to be named by. */
const KERNEL_PID = 0;

/** One session's tree in one sample. */
interface SessionResourceSample {
  /** The Claude Code session id, the bare uuid the Fleet page's card carries as its transcript id. */
  readonly sessionId: string;
  /** The summed `%CPU` of every process in its tree; 100 is one whole core. */
  readonly cpuPct: number;
  /** The summed physical footprint of every process in its tree, which can count a shared page twice. */
  readonly memoryBytes: number;
  readonly processCount: number;
}

/** One group of other processes sharing a `comm` name. */
interface OtherConsumerSample {
  /** The `comm` basename, never argv. */
  readonly label: string;
  readonly cpuPct: number;
  readonly memoryBytes: number;
  readonly processCount: number;
}

/** One sample of the machine. */
export interface MachineSeriesSample {
  readonly observedAtIso: string;
  readonly cores: number;
  readonly cpu: {
    /** Every fleet process's `%CPU` summed; 100 is one whole core. */
    readonly fleetPct: number;
    readonly otherPct: number;
    /**
     * `top`'s whole-machine idle percentage, which clears a load over its hold (`./capacityHolds.ts`'s
     * `cpuLoadHolding`). Absent on a sample written before this field existed or one whose header was unreadable.
     */
    readonly idlePct?: number | undefined;
  };
  readonly load: {
    readonly load1: number;
    /** The 1-minute load the capacity gate holds new sessions at, for this core count. */
    readonly holdAt: number;
  };
  readonly memory: {
    /** Memory in use as Activity Monitor sums it: app memory, wired and compressed, never the file cache. */
    readonly usedBytes: number;
    /** The machine's physical memory. */
    readonly totalBytes: number;
    /** Compressor segments used against their limit, the figure a memory panic is graded on. */
    readonly compressorSegmentsPct: number;
    readonly swapUsedGb: number;
    readonly swapTotalGb: number;
  };
  readonly sessions: readonly SessionResourceSample[];
  /** The heaviest other groups by CPU, at most {@link MACHINE_SERIES_TOP_OTHERS}. */
  readonly topOtherCpu: readonly OtherConsumerSample[];
  /** The heaviest other groups by memory, at most {@link MACHINE_SERIES_TOP_OTHERS}. */
  readonly topOtherMemory: readonly OtherConsumerSample[];
}

/** Everything one sample is built from. */
export interface MachineSeriesInputs {
  readonly observedAtIso: string;
  readonly cores: number;
  readonly top: MachineTopSnapshot;
  readonly processes: readonly ProcessRow[];
  readonly comms: readonly ProcessComm[];
  readonly sessions: readonly ClaudeSession[];
  readonly compressor: CompressorGauge;
  readonly swap: SwapUsage;
  /** Memory in use, off `vm_stat` (`./seriesParse.ts#parseVmStatUsedBytes`). */
  readonly memoryUsedBytes: number;
  readonly memoryTotalBytes: number;
}

/**
 * A figure to one decimal place, so a sample row is not seventeen digits of float noise.
 *
 * @returns the rounded figure
 */
function round1({ value }: { value: number }): number {
  return Math.round(value * 10) / 10;
}

/** What each pid is, as the walk needs it. */
interface Roots {
  /** The session id each session root pid carries. */
  readonly sessionByPid: ReadonlyMap<number, string>;
  /** Session root pids whose id is disputed: their trees are fleet and attributed to no session. */
  readonly disputed: ReadonlySet<number>;
  /** Pids that are fleet in themselves: an orphaned tool shell, or what `classifyProcess` calls fleet. */
  readonly fleetSelf: ReadonlySet<number>;
}

/**
 * The one argv-derived value the ring keeps: a `--session-id` whose WHOLE value is a UUID, the only shape Claude Code
 * mints. `claudeSessionIdOf` takes any run of eight hex digits or more, and a UUID-shaped prefix of a longer value,
 * so the value is read here to the next space and judged whole.
 */
const SESSION_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

/** The flag a session id travels on, as its own token or as `--session-id=<value>`. */
const SESSION_ID_FLAG = "--session-id";

/**
 * The session an argv names, only when exactly one token is the flag, valued or not (a bare trailing
 * duplicate still makes two), and its value, the rest of an `=` token or the next token, is a whole UUID.
 *
 * @returns the session id, or `undefined`
 */
function argvSessionIdOf({ argv }: { argv: string }): string | undefined {
  const tokens = argv.split(/\s+/u);
  const flagAt = tokens.flatMap((token, at) =>
    token === SESSION_ID_FLAG || token.startsWith(`${SESSION_ID_FLAG}=`) ? [at] : [],
  );
  if (flagAt.length !== 1) {
    return undefined;
  }
  const token = tokens[flagAt[0]!]!;
  const value = token === SESSION_ID_FLAG ? tokens[flagAt[0]! + 1] : token.slice(SESSION_ID_FLAG.length + 1);
  if (value === undefined || !SESSION_UUID.test(value)) {
    return undefined;
  }
  return value;
}

/**
 * Every session root and every pid that is fleet in itself. The registry names a session's `claude` pid; an argv's
 * own `--session-id`, when it is a whole UUID, covers a session the registry lacks. Where the two disagree on one
 * pid, that root is disputed.
 *
 * @returns the roots
 */
function rootsOf({
  processes,
  sessions,
}: {
  processes: readonly ProcessRow[];
  sessions: readonly ClaudeSession[];
}): Roots {
  const sessionByPid = new Map<number, string>();
  const disputed = new Set<number>();
  const registry = new Map(
    sessions.filter((session) => session.sessionId.length > 0).map((session) => [session.pid, session.sessionId]),
  );
  const fleetSelf = new Set<number>();
  for (const row of processes) {
    const fromRegistry = registry.get(row.pid);
    const fromArgv = argvSessionIdOf({ argv: row.argv });
    if (fromRegistry !== undefined && fromArgv !== undefined && fromRegistry !== fromArgv) {
      disputed.add(row.pid);
    } else if (fromRegistry !== undefined) {
      sessionByPid.set(row.pid, fromRegistry);
    } else if (fromArgv !== undefined) {
      sessionByPid.set(row.pid, fromArgv);
    }
    const orphanShell = row.ppid === LAUNCHD_PID && shellSnapshotOf({ argv: row.argv }) !== undefined;
    if (orphanShell || classifyProcess({ argv: row.argv }) === "fleet") {
      fleetSelf.add(row.pid);
    }
  }
  return { disputed, fleetSelf, sessionByPid };
}

/** Where one pid sits: whether it is fleet, and the session whose tree it is in. */
interface Placement {
  readonly fleet: boolean;
  readonly sessionId: string | undefined;
}

/**
 * Climb one pid's parent chain, itself first: the nearest session root names its session, and any session root,
 * disputed root or fleet-in-itself ancestor makes it fleet. The climb has no depth limit, so a session's tree is
 * whole however deep it nests; it stops at a pid the snapshot lacks, launchd's own parent pid 0
 * included since `ps -ax` never lists it, or at a pid it has already passed, which only a racing snapshot's cycle
 * produces. Launchd itself is examined like any other pid, so no pid is skipped before its own roots are read.
 *
 * @returns the placement
 */
function placementOf({
  pid,
  byPid,
  roots,
}: {
  pid: number;
  byPid: ReadonlyMap<number, ProcessRow>;
  roots: Roots;
}): Placement {
  let fleet = false;
  const passed = new Set<number>();
  let current: number | undefined = pid;
  while (current !== undefined && !passed.has(current)) {
    passed.add(current);
    if (roots.disputed.has(current)) {
      return { fleet: true, sessionId: undefined };
    }
    const sessionId = roots.sessionByPid.get(current);
    if (sessionId !== undefined) {
      return { fleet: true, sessionId };
    }
    if (roots.fleetSelf.has(current)) {
      fleet = true;
    }
    current = byPid.get(current)?.ppid;
  }
  return { fleet, sessionId: undefined };
}

/**
 * One pid's display label: its `comm` basename, and never any part of argv, not even its first token, which a
 * process can set to anything (`/tmp/--token=…` would otherwise be written to the ring). Pid 0 is
 * `kernel_task`, the name Activity Monitor gives it; any other pid `ps` printed no `comm` for, one born or gone
 * between the two listings, joins the one {@link UNNAMED_LABEL} group.
 *
 * @returns the label
 */
function labelOf({ pid, commByPid }: { pid: number; commByPid: ReadonlyMap<number, string> }): string {
  const comm = commByPid.get(pid)?.trim();
  if (comm !== undefined && comm.length > 0) {
    return basename({ path: comm });
  }
  if (pid === KERNEL_PID) {
    return "kernel_task";
  }
  return UNNAMED_LABEL;
}

/** A running total. */
interface Tally {
  cpuPct: number;
  memoryBytes: number;
  processCount: number;
}

/**
 * Add one process to a keyed tally.
 *
 * @returns nothing; the map is updated in place
 */
function addTo({
  tallies,
  key,
  cpuPct,
  memoryBytes,
}: {
  tallies: Map<string, Tally>;
  key: string;
  cpuPct: number;
  memoryBytes: number;
}): void {
  const tally = tallies.get(key);
  if (tally === undefined) {
    tallies.set(key, { cpuPct, memoryBytes, processCount: 1 });
    return;
  }
  tally.cpuPct += cpuPct;
  tally.memoryBytes += memoryBytes;
  tally.processCount += 1;
}

/**
 * The heaviest other groups on one axis.
 *
 * @returns at most {@link MACHINE_SERIES_TOP_OTHERS}, heaviest first, ties by label
 */
function topOthers({
  others,
  by,
}: {
  others: readonly OtherConsumerSample[];
  by: "cpuPct" | "memoryBytes";
}): readonly OtherConsumerSample[] {
  return others
    .filter((other) => other[by] > 0)
    .toSorted((a, b) => b[by] - a[by] || a.label.localeCompare(b.label))
    .slice(0, MACHINE_SERIES_TOP_OTHERS);
}

/** Every measured process summed by where it sits. */
interface Placed {
  readonly fleetPct: number;
  readonly otherPct: number;
  readonly sessions: readonly SessionResourceSample[];
  readonly others: readonly OtherConsumerSample[];
}

/**
 * Place every process `top` measured, fleet or other by its tree, and sum it per session and per other `comm` group.
 *
 * @returns the sums, each figure rounded
 */
function placeAll({
  top,
  processes,
  comms,
  sessions,
}: Pick<MachineSeriesInputs, "top" | "processes" | "comms" | "sessions">): Placed {
  const byPid = new Map(processes.map((row) => [row.pid, row]));
  const commByPid = new Map(comms.map((row) => [row.pid, row.comm]));
  const roots = rootsOf({ processes, sessions });
  let fleetPct = 0;
  let otherPct = 0;
  const bySession = new Map<string, Tally>();
  const byLabel = new Map<string, Tally>();
  for (const process of top.processes) {
    const placement = placementOf({ byPid, pid: process.pid, roots });
    const amounts = { cpuPct: process.cpuPct, memoryBytes: process.footprintBytes };
    if (placement.sessionId !== undefined) {
      addTo({ ...amounts, key: placement.sessionId, tallies: bySession });
    }
    if (placement.fleet) {
      fleetPct += process.cpuPct;
      continue;
    }
    otherPct += process.cpuPct;
    addTo({ ...amounts, key: labelOf({ commByPid, pid: process.pid }), tallies: byLabel });
  }
  return {
    fleetPct: round1({ value: fleetPct }),
    otherPct: round1({ value: otherPct }),
    others: [...byLabel].map(([label, tally]): OtherConsumerSample => ({
      ...tally,
      cpuPct: round1({ value: tally.cpuPct }),
      label,
    })),
    sessions: [...bySession]
      .map(([sessionId, tally]): SessionResourceSample => ({
        ...tally,
        cpuPct: round1({ value: tally.cpuPct }),
        sessionId,
      }))
      .toSorted((a, b) => a.sessionId.localeCompare(b.sessionId)),
  };
}

/**
 * Build one sample: every process `top` measured, placed fleet or other by its tree, summed per session and per
 * other `comm` group.
 *
 * @returns the sample
 */
export function buildMachineSeriesSample(inputs: MachineSeriesInputs): MachineSeriesSample {
  const { observedAtIso, cores, top, compressor, swap, memoryUsedBytes, memoryTotalBytes } = inputs;
  const placed = placeAll(inputs);
  return {
    cores,
    cpu: {
      fleetPct: placed.fleetPct,
      otherPct: placed.otherPct,
      ...(top.idlePct === undefined ? {} : { idlePct: top.idlePct }),
    },
    load: { holdAt: loadHoldFor({ cores }), load1: top.load.load1 },
    memory: {
      compressorSegmentsPct: compressor.segmentsPct,
      swapTotalGb: swap.totalGb,
      swapUsedGb: swap.usedGb,
      totalBytes: memoryTotalBytes,
      usedBytes: memoryUsedBytes,
    },
    observedAtIso,
    sessions: placed.sessions,
    topOtherCpu: topOthers({ by: "cpuPct", others: placed.others }),
    topOtherMemory: topOthers({ by: "memoryBytes", others: placed.others }),
  };
}
