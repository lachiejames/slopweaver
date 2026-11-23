/**
 * The capacity HOLD wait, over plain fake read seams and a fake clock: one reading samples every seam once,
 * hands the watched-daemon read exactly the pids of the watched binary taken from that same process table,
 * and grades the result exactly as the report builder does; a wait prints a still-held subject once rather
 * than once per poll and settles when it clears, a disk-only hold settles the wait at once because waiting
 * cannot clear it, and a hold that outlasts the deadline returns the last reading as timed out.
 */
import { describe, expect, it } from "vitest";

import { buildMachineCapacityReport, type MachineCapacityReport } from "../../../../live/machine/capacity.js";
import { readMachineCapacity, waitForCapacityClear } from "../../../../live/machine/capacityWait.js";
import type { DiskReading } from "../../../../live/machine/diskFootprint.js";
import type { MachineCapacityDeps } from "../../../../live/machine/read.js";
import type { WaitClock } from "../../../../wait/loop.js";

const FSEVENTSD =
  "/System/Library/Frameworks/CoreServices.framework/Versions/A/Frameworks/FSEvents.framework/Versions/A/Support/fseventsd";

const HEALTHY_COMPRESSOR_TEXT = [
  "vm.compressor.segment.total: 182761",
  "vm.compressor.segment.limit: 1234946",
  "vm.compressor_segment_pages_compressed: 738386",
  "vm.compressor_segment_pages_compressed_limit: 19759136",
  "",
].join("\n");

const PANIC_COMPRESSOR_TEXT = [
  "vm.compressor.segment.total: 1234946",
  "vm.compressor.segment.limit: 1234946",
  "vm.compressor_segment_pages_compressed: 7706063",
  "vm.compressor_segment_pages_compressed_limit: 19759136",
  "",
].join("\n");

const QUIET_TOP_TEXT = "Load Avg: 1.0, 1.0, 1.0 \nPID    MEM  \n";
const SWAP_TEXT = "vm.swapusage: total = 4096.00M  used = 512.00M  free = 3584.00M";
const COMMS = [
  { comm: "/bin/zsh", pid: 10 },
  { comm: FSEVENTSD, pid: 4242 },
  { comm: FSEVENTSD, pid: 4343 },
];

/** 44.7 GB free, under the 44.8 GB floor of eight seat trees (the boots burst, the next and a spare). */
const LOW_DISK: DiskReading = {
  registeredTotal: undefined,
  repos: [],
  volume: { availableKib: 43_652_343, totalKib: 971_298_980, usedPct: 85 },
};

/** Fake read seams over one machine state, every call recorded by name in the order it was made. */
function fakeDeps({
  calls,
  compressorText,
  disk,
}: {
  calls: string[];
  compressorText: string;
  disk: DiskReading | undefined;
}): MachineCapacityDeps {
  return {
    chairSessionId: () => undefined,
    comms: () => {
      calls.push("comms");
      return COMMS;
    },
    compressorSysctl: () => {
      calls.push("compressorSysctl");
      return compressorText;
    },
    cpuCount: () => {
      calls.push("cpuCount");
      return 15;
    },
    cpuSample: () => {
      calls.push("cpuSample");
      return undefined;
    },
    disk: () => {
      calls.push("disk");
      return disk;
    },
    elapsed: () => {
      calls.push("elapsed");
      return [];
    },
    processes: () => {
      calls.push("processes");
      return [];
    },
    sessions: () => {
      calls.push("sessions");
      return [];
    },
    statRows: () => {
      calls.push("statRows");
      return [];
    },
    swapUsage: () => {
      calls.push("swapUsage");
      return SWAP_TEXT;
    },
    swapfileCount: () => {
      calls.push("swapfileCount");
      return 3;
    },
    topReport: () => {
      calls.push("topReport");
      return QUIET_TOP_TEXT;
    },
    watchedTopReport: ({ pids }) => {
      calls.push(`watchedTopReport:${pids.join(",")}`);
      return undefined;
    },
  };
}

/** One reading of a machine state, its seam calls discarded. */
function reading({
  compressorText,
  disk,
}: {
  compressorText: string;
  disk: DiskReading | undefined;
}): MachineCapacityReport {
  return readMachineCapacity({ deps: fakeDeps({ calls: [], compressorText, disk }), topN: 5 });
}

