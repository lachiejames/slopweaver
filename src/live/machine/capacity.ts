/**
 * `slopweaver machine capacity` — the pure half. Turns `top`'s per-process footprint and load-average header,
 * `sysctl vm.swapusage` and a process-table snapshot into a ranked, classified report and a one-line verdict.
 *
 * ## Two subjects, and why the verdict names which one it graded
 *
 * This verb grades MEMORY (foreign footprints, swap, the compressor, the swapfile count) and CPU (the
 * 1-minute load average). They fail independently, so a grade that does not say what it is a grade OF is a
 * verdict whose real subject is invisible in its own output — see the threshold header below for the
 * reading where a bare `ok` meant `ok on memory` on a machine at load 34.84 that could not finish
 * a gate lap.
 *
 * ## Why `top`'s MEM column, not `footprint(1)` and not `ps`'s RSS
 *
 * `footprint(1)` is the tool named in Activity Monitor's own documentation, but it refuses outright on any
 * process the caller does not own (`footprint: Must run as root.` even for `--pid <foreign>` alone — verified
 * on this machine) — so a sudo-free run of it cannot see a single root-owned daemon, which is
 * exactly the class the mds incident this verb exists for belongs to. `ps`'s RSS undercounts a process's real
 * cost: it excludes compressed and swapped-out pages, so a process sitting mostly in the compressor or on swap
 * reads far smaller than what Activity Monitor's Memory column — and the owner's incident report — actually
 * means. `top`'s `mem` stat is documented (`man top`) as "Physical memory footprint of the process" and reads
 * within noise of `footprint(1)`'s own number for a process this user owns (454782008 B vs top's rounded
 * 434M, verified) — and unlike `footprint(1)`, `top -l 1 -o mem` lists EVERY process, root-owned
 * included, without sudo.
 */
import type { ProcessRow } from "../standing/processes.js";
import { alertReasons } from "./capacityAlerts.js";
import { diskFloorFor, holdReasons, loadHoldFor } from "./capacityHolds.js";
import {
  type CompressorGauge,
  type LoadAverage,
  type ProcessComm,
  parseCompressorSysctl,
  parseSwapUsage,
  type SwapUsage,
} from "./capacityParse.js";
import { hogsOf, type RankedProcess, rankTopProcesses } from "./capacityRank.js";
import { DEFAULT_SEGMENTS_HOLD_PCT, DEFAULT_SWAPFILE_HOLD_COUNT } from "./capacityThresholds.js";
import {
  type CapacitySubject,
  type GradeReason,
  NOT_STANDING,
  renderVerdict,
  subjectsOf,
  verdictSummary,
} from "./capacityVerdict.js";
import { type CpuHogReading, cpuHogReading } from "./cpuHogs.js";
import { daemonCulprit } from "./daemonCulprit.js";
import type { DiskReading } from "./diskFootprint.js";
import { type FleetCulprit, fleetCulprit } from "./fleetCulprit.js";
import {
  DEFAULT_HOOK_STALL_HOLD_SECONDS,
  DEFAULT_PARALLEL_CALL_ALERT,
  type FleetLoadReading,
  fleetLoadReading,
  type ProcessElapsed,
  parseTopCpuRows,
} from "./fleetLoad.js";
import { type HiddenCpuReading, hiddenCpuReading, type ProcessStatRow } from "./hiddenCpu.js";
import { type RecentBootsReading, recentBoots } from "./recentBoots.js";
import { type RunawaySearch, runawaySearches } from "./runawaySearch.js";
import type { ClaudeSession } from "./sessionOwner.js";

/** How many top-footprint processes a report carries when the caller does not ask for a different count. */
export const DEFAULT_TOP_N = 15;

/** A foreign process above this footprint raises the report's alert (the mds case was 19.7 GB). */
export const DEFAULT_FOREIGN_FOOTPRINT_ALERT_GB = 8;

