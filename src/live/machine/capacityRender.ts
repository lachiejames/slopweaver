/**
 * `slopweaver machine capacity` — the two renderings of a finished report: the flattened `--json` shape and the
 * text lines. Pure, and split from `./capacity.ts` along the seam between grading a machine and printing the
 * grade, so the grading file stays one a reviewer can hold in their head.
 */
import type { CeilingsReading } from "../../capacity/ceilings.js";
import type { MachineCapacityReport } from "./capacity.js";
import { diskLine, type RepoWorktreeCount, volumeFreeGb } from "./diskFootprint.js";
import { fleetLoadLines } from "./fleetLoad.js";
import { hiddenCpuLines } from "./hiddenCpu.js";
import type { RunawaySearch } from "./runawaySearch.js";
import { sessionPhrase } from "./sessionOwner.js";
import type { SpawnBackoffReport } from "./spawnBackoff.js";

/**
 * What the dispatch register said at the moment of the reading — read by the effectful SHELL and handed in,
 * because the report itself is pure and knows nothing about `$SLOPWEAVER_HOME`.
 *
 * It rides on this document rather than on a thirteenth supervisor tick source deliberately: the sweep
 * already captures `machine capacity --json` every tick, so the gate's evidence arrives through a capture
 * that exists, with no new source, schema arm, staleness rule or briefing line to keep honest.
 */
export interface DispatchBlock {
  /** Open anomalous-load findings nobody has settled, whether or not one seated an investigation. */
  readonly open: number;
  /**
   * The subset of {@link open} that SEATED a visible session — the only number that answers a hold. A row
   * whose seat was suppressed by the backoff or lost to a failed spawn is open and covers nothing.
   */
  readonly covering: number;
  /** The newest open finding's subject, "" when none is open. */
  readonly subject: string;
  /** Seconds until another investigation may be seated on that signature; 0 when one may be seated now. */
  readonly backoffSeconds: number;
  /**
   * The {@link covering} rows themselves, newest first and at most {@link INVESTIGATIONS_SHOWN}, so the Fleet page
   * can say when an investigation started and join its board row to the seat working it. Absent only on a
   * capture recorded before the field; an empty list is a measured none.
   */
  readonly investigations?: readonly DispatchInvestigation[];
  /** How many covering rows past {@link INVESTIGATIONS_SHOWN} were left out. */
  readonly investigationsOmitted?: number;
}

/** How many covering rows a capacity document carries — a bound, because the register only grows. */
export const INVESTIGATIONS_SHOWN = 5;

/** One covering dispatch: an anomalous-load finding that seated a visible session. */
export interface DispatchInvestigation {
  readonly id: string;
  /** When the reading that raised it was taken — when the investigation started. */
  readonly observedIso: string;
  readonly triggers: readonly string[];
  readonly subject: { readonly label: string; readonly why: string };
  /** The board row the seat was opened on. */
  readonly slug: string;
}