/** A clock whose time moves only when the wait sleeps, every sleep recorded. */
function fakeClock({ sleeps }: { sleeps: number[] }): WaitClock {
  let now = 0;
  return {
    nowMs: () => now,
    sleep: async ({ ms }) => {
      sleeps.push(ms);
      now += ms;
    },
  };
}

describe("readMachineCapacity", () => {
  it("samples every seam once, handing the watched read the watched daemon's pids, and grades a compressor hold", () => {
    const calls: string[] = [];

    const report = readMachineCapacity({
      deps: fakeDeps({ calls, compressorText: PANIC_COMPRESSOR_TEXT, disk: undefined }),
      topN: 5,
    });

    expect(calls).toEqual([
      "comms",
      "compressorSysctl",
      "cpuCount",
      "cpuSample",
      "disk",
      "elapsed",
      "processes",
      "sessions",
      "statRows",
      "swapUsage",
      "swapfileCount",
      "topReport",
      "watchedTopReport:4242,4343",
    ]);
    expect(report.hold).toBe(true);
    expect(report.holdSubjects).toEqual(["memory"]);
    expect(report).toEqual(
      buildMachineCapacityReport({
        chairSessionId: undefined,
        comms: COMMS,
        compressorText: PANIC_COMPRESSOR_TEXT,
        cores: 15,
        cpuSampleText: undefined,
        disk: undefined,
        elapsedRows: [],
        processes: [],
        sessions: [],
        statRows: [],
        swapText: SWAP_TEXT,
        swapfileCount: 3,
        topN: 5,
        topText: QUIET_TOP_TEXT,
        watchedTopText: undefined,
      }),
    );
  });
});

describe("waitForCapacityClear", () => {
  it("prints an unchanged hold once and settles on the reading that cleared", async () => {
    const held = reading({ compressorText: PANIC_COMPRESSOR_TEXT, disk: undefined });
    const clear = reading({ compressorText: HEALTHY_COMPRESSOR_TEXT, disk: undefined });
    const queue = [held, held, clear];
    const lines: string[] = [];
    const sleeps: number[] = [];

    const outcome = await waitForCapacityClear({
      clock: fakeClock({ sleeps }),
      emit: (line) => lines.push(line),
      read: () => queue.shift()!,
      timeoutSeconds: 600,
    });

    expect(lines).toEqual(["machine capacity: HOLD on memory — waiting for it to clear"]);
    expect(sleeps).toEqual([10_000, 20_000]);
    expect(outcome.kind).toBe("settled");
    expect(outcome.reads).toBe(3);
    expect(outcome.reading).toBe(clear);
  });

  it("settles at once on a disk-only hold, which no amount of waiting clears", async () => {
    const diskOnly = reading({ compressorText: HEALTHY_COMPRESSOR_TEXT, disk: LOW_DISK });
    const lines: string[] = [];
    const sleeps: number[] = [];

    const outcome = await waitForCapacityClear({
      clock: fakeClock({ sleeps }),
      emit: (line) => lines.push(line),
      read: () => diskOnly,
      timeoutSeconds: 600,
    });

    expect(diskOnly.hold).toBe(true);
    expect(diskOnly.holdSubjects).toEqual(["disk"]);
    expect(outcome).toEqual({ kind: "settled", reading: diskOnly, reads: 1 });
    expect(lines).toEqual([]);
    expect(sleeps).toEqual([]);
  });

  it("returns the last reading as timed out when the hold outlasts the deadline", async () => {
    const held = reading({ compressorText: PANIC_COMPRESSOR_TEXT, disk: undefined });
    const lines: string[] = [];
    const sleeps: number[] = [];

    const outcome = await waitForCapacityClear({
      clock: fakeClock({ sleeps }),
      emit: (line) => lines.push(line),
      read: () => held,
      timeoutSeconds: 30,
    });

    expect(outcome).toEqual({ kind: "timed-out", reading: held, reads: 3 });
    expect(sleeps).toEqual([10_000, 20_000]);
    expect(lines).toEqual(["machine capacity: HOLD on memory — waiting for it to clear"]);
  });
});