/** Swap used above this raises the report's alert (the mds case carried 6.2 GB swapped). */
export const DEFAULT_SWAP_ALERT_GB = 4;

// The two memory-pressure HOLD thresholds, and the kernel panic they are sized to, live in a leaf module so the
// console's mirror test can import them alone.
export { DEFAULT_SEGMENTS_HOLD_PCT, DEFAULT_SWAPFILE_HOLD_COUNT } from "./capacityThresholds.js";

/*
 * The CPU half of this verb, and why it is a SUBJECT rather than one more memory gauge.
 *
 * MEASURED: this verb printed, verbatim, `machine capacity: ok — top foreign hog
 * 'com.apple.Virtualization.VirtualMachine' at 1.8 GB · swap 0.8/2 GB · compressor 12% of segments limit ·
 * 2 swapfiles` while the 1-minute load average was **34.84** and `yarn validate` had refused four consecutive
 * laps, each on a DIFFERENT innocent test file, every one a 5000 ms timeout, every one passing in isolation
 * immediately after, at roughly 19,800 of ~19,811 passing. Memory, swap and the compressor were all genuinely
 * healthy — the gauge was not wrong about what it measures, it was blind to the only thing that was wrong,
 * and a session told to consult it before deciding the machine is usable burned ~9 minutes per refused lap.
 *
 * So the fix is two-sided and neither half works alone: the load reading joins the verdict AND the hold, and
 * every verdict now names the subject it graded — an `ok` that silently meant "ok on memory" is exactly what
 * misled here.
 *
 * The threshold was not new then: a spawn was held at 1.5 x the cores — what it
 * did not have was a gauge that fired on it, so reading it cost a separate `sysctl -n vm.loadavg` that the
 * misled session never ran. The hold is now 3 x the cores (45 on this device) and
 * graded it on `top`'s idle too — `./capacityHolds.ts`'s header carries why. Reproduce the inputs:
 * `sysctl -n hw.ncpu` (15 on this device), `sysctl -n vm.loadavg` and `top -l 2 -s 1 -n 0 | grep "CPU usage"`.
 */

/** The subjects a reading GRADES — {@link CapacitySubject}'s header says why `boots` and `disk` are not. */
const GRADED_ORDER: readonly CapacitySubject[] = ["memory", "cpu"];