/** The machine-readable `--json` shape: swap and compressor readings sit at the top level, not nested. */
interface MachineCapacityJson {
  /**
   * Every ceiling a seat spends — this machine and each Claude and Codex plan — as used of available, and the
   * lowest one (`../../capacity/ceilings.ts`). ABSENT, not null, when the shell took no plan reading, so a
   * document from before plans were read and one from a caller that skipped them read the same.
   */
  readonly ceilings?: CeilingsReading;
  /**
   * The fleet-wide spawn backoff at the reading (`./spawnBackoff.ts`), or why its state could not be read.
   * ABSENT when the shell did not read it, like {@link ceilings}.
   */
  readonly spawnBackoff?: SpawnBackoffReport;
  /** The dispatch register's standing at the reading — `../../supervisor/loadDispatchGate.ts` reads this. */
  readonly dispatch: DispatchBlock;
  /** The heaviest processes by `%CPU`, fleet and foreign — the other axis from {@link processes}. */
  readonly cpuHogs: MachineCapacityReport["cpuHogs"];
  readonly processes: MachineCapacityReport["processes"];
  /** Every watched daemon, read by pid beside the ranked list — `./daemonWatch.ts`. */
  readonly watchedProcesses: MachineCapacityReport["watchedProcesses"];
  readonly topFleetChild: MachineCapacityReport["topFleetChild"];
  readonly fleetChildAlert: boolean;
  readonly load: MachineCapacityReport["load"];
  readonly swapUsedGb: number | undefined;
  readonly swapTotalGb: number | undefined;
  readonly segmentsUsed: number | undefined;
  readonly segmentsLimit: number | undefined;
  readonly segmentsPct: number | undefined;
  readonly compressedPagesPct: number | undefined;
  readonly swapfileCount: number | undefined;
  /** The volume's used percent — the DISK, as against {@link MachineCapacityJson.segmentsPct}'s compressor. */
  readonly diskUsedPct: number | undefined;
  readonly diskFreeGb: number | undefined;
  /** The `df`-available GB the volume holds below, so a reader can say the floor beside the free figure. */
  readonly diskHoldFreeGb: number;
  /** Worktree REGISTRATIONS across every declared main checkout that answered — `./diskFootprint.ts`. */
  readonly registeredWorktrees: number | undefined;
  /** One entry per declared main checkout, so a reader can see which repository holds them. */
  readonly worktreeRepos: readonly RepoWorktreeCount[];
  readonly topForeign: MachineCapacityReport["topForeign"];
  readonly hiddenCpu: MachineCapacityReport["hiddenCpu"];
  readonly fleet: MachineCapacityReport["fleet"];
  readonly culprit: MachineCapacityReport["culprit"];
  /** Searches inside live seats that have run away (`./runawaySearch.ts`) — never their argv, which can carry a pattern. */
  readonly runawaySearches: readonly {
    readonly pid: number;
    readonly binary: string;
    readonly cpuPct: number;
    readonly elapsedSeconds: number;
    readonly shellPid: number;
    readonly sessionId: string;
  }[];
  readonly hookStallHoldSeconds: number;
  readonly parallelCallAlert: number;
  readonly foreignAlertGb: number;
  readonly swapAlertGb: number;
  readonly segmentsHoldPct: number;
  readonly swapfileHoldCount: number;
  readonly loadHold: number;
  /** The sessions booted inside the window and the count that holds — `./recentBoots.ts`. */
  readonly recentBoots: MachineCapacityReport["recentBoots"];
  readonly graded: MachineCapacityReport["graded"];
  readonly ungraded: MachineCapacityReport["ungraded"];
  readonly holdSubjects: MachineCapacityReport["holdSubjects"];
  readonly alert: boolean;
  readonly hold: boolean;
  readonly verdict: string;
}

/** One runaway search as `--json` carries it — its argv dropped, because a pattern can carry anything. */
function searchJson({ search }: { search: RunawaySearch }): MachineCapacityJson["runawaySearches"][number] {
  return {
    binary: search.binary,
    cpuPct: search.cpuPct,
    elapsedSeconds: search.elapsedSeconds,
    pid: search.pid,
    sessionId: search.sessionId,
    shellPid: search.shellPid,
  };
}

/**
 * Flatten a report into the `--json` shape.
 *
 * @param report the report to flatten
 * @param dispatch what the dispatch register said, read by the shell — never by this pure renderer
 * @param ceilings the plan and machine ceilings the shell read beside the report, when it read them
 * @param spawnBackoff the fleet spawn backoff the shell read beside the report, when it read it
 * @returns the flattened, machine-readable report
 */
export function machineCapacityJson({
  report,
  dispatch,
  ceilings,
  spawnBackoff,
}: {
  report: MachineCapacityReport;
  dispatch: DispatchBlock;
  ceilings?: CeilingsReading | undefined;
  spawnBackoff?: SpawnBackoffReport | undefined;
}): MachineCapacityJson {
  return {
    ...(ceilings === undefined ? {} : { ceilings }),
    ...(spawnBackoff === undefined ? {} : { spawnBackoff }),
    alert: report.alert,
    recentBoots: report.recentBoots,
    cpuHogs: report.cpuHogs,
    dispatch,
    compressedPagesPct: report.compressor?.compressedPagesPct,
    culprit: report.culprit,
    diskFreeGb: volumeFreeGb({ volume: report.disk?.volume }),
    diskHoldFreeGb: report.diskHoldFreeGb,
    diskUsedPct: report.disk?.volume?.usedPct,
    fleet: report.fleet,
    fleetChildAlert: report.fleetChildAlert,
    foreignAlertGb: report.foreignAlertGb,
    graded: report.graded,
    hiddenCpu: report.hiddenCpu,
    hold: report.hold,
    hookStallHoldSeconds: report.hookStallHoldSeconds,
    holdSubjects: report.holdSubjects,
    load: report.load,
    loadHold: report.loadHold,
    parallelCallAlert: report.parallelCallAlert,
    processes: report.processes,
    runawaySearches: report.runawaySearches.map((search) => searchJson({ search })),
    registeredWorktrees: report.disk?.registeredTotal,
    segmentsHoldPct: report.segmentsHoldPct,
    segmentsLimit: report.compressor?.segmentsLimit,
    segmentsPct: report.compressor?.segmentsPct,
    segmentsUsed: report.compressor?.segmentsUsed,
    swapAlertGb: report.swapAlertGb,
    swapTotalGb: report.swap?.totalGb,
    swapUsedGb: report.swap?.usedGb,
    swapfileCount: report.swapfileCount,
    swapfileHoldCount: report.swapfileHoldCount,
    topFleetChild: report.topFleetChild,
    topForeign: report.topForeign,
    watchedProcesses: report.watchedProcesses,
    ungraded: report.ungraded,
    verdict: report.verdict,
    worktreeRepos: report.disk === undefined ? [] : report.disk.repos,
  };
}

