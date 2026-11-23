/**
 * Waiting for the machine's capacity HOLD to clear — the wait `machine capacity --wait` and `cmux spawn --wait`
 * share, on the one wait contract (`src/wait/loop.ts`).
 *
 * The supervisor's spawn scripts re-read `machine capacity` between every spawn of a list (the self-improvement
 * page counted 26 hand-rolled `machine capacity` loops and 27 `cmux spawn` loops in one measured week).
 * The condition they were waiting for is one field — `hold` — so it is waited on here, once, rather than
 * re-derived in every script that carries the loop forward.
 */
import {
  PROVIDER_WAIT_CEILING_MS,
  PROVIDER_WAIT_SCHEDULE_MS,
  type WaitClock,
  type WaitOutcome,
  waitUntilSettled,
} from "../../wait/loop.js";
import { buildMachineCapacityReport, type MachineCapacityReport } from "./capacity.js";
import { watchedDaemonPids } from "./daemonWatch.js";
import type { MachineCapacityDeps } from "./read.js";
import { holdBlocksWait } from "./recentBoots.js";

/**
 * Take one capacity reading through the read seams.
 *
 * @param deps the `top`/`ps`/`sysctl` read seams
 * @param topN how many processes to rank
 * @returns the graded report
 */
export function readMachineCapacity({
  deps,
  topN,
}: {
  deps: MachineCapacityDeps;
  topN: number;
}): MachineCapacityReport {
  const comms = deps.comms();
  return buildMachineCapacityReport({
    chairSessionId: deps.chairSessionId(),
    comms,
    compressorText: deps.compressorSysctl(),
    cores: deps.cpuCount(),
    cpuSampleText: deps.cpuSample(),
    disk: deps.disk(),
    elapsedRows: deps.elapsed(),
    processes: deps.processes(),
    sessions: deps.sessions(),
    statRows: deps.statRows(),
    swapText: deps.swapUsage(),
    swapfileCount: deps.swapfileCount(),
    topN,
    topText: deps.topReport(),
    watchedTopText: deps.watchedTopReport({ pids: watchedDaemonPids({ comms }) }),
  });
}

/**
 * The line a still-held reading prints. It names the SUBJECTS and nothing that drifts between reads, so a hold
 * that sits on `cpu` for ten minutes prints once rather than once per load-average wobble.
 *
 * @param report a report whose `hold` is true
 * @returns the one line
 */
function capacityHoldLine({ report }: { report: MachineCapacityReport }): string {
  return `machine capacity: HOLD on ${report.holdSubjects.join(" and ")} — waiting for it to clear`;
}

/**
 * Wait until a capacity reading holds nothing a wait can outlast — a disk-only hold never clears while waiting,
 * so it settles the wait (`./recentBoots.ts`'s `holdBlocksWait`).
 *
 * @param read takes one reading
 * @param clock the injected time source
 * @param timeoutSeconds how long to wait
 * @param emit where a changed hold line goes
 * @returns the reading that cleared, or the last reading when the deadline arrived first
 */
export async function waitForCapacityClear({
  read,
  clock,
  timeoutSeconds,
  emit,
}: {
  read: () => MachineCapacityReport;
  clock: WaitClock;
  timeoutSeconds: number;
  emit: (line: string) => void;
}): Promise<WaitOutcome<MachineCapacityReport>> {
  return waitUntilSettled({
    ceilingMs: PROVIDER_WAIT_CEILING_MS,
    clock,
    emit,
    lines: (report) => [capacityHoldLine({ report })],
    read: () => Promise.resolve(read()),
    schedule: PROVIDER_WAIT_SCHEDULE_MS,
    settled: (report) => !holdBlocksWait({ hold: report.hold, holdSubjects: report.holdSubjects }),
    timeoutSeconds,
  });
}