/** The whole capacity report: what was surveyed, what was found, and the one-line verdict. */
export interface MachineCapacityReport {
  readonly processes: readonly RankedProcess[];
  /**
   * Every watched daemon (`./daemonWatch.ts`), read by pid beside {@link MachineCapacityReport.processes}
   * rather than inside it, so one ranked below `topN` is still judged. Empty when none runs or the read failed.
   */
  readonly watchedProcesses: readonly RankedProcess[];
  readonly load: LoadAverage | undefined;
  readonly swap: SwapUsage | undefined;
  readonly compressor: CompressorGauge | undefined;
  /** Swapfiles on disk under `vm.swapfileprefix`, or `undefined` when the directory could not be read. */
  readonly swapfileCount: number | undefined;
  /**
   * What this install costs the VOLUME, and how many worktrees are registered — `./diskFootprint.ts`.
   *
   * Never graded; holds below {@link MachineCapacityReport.diskHoldFreeGb} as the `disk` subject, which stops
   * discretionary seating and is never a standing machine hold — `./diskFootprint.ts`'s header says what it stops and what
   * it does not.
   */
  readonly disk: DiskReading | undefined;
  /** The `df`-available GB the volume holds below — `./capacityHolds.ts`'s `diskFloorFor`. */
  readonly diskHoldFreeGb: number;
  readonly topForeign: RankedProcess | undefined;
  /**
   * The largest process a session SPAWNED — owned by a session, and not that session's own `claude` — or
   * `undefined` when none ranked. The incident shape: a heredoc's interpreter under a bot turn.
   */
  readonly topFleetChild: RankedProcess | undefined;
  /** CPU the process table cannot attribute, and the processes hidden from it — `./hiddenCpu.ts`. */
  readonly hiddenCpu: HiddenCpuReading;
  /** What each live session's tree costs, and what every dead seat's orphans still burn — `./fleetLoad.ts`. */
  readonly fleet: FleetLoadReading;
  /**
   * Searches inside LIVE seats that have run away — `./runawaySearch.ts`. Each one alerts, and when any stands
   * the culprit names them and `machine reap` rather than their seat's pid.
   */
  readonly runawaySearches: readonly RunawaySearch[];
  /**
   * The machine's heaviest processes by `%CPU`, fleet AND foreign — `./cpuHogs.ts`. The other axis from
   * {@link processes}, which ranks by memory footprint and so cannot see a `bfs` at three cores.
   */
  readonly cpuHogs: CpuHogReading;
  /**
   * WHO this reading blames, and the one command that ends it — present whenever something held or a fleet
   * threshold was crossed. A `HOLD on cpu` that names nobody is the incident `./fleetLoad.ts` exists to end.
   */
  readonly culprit: FleetCulprit | undefined;
  /** The seconds a live PreToolUse hook HOLDS at — {@link DEFAULT_HOOK_STALL_HOLD_SECONDS}. */
  readonly hookStallHoldSeconds: number;
  /** The in-flight tool calls a session ALERTS at — {@link DEFAULT_PARALLEL_CALL_ALERT}. Never a hold. */
  readonly parallelCallAlert: number;
  /** The footprint threshold, in GB, a foreign process OR a session's spawned child alerts above. */
  readonly foreignAlertGb: number;
  readonly swapAlertGb: number;
  readonly segmentsHoldPct: number;
  readonly swapfileHoldCount: number;
  /** The 1-minute load average at or above which a spawn HOLDs — {@link loadHoldFor} of the machine's cores. */
  readonly loadHold: number;
  /** The sessions booted inside the window, and the count that holds — `./recentBoots.ts`. */
  readonly recentBoots: RecentBootsReading;
  /** The subjects that had at least one reading, so the verdict can say what its grade is a grade OF. */
  readonly graded: readonly CapacitySubject[];
  /** The subjects nothing could be read for — named in the verdict rather than silently folded into `ok`. */
  readonly ungraded: readonly CapacitySubject[];
  /** The subjects a HOLD fired on — `memory`, `cpu`, `boots`, `disk`, or several. Empty when `hold` is false. */
  readonly holdSubjects: readonly CapacitySubject[];
  /**
   * A foreign hog, a session's spawned child, or swap crossed its ALERT threshold — worth a briefing line,
   * never by itself a reason to stop spawning.
   */
  readonly alert: boolean;
  /** Whether {@link topFleetChild} is over the footprint threshold — the stream event names it only then. */
  readonly fleetChildAlert: boolean;
  /**
   * The compressor, the swapfile count, the 1-minute load, the boots in flight or the volume's free space crossed
   * a HOLD threshold — the supervisor spawns nothing while this is true. Which consumers a `boots` or `disk`
   * hold reaches is `./recentBoots.ts`'s `machineHoldStands` and `holdBlocksWait`.
   */
  readonly hold: boolean;
  readonly verdict: string;
}

/**
 * Which subjects this reading could actually grade. `memory` needs one of its four readings; `cpu` is the
 * load average alone, so a `top` that printed no header line leaves CPU ungraded rather than silently ok.
 */
function gradedSubjects({
  load,
  swap,
  compressor,
  swapfileCount,
  processCount,
}: {
  load: LoadAverage | undefined;
  swap: SwapUsage | undefined;
  compressor: CompressorGauge | undefined;
  swapfileCount: number | undefined;
  processCount: number;
}): readonly CapacitySubject[] {
  const memory = swap !== undefined || compressor !== undefined || swapfileCount !== undefined || processCount > 0;
  return GRADED_ORDER.filter((subject) => (subject === "memory" ? memory : load !== undefined));
}