/**
 * Render the report as text lines: the load/swap/compressor summary, the hidden-CPU reading, and the verdict last.
 *
 * By default the ranked process table and the fleet's live sessions are one count line, with any orphan group still
 * printed because `machine reap` acts on it; `full` prints the fleet-load breakdown and the table. MEASURED:
 * 3,953 characters over 40 lines, most of them the process table (repro: `slopweaver machine
 * capacity` against `--full`). The verdict already names the process a hold is about, so the table is detail.
 *
 * @param report the report to render
 * @param full whether to print the fleet-load breakdown and one line per ranked process
 * @returns the lines, in display order
 */
export function renderMachineCapacityLines({
  report,
  full,
}: {
  report: MachineCapacityReport;
  full: boolean;
}): readonly string[] {
  const lines: string[] = [];
  if (report.load !== undefined) {
    const { load1, load5, load15 } = report.load;
    lines.push(
      `load avg: ${String(load1)} ${String(load5)} ${String(load15)} (1-min hold at ${String(report.loadHold)})`,
    );
  }
  // Directly under the load, because it is the load the average has not caught up with yet. Only
  // when there is one: a quiet machine's report does not grow a line saying nothing booted.
  const { boots, hold, windowSeconds } = report.recentBoots;
  if (boots.length > 0) {
    const who = boots.map((boot) => `${boot.sessionId} ${String(boot.seconds)}s`).join(", ");
    lines.push(
      `recent boots: ${String(boots.length)} in the last ${String(windowSeconds)}s, hold at ${String(hold)} — ${who}`,
    );
  }
  if (report.swap !== undefined) {
    lines.push(`swap: ${String(report.swap.usedGb)}/${String(report.swap.totalGb)} GB`);
  }
  if (report.compressor !== undefined) {
    const { segmentsUsed, segmentsLimit, segmentsPct } = report.compressor;
    lines.push(
      `compressor: ${String(segmentsUsed)}/${String(segmentsLimit)} segments (${String(segmentsPct)}%, hold at ${String(report.segmentsHoldPct)}%)`,
    );
  }
  if (report.swapfileCount !== undefined) {
    lines.push(`swapfiles: ${String(report.swapfileCount)} (hold at ${String(report.swapfileHoldCount)})`);
  }
  if (report.disk !== undefined) {
    // Directly under the swapfile line, because both are about the same volume and a reader who has just
    // been told there are twelve swapfiles is already asking how much room is left for them.
    const disk = diskLine({ reading: report.disk });
    if (disk !== undefined) {
      lines.push(disk);
    }
  }
  lines.push(...hiddenCpuLines({ reading: report.hiddenCpu }));
  if (!full) {
    lines.push(
      `processes: ${String(report.processes.length)} ranked · fleet: ${String(report.fleet.sessions.length)} live session(s) (--full lists them with the fleet's load; --json carries every field)`,
    );
    // An orphan group is something to act on (`machine reap`), so it stays on the default read: topN 0 prints only those.
    lines.push(...fleetLoadLines({ reading: report.fleet, topN: 0 }), report.verdict);
    return lines;
  }
  // Every live session, not fleetLoadLines' default five: the default line counts them all and promises --full lists them.
  lines.push(
    ...fleetLoadLines({ reading: report.fleet, topN: report.fleet.sessions.length }),
    ...processLines({ report }),
    report.verdict,
  );
  return lines;
}

/**
 * One line per ranked process — footprint, classification, label, pid and the session that owns it.
 *
 * @param report the report whose ranked processes are listed
 * @returns the lines, in ranked order
 */
function processLines({ report }: { report: MachineCapacityReport }): readonly string[] {
  return report.processes.map((process) => {
    const owner = process.session === undefined ? "" : ` · ${sessionPhrase({ session: process.session })}`;
    return `  ${String(process.footprintGb).padStart(6)} GB  ${process.classification.padEnd(7)}  ${process.label} (pid ${String(process.pid)})${owner}`;
  });
}
