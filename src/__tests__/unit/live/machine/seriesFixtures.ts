/**
 * Shared fixtures for the `machine series` tests: a two-sample `top` print in the shape measured on this machine
 * (`top -l 2 -s 1 -stats pid,cpu,mem`), a process table with one Claude Code session under cmux, a
 * cmux build child, two foreign processes and the kernel (pid 0, which `ps -ax` never lists), and the seams that
 * serve them.
 */
import type { ProcessComm } from "../../../../live/machine/capacityParse.js";
import type { MachineSeriesSample } from "../../../../live/machine/series.js";
import type { MachineSeriesDeps } from "../../../../live/machine/seriesRead.js";
import type { ProcessRow } from "../../../../live/standing/processes.js";

/** The session id the fixture's `claude` carries in both its argv and its registry file. */
export const SESSION_ID = "aaaaaaaa-1111-2222-3333-444444444444";

/** `top -l 2 -s 1 -stats pid,cpu,mem`: the first sample's %CPU is zero; the second is the measured one. */
export const TOP_TEXT = [
  "Processes: 900 total, 3 running, 897 sleeping, 4000 threads",
  "2026/10/17 20:00:00",
  "Load Avg: 1.00, 1.00, 1.00",
  "PhysMem: 30G used (4000M wired, 9G compressor), 17G unused.",
  "",
  "PID    %CPU MEM",
  "100    0.0  100M",
  "Processes: 900 total, 3 running, 897 sleeping, 4000 threads",
  "2026/10/17 20:00:01",
  "Load Avg: 24.50, 20.10, 18.00",
  "CPU usage: 40.0% user, 20.0% sys, 40.0% idle",
  "PhysMem: 35G used (5041M wired, 10G compressor), 12G unused.",
  "",
  "PID    %CPU MEM",
  "100    50.0 100M+",
  "101    30.5 200M",
  "200    120.0 1G-",
  "300    10.0 2048K",
  "400    5.0  10M",
  "0      2.0  30M",
  "",
].join("\n");

/** pid 50 is cmux; 100 the session's `claude` under it, 101 its tool child; 400 a build cmux spawned itself. */
export const PROCESSES: readonly ProcessRow[] = [
  { argv: "/Applications/cmux.app/Contents/MacOS/cmux", pid: 50, ppid: 1 },
  { argv: `claude --session-id ${SESSION_ID} --model opus`, pid: 100, ppid: 50 },
  { argv: "node /repo/node_modules/.bin/vitest run", pid: 101, ppid: 100 },
  { argv: "/Applications/Trajectory.app/Contents/MacOS/Trajectory --token=secret", pid: 200, ppid: 1 },
  { argv: "/usr/local/bin/esbuild --service=0.25.0", pid: 300, ppid: 1 },
  { argv: "node build.js", pid: 400, ppid: 50 },
];

/** `comm` per pid: the label a foreign process is named by. */
export const COMMS: readonly ProcessComm[] = [
  { comm: "/Applications/cmux.app/Contents/MacOS/cmux", pid: 50 },
  { comm: "claude", pid: 100 },
  { comm: "node", pid: 101 },
  { comm: "/Applications/Trajectory.app/Contents/MacOS/Trajectory", pid: 200 },
  { comm: "/usr/local/bin/esbuild", pid: 300 },
  { comm: "node", pid: 400 },
];

/** The four compressor oids, half the segment limit used. */
const COMPRESSOR_TEXT = [
  "vm.compressor.segment.total: 500",
  "vm.compressor.segment.limit: 1000",
  "vm.compressor_segment_pages_compressed: 100",
  "vm.compressor_segment_pages_compressed_limit: 1000",
  "",
].join("\n");

/** `sysctl vm.swapusage`. */
const SWAP_TEXT = "vm.swapusage: total = 4096.00M  used = 1536.00M  free = 2560.00M  (encrypted)\n";

/** The machine's physical memory, 48 GiB. */
export const TOTAL_MEMORY_BYTES = 48 * 1024 ** 3;

/**
 * `vm_stat` in the shape measured on this machine: app memory 950,000 pages (anonymous less
 * purgeable), 300,000 wired and 400,000 in the compressor, 16 KiB each — 1,650,000 pages in use.
 */
export const VM_STAT_TEXT = [
  "Mach Virtual Memory Statistics: (page size of 16384 bytes)",
  "Pages free:                                   128684.",
  "Pages active:                                 944186.",
  "Pages wired down:                             300000.",
  "Pages purgeable:                               50000.",
  "File-backed pages:                            226565.",
  "Anonymous pages:                             1000000.",
  "Pages stored in compressor:                  1397159.",
  "Pages occupied by compressor:                 400000.",
  "",
].join("\n");

/** The memory in use {@link VM_STAT_TEXT} sums to, in bytes. */
export const VM_STAT_USED_BYTES = 1_650_000 * 16_384;

/**
 * Seams that serve the fixture, counting each `top` call.
 *
 * @returns the seams and the count so far
 */
export function fixtureDeps({ topText = TOP_TEXT }: { topText?: string } = {}): {
  deps: MachineSeriesDeps;
  topCalls: () => number;
} {
  let calls = 0;
  return {
    deps: {
      comms: () => COMMS,
      compressorSysctl: () => COMPRESSOR_TEXT,
      cores: () => 15,
      processes: () => PROCESSES,
      sessions: () => [{ cwd: "/repo", pid: 100, sessionId: SESSION_ID }],
      swapUsage: () => SWAP_TEXT,
      top: () => {
        calls += 1;
        return topText;
      },
      totalMemory: () => TOTAL_MEMORY_BYTES,
      vmStat: () => VM_STAT_TEXT,
    },
    topCalls: () => calls,
  };
}

/**
 * One stored sample at an instant with a load, everything else fixed. The hold is 45, 3 x the 15 cores; the idle
 * percentage is absent unless given, as on a sample written before idle was recorded.
 *
 * @returns the sample
 */
export function sampleAt({
  observedAtIso,
  load1,
  idlePct,
}: {
  observedAtIso: string;
  load1: number;
  idlePct?: number;
}): MachineSeriesSample {
  return {
    cores: 15,
    cpu: { fleetPct: 85.5, otherPct: 130, ...(idlePct === undefined ? {} : { idlePct }) },
    load: { holdAt: 45, load1 },
    memory: {
      compressorSegmentsPct: 50,
      swapTotalGb: 4,
      swapUsedGb: 1.5,
      totalBytes: 47 * 1024 ** 3,
      usedBytes: 35 * 1024 ** 3,
    },
    observedAtIso,
    sessions: [],
    topOtherCpu: [],
    topOtherMemory: [],
  };
}