/**
 * Turn the crossings and the readings into the six graded fields of a report — which subjects were graded,
 * which held, and the one-line verdict that names both.
 *
 * @param holds the HOLD thresholds this reading crossed
 * @param alerts the ALERT thresholds this reading crossed
 * @param processCount how many processes ranked, which is one of the four things that grades memory
 * @returns the report's `alert`, `hold`, `holdSubjects`, `graded`, `ungraded` and `verdict` fields
 */
function gradeReadings({
  holds,
  alerts,
  load,
  swap,
  compressor,
  swapfileCount,
  topForeign,
  hiddenCpu,
  processCount,
  culprit,
}: {
  holds: readonly GradeReason[];
  alerts: readonly GradeReason[];
  load: LoadAverage | undefined;
  swap: SwapUsage | undefined;
  compressor: CompressorGauge | undefined;
  swapfileCount: number | undefined;
  topForeign: RankedProcess | undefined;
  hiddenCpu: HiddenCpuReading;
  processCount: number;
  culprit: FleetCulprit | undefined;
}): Pick<MachineCapacityReport, "alert" | "graded" | "hold" | "holdSubjects" | "ungraded" | "verdict"> {
  const graded = gradedSubjects({ compressor, load, processCount, swap, swapfileCount });
  const ungraded = GRADED_ORDER.filter((subject) => !graded.includes(subject));
  return {
    alert: alerts.length > 0,
    graded,
    hold: holds.length > 0,
    holdSubjects: subjectsOf({ reasons: holds }),
    ungraded,
    verdict: renderVerdict({
      alerts,
      culprit,
      graded,
      holds,
      summary: verdictSummary({ compressor, hiddenCpu, load, swap, swapfileCount, topForeign }),
      ungraded,
    }),
  };
}

/** Decode the swap and compressor text, and size the load hold off the core count. */
function gaugesOf({
  swapText,
  compressorText,
  cores,
}: {
  swapText: string | undefined;
  compressorText: string | undefined;
  cores: number | undefined;
}): Pick<MachineCapacityReport, "compressor" | "loadHold" | "swap"> {
  return {
    compressor: compressorText === undefined ? undefined : parseCompressorSysctl({ text: compressorText }),
    loadHold: loadHoldFor({ cores }),
    swap: swapText === undefined ? undefined : parseSwapUsage({ text: swapText }),
  };
}

/**
 * Build the whole capacity report: rank `top`'s footprints, classify each against the process table, read
 * the compressor and swapfile gauges, and derive the one-line verdict. Pure — every input is already-read
 * text or an already-decoded table.
 *
 * @param topText the raw `top -l 1 -o mem -stats pid,mem` output
 * @param swapText the raw `sysctl vm.swapusage` output
 * @param compressorText the raw output of the four compressor `sysctl` oids ({@link parseCompressorSysctl})
 * @param swapfileCount how many swapfiles are on disk, or `undefined` when the count could not be read
 * @param disk the volume's own numbers and the worktree registration counts, or `undefined` when the reading
 *   was not taken — never graded, and a hold below `diskHoldFreeGb` ({@link MachineCapacityReport.disk})
 * @param cores the machine's core count, which sizes the load hold ({@link loadHoldFor}) — `undefined` falls
 *   back to `./capacityHolds.ts`'s `DEFAULT_LOAD_HOLD`
 * @param processes the decoded `ps -ax -o pid=,ppid=,args=` table, for classification
 * @param comms the decoded `ps -ax -o pid=,comm=` table, for the display label
 * @param sessions every live Claude Code session the registry names, so a spawned child is attributed and a
 *   session booted inside the window counts against the boots hold (`./recentBoots.ts`)
 * @param chairSessionId the pinned supervisor's session id, which the culprit never offers a kill
 *   (`./fleetCulprit.ts`); `undefined` when no Claude Code pin is recorded. Required, so no caller can omit it
 * @param cpuSampleText the raw `top -l 2 -s 1 -stats pid,cpu` output the unattributed-CPU residual is read
 *   from, or `undefined` when the read failed or was not taken
 * @param statRows the decoded `ps -ax -o pid=,rss=,stat=,comm=` table, for the processes that refused stats
 * @param elapsedRows the decoded `ps -ax -o pid=,etime=` table, the only source of the hook-stall reading and
 *   of how young each session is
 * @param watchedTopText the raw `top -l 1 -pid … -stats pid,mem` output over the watched daemons, or `undefined`
 *   when none runs or the read failed
 * @param topN how many ranked processes the report carries (defaults to {@link DEFAULT_TOP_N})
 * @param foreignAlertGb the footprint alert threshold in GB, for a foreign process and a session's spawned
 *   child alike (defaults to {@link DEFAULT_FOREIGN_FOOTPRINT_ALERT_GB})
 * @param swapAlertGb the swap-used alert threshold in GB (defaults to {@link DEFAULT_SWAP_ALERT_GB})
 * @param segmentsHoldPct the compressor-segments hold threshold, a percentage of `vm.compressor.segment.limit`
 *   (defaults to {@link DEFAULT_SEGMENTS_HOLD_PCT})
 * @param swapfileHoldCount the swapfile-count hold threshold (defaults to {@link DEFAULT_SWAPFILE_HOLD_COUNT})
 * @param hookStallHoldSeconds the live-PreToolUse-hook hold threshold, in seconds (defaults to
 *   {@link DEFAULT_HOOK_STALL_HOLD_SECONDS})
 * @param parallelCallAlert the in-flight-tool-call alert threshold (defaults to
 *   {@link DEFAULT_PARALLEL_CALL_ALERT})
 * @param diskHoldFreeGb the volume's `df`-available floor in GB, below which seating holds on `disk` (defaults to
 *   `diskFloorFor` — a seat tree each for the boots burst, the next and one spare)
 * @returns the ranked, classified report
 */
// max-lines-exempt: a flat pass-through whose length is its named inputs, declared twice by the named-object-params rule; the logic is four calls to pure helpers and one assembly
export function buildMachineCapacityReport({
  topText,
  swapText,
  compressorText,
  swapfileCount,
  cores,
  processes,
  comms,
  sessions,
  chairSessionId,
  disk = undefined,
  cpuSampleText = undefined,
  statRows = [],
  elapsedRows = [],
  watchedTopText = undefined,
  topN = DEFAULT_TOP_N,
  foreignAlertGb = DEFAULT_FOREIGN_FOOTPRINT_ALERT_GB,
  swapAlertGb = DEFAULT_SWAP_ALERT_GB,
  segmentsHoldPct = DEFAULT_SEGMENTS_HOLD_PCT,
  swapfileHoldCount = DEFAULT_SWAPFILE_HOLD_COUNT,
  hookStallHoldSeconds = DEFAULT_HOOK_STALL_HOLD_SECONDS,
  parallelCallAlert = DEFAULT_PARALLEL_CALL_ALERT,
  diskHoldFreeGb = undefined,
}: {
  topText: string | undefined;
  swapText: string | undefined;
  compressorText: string | undefined;
  swapfileCount: number | undefined;
  cores: number | undefined;
  processes: readonly ProcessRow[];
  comms: readonly ProcessComm[];
  sessions: readonly ClaudeSession[];
  chairSessionId: string | undefined;
  disk?: DiskReading | undefined;
  cpuSampleText?: string | undefined;
  statRows?: readonly ProcessStatRow[];
  elapsedRows?: readonly ProcessElapsed[];
  watchedTopText?: string | undefined;
  topN?: number;
  foreignAlertGb?: number;
  swapAlertGb?: number;
  segmentsHoldPct?: number;
  swapfileHoldCount?: number;
  hookStallHoldSeconds?: number;
  parallelCallAlert?: number;
  diskHoldFreeGb?: number | undefined;
}): MachineCapacityReport {
  const { load, ranked } = rankTopProcesses({ comms, processes, sessions, topN, topText });
  // No session attribution: a watched daemon is root and nobody's child, and the session registry matches by
  // pid, so a stale record on a reused pid would mark it fleet and hide it. Its argv still classifies.
  const watched = rankTopProcesses({
    comms,
    processes,
    sessions: [],
    topN: Number.POSITIVE_INFINITY,
    topText: watchedTopText,
  });
  const { topForeign, topFleetChild, fleetChildAlert, alertingChildren } = hogsOf({ foreignAlertGb, ranked });
  const { swap, compressor, loadHold } = gaugesOf({ compressorText, cores, swapText });
  const hiddenCpu = hiddenCpuReading({ cores, cpuSampleText, statRows });
  // One decode of the `top` CPU sample, shared by the fleet attribution and the hog ranking — the sample is
  // a second of wall clock and decoding it twice would be the same second counted twice.
  const cpuRows = cpuSampleText === undefined ? [] : parseTopCpuRows({ text: cpuSampleText });
  const fleet = fleetLoadReading({ comms, cpuRows, elapsedRows, processes });
  // No protected pids: this gauge signals nothing, and `machine reap` re-selects with its own ancestry excluded.
  const searches = runawaySearches({ cpuRows, elapsedRows, processes, protectedPids: new Set() });
  const cpuHogs = cpuHogReading({ comms, cpuRows, elapsedRows, processes });
  const boots = recentBoots({ elapsedRows, sessions });
  const diskFloor = diskFloorFor({ pinnedGb: diskHoldFreeGb });
  const holds = holdReasons({
    boots,
    compressor,
    disk,
    diskFloor,
    fleet,
    hookStallHoldSeconds,
    idlePct: hiddenCpu.idlePct,
    load,
    loadHold,
    segmentsHoldPct,
    swapfileCount,
    swapfileHoldCount,
  });
  const alerts = alertReasons({
    fleet,
    fleetChildren: alertingChildren,
    foreignAlertGb,
    parallelCallAlert,
    searches,
    swap,
    swapAlertGb,
    topForeign,
  });
  // A culprit is named only when something actually fired. Naming one on a clean reading would put a session
  // in front of a supervisor every tick for doing nothing wrong, which is how a real signal gets ignored. A
  // boots hold alone fires nothing here: a burst of sessions starting is nobody's fault to end. Nor does a disk
  // hold: a full volume is no process's to end, and `worktree prune` is its remedy.
  const fired = holds.some((reason) => !NOT_STANDING.has(reason.subject)) || alerts.length > 0;
  const memoryHeld = holds.some((reason) => reason.subject === "memory");
  // A watched daemon outweighing every ranked process answers a memory hold first (`./daemonCulprit.ts`).
  const daemon = fired ? daemonCulprit({ foreignAlertGb, memoryHeld, ranked, watched: watched.ranked }) : undefined;
  const culprit =
    fired && daemon === undefined
      ? fleetCulprit({
          chairSessionId,
          parallelCallAlert,
          reading: fleet,
          searches,
          stallHoldSeconds: hookStallHoldSeconds,
        })
      : daemon;
  const graded = gradeReadings({
    alerts,
    compressor,
    culprit,
    hiddenCpu,
    holds,
    load,
    processCount: ranked.length,
    swap,
    swapfileCount,
    topForeign,
  });
  return {
    ...graded,
    recentBoots: boots,
    compressor,
    cpuHogs,
    culprit,
    disk,
    diskHoldFreeGb: diskFloor.gb,
    fleet,
    fleetChildAlert,
    foreignAlertGb,
    hiddenCpu,
    hookStallHoldSeconds,
    load,
    loadHold,
    parallelCallAlert,
    processes: ranked,
    runawaySearches: searches,
    segmentsHoldPct,
    swap,
    swapAlertGb,
    swapfileCount,
    swapfileHoldCount,
    topFleetChild,
    topForeign,
    watchedProcesses: watched.ranked,
  };
}
