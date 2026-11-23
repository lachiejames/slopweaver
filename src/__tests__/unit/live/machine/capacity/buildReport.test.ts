import { describe, expect, it } from "vitest";
import {
  buildMachineCapacityReport,
  DEFAULT_FOREIGN_FOOTPRINT_ALERT_GB,
  DEFAULT_SEGMENTS_HOLD_PCT,
  DEFAULT_SWAP_ALERT_GB,
  DEFAULT_SWAPFILE_HOLD_COUNT,
} from "../../../../../live/machine/capacity.js";
import { DEFAULT_LOAD_HOLD } from "../../../../../live/machine/capacityHolds.js";
import {
  CORES,
  ENDPOINT_READING,
  HEALTHY_COMPRESSOR_TEXT,
  HEALTHY_GAUGES,
  OVERLOADED_TOP_TEXT,
  PANIC_COMPRESSOR_TEXT,
  SAMPLE_SWAP_TEXT,
  SAMPLE_TOP_TEXT,
} from "./fixtures.js";

/** A `top -l 2` report whose final sample reads `idle` percent idle, over a table of one process. */
const cpuSampleWithIdle = ({ idle }: { idle: number }): string => {
  const busy = 100 - idle;
  return [
    "Processes: 1 total, 1 running, 0 sleeping, 10 threads ",
    "CPU usage: 50.00% user, 20.00% sys, 30.00% idle ",
    "",
    "PID    %CPU",
    "100    0.0 ",
    "Processes: 1 total, 1 running, 0 sleeping, 10 threads ",
    `CPU usage: ${String(busy)}% user, 0% sys, ${String(idle)}% idle `,
    "",
    "PID    %CPU",
    "100    50.0",
    "",
  ].join("\n");
};

describe("buildMachineCapacityReport", () => {
  const processes = [
    { argv: "/System/Library/Frameworks/Metadata.framework/Versions/A/Support/mds", pid: 100, ppid: 1 },
    { argv: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome Helper (Renderer)", pid: 200, ppid: 1 },
    { argv: "/opt/synthetic/.local/bin/claude --session-id abc", pid: 300, ppid: 1 },
  ];
  const comms = [
    { comm: "/System/Library/Frameworks/Metadata.framework/Versions/A/Support/mds", pid: 100 },
    { comm: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome Helper (Renderer)", pid: 200 },
    { comm: "/opt/synthetic/.local/bin/claude", pid: 300 },
  ];

  it("ranks, labels and classifies every process, alerting when the top foreign hog crosses its threshold", () => {
    const report = buildMachineCapacityReport({
      ...HEALTHY_GAUGES,
      comms,
      processes,
      swapText: SAMPLE_SWAP_TEXT,
      topText: SAMPLE_TOP_TEXT,
    });
    expect(report.processes).toEqual([
      { classification: "foreign", footprintBytes: 20_656_947_200, footprintGb: 19.2, label: "mds", pid: 100 },
      {
        classification: "foreign",
        footprintBytes: 524_288_000,
        footprintGb: 0.5,
        label: "Google Chrome Helper (Renderer)",
        pid: 200,
      },
      { classification: "fleet", footprintBytes: 901_120, footprintGb: 0, label: "claude", pid: 300 },
    ]);
  });

  it("alerts when the top foreign process exceeds the foreign-footprint threshold", () => {
    const report = buildMachineCapacityReport({
      ...HEALTHY_GAUGES,
      comms,
      processes,
      swapText: undefined,
      topText: SAMPLE_TOP_TEXT,
    });
    expect(report.alert).toBe(true);
    expect(report.hold).toBe(false);
    expect(report.topForeign?.label).toBe("mds");
    expect(report.verdict).toBe(
      `machine capacity: ALERT on memory (foreign footprint over ${String(DEFAULT_FOREIGN_FOOTPRINT_ALERT_GB)} GB) — 1-min load 5.43 · idle unmeasured · top foreign hog 'mds' at 19.2 GB · swap unmeasured · compressor 15% of segments limit · 3 swapfiles`,
    );
  });

  it("alerts when swap exceeds its threshold even with no foreign process over its own", () => {
    const report = buildMachineCapacityReport({
      ...HEALTHY_GAUGES,
      comms: [],
      processes: [],
      swapText: SAMPLE_SWAP_TEXT,
      topText: "Load Avg: 1.0, 1.0, 1.0 \nPID    MEM  \n",
    });
    expect(report.alert).toBe(true);
    expect(report.topForeign).toBeUndefined();
    expect(report.verdict).toBe(
      `machine capacity: ALERT on memory (swap over ${String(DEFAULT_SWAP_ALERT_GB)} GB) — 1-min load 1 · idle unmeasured · no foreign process observed · swap 6.2/4 GB · compressor 15% of segments limit · 3 swapfiles`,
    );
  });

  it("reports ok when nothing crosses its threshold", () => {
    const report = buildMachineCapacityReport({
      ...HEALTHY_GAUGES,
      comms: [{ comm: "/Applications/cmux.app/Contents/MacOS/cmux", pid: 300 }],
      processes: [{ argv: "/Applications/cmux.app/Contents/MacOS/cmux", pid: 300, ppid: 1 }],
      swapText: "vm.swapusage: total = 4096.00M  used = 512.00M  free = 3584.00M",
      topText: "Load Avg: 1.0, 1.0, 1.0 \nPID    MEM  \n300    500M \n",
    });
    expect(report.alert).toBe(false);
    expect(report.hold).toBe(false);
    expect(report.topForeign).toBeUndefined();
    expect(report.verdict).toBe(
      "machine capacity: ok on memory and cpu — 1-min load 1 · idle unmeasured · no foreign process observed · swap 0.5/4 GB · compressor 15% of segments limit · 3 swapfiles",
    );
  });

  it("respects a custom topN and alert thresholds", () => {
    const report = buildMachineCapacityReport({
      ...HEALTHY_GAUGES,
      comms,
      foreignAlertGb: 100,
      processes,
      swapAlertGb: 100,
      swapText: SAMPLE_SWAP_TEXT,
      topN: 1,
      topText: SAMPLE_TOP_TEXT,
    });
    expect(report.processes).toHaveLength(1);
    expect(report.alert).toBe(false);
  });

  it("HOLDs on the panic's own readings — 100% of the segments limit and 49 swapfiles — with no foreign hog at all", () => {
    const report = buildMachineCapacityReport({
      chairSessionId: undefined,
      comms: [],
      compressorText: PANIC_COMPRESSOR_TEXT,
      cores: CORES,
      processes: [],
      sessions: [],
      swapText: "vm.swapusage: total = 50176.00M  used = 49152.00M  free = 1024.00M  (encrypted)",
      swapfileCount: 49,
      topText: "Load Avg: 20.0, 21.0, 22.0 \nPID    MEM  \n",
    });
    expect(report.hold).toBe(true);
    expect(report.compressor?.segmentsPct).toBe(100);
    expect(report.swapfileCount).toBe(49);
    expect(report.verdict).toBe(
      `machine capacity: HOLD on memory (compressor at 100% of its segments limit, hold at ${String(DEFAULT_SEGMENTS_HOLD_PCT)}%; 49 swapfiles, hold at ${String(DEFAULT_SWAPFILE_HOLD_COUNT)}) · ALERT on memory (swap over ${String(DEFAULT_SWAP_ALERT_GB)} GB) — 1-min load 20 · idle unmeasured · no foreign process observed · swap 48/49 GB · compressor 100% of segments limit · 49 swapfiles`,
    );
  });

  it("HOLDs on the segment ratio alone, at exactly the threshold, with the swapfile count under its own", () => {
    const report = buildMachineCapacityReport({
      chairSessionId: undefined,
      comms: [],
      compressorText: `vm.compressor.segment.total: ${String(DEFAULT_SEGMENTS_HOLD_PCT)}\nvm.compressor.segment.limit: 100\n`,
      cores: CORES,
      processes: [],
      sessions: [],
      swapText: undefined,
      swapfileCount: DEFAULT_SWAPFILE_HOLD_COUNT - 1,
      topText: undefined,
    });
    expect(report.hold).toBe(true);
    expect(report.alert).toBe(false);
    expect(report.verdict).toBe(
      `machine capacity: HOLD on memory (compressor at ${String(DEFAULT_SEGMENTS_HOLD_PCT)}% of its segments limit, hold at ${String(DEFAULT_SEGMENTS_HOLD_PCT)}%) · cpu UNGRADED — load unmeasured · idle unmeasured · no foreign process observed · swap unmeasured · compressor ${String(DEFAULT_SEGMENTS_HOLD_PCT)}% of segments limit · ${String(DEFAULT_SWAPFILE_HOLD_COUNT - 1)} swapfiles`,
    );
  });

  it("HOLDs on the swapfile count alone, at exactly the threshold, with the compressor under its own", () => {
    const report = buildMachineCapacityReport({
      chairSessionId: undefined,
      comms: [],
      compressorText: HEALTHY_COMPRESSOR_TEXT,
      cores: CORES,
      processes: [],
      sessions: [],
      swapText: undefined,
      swapfileCount: DEFAULT_SWAPFILE_HOLD_COUNT,
      topText: undefined,
    });
    expect(report.hold).toBe(true);
    expect(report.verdict).toBe(
      `machine capacity: HOLD on memory (${String(DEFAULT_SWAPFILE_HOLD_COUNT)} swapfiles, hold at ${String(DEFAULT_SWAPFILE_HOLD_COUNT)}) · cpu UNGRADED — load unmeasured · idle unmeasured · no foreign process observed · swap unmeasured · compressor 15% of segments limit · ${String(DEFAULT_SWAPFILE_HOLD_COUNT)} swapfiles`,
    );
  });

  it("never HOLDs on a gauge it could not read — an unmeasured compressor is said, not graded", () => {
    const report = buildMachineCapacityReport({
      chairSessionId: undefined,
      comms: [],
      compressorText: undefined,
      cores: CORES,
      processes: [],
      sessions: [],
      swapText: undefined,
      swapfileCount: undefined,
      topText: undefined,
    });
    expect(report.hold).toBe(false);
    expect(report.compressor).toBeUndefined();
    expect(report.verdict).toBe(
      "machine capacity: graded nothing · memory and cpu UNGRADED — load unmeasured · idle unmeasured · no foreign process observed · swap unmeasured · compressor unmeasured · swapfiles uncounted",
    );
  });

  it("HOLDs on a load over the 45 hold with every memory gauge healthy and idle unread, naming cpu as the subject", () => {
    const report = buildMachineCapacityReport({
      ...HEALTHY_GAUGES,
      comms: [],
      processes: [],
      swapText: "vm.swapusage: total = 2048.00M  used = 819.20M  free = 1228.80M",
      topText: OVERLOADED_TOP_TEXT,
    });
    expect(report.hold).toBe(true);
    expect(report.alert).toBe(false);
    expect(report.holdSubjects).toEqual(["cpu"]);
    expect(report.loadHold).toBe(45);
    expect(report.verdict).toBe(
      "machine capacity: HOLD on cpu (1-min load 46.5, hold at 45, idle unmeasured, so load judged alone) — 1-min load 46.5 · idle unmeasured · no foreign process observed · swap 0.8/2 GB · compressor 15% of segments limit · 3 swapfiles",
    );
  });

  it("does not hold on a load of 34.84 any more — under the doubled hold of 45", () => {
    const report = buildMachineCapacityReport({
      ...HEALTHY_GAUGES,
      comms: [],
      processes: [],
      swapText: undefined,
      topText: "Load Avg: 34.84, 30.12, 25.01 \nPID    MEM  \n",
    });
    expect(report.hold).toBe(false);
    expect(report.holdSubjects).toEqual([]);
  });

  it("HOLDs at exactly the load threshold, and not one hundredth under it", () => {
    const at = buildMachineCapacityReport({
      ...HEALTHY_GAUGES,
      comms: [],
      processes: [],
      swapText: undefined,
      topText: "Load Avg: 45.0, 1.0, 1.0 \nPID    MEM  \n",
    });
    const under = buildMachineCapacityReport({
      ...HEALTHY_GAUGES,
      comms: [],
      processes: [],
      swapText: undefined,
      topText: "Load Avg: 44.99, 1.0, 1.0 \nPID    MEM  \n",
    });
    expect(at.hold).toBe(true);
    expect(under.hold).toBe(false);
    expect(under.verdict).toBe(
      "machine capacity: ok on memory and cpu — 1-min load 44.99 · idle unmeasured · no foreign process observed · swap unmeasured · compressor 15% of segments limit · 3 swapfiles",
    );
  });

  it("does NOT hold on a load of 46.5 while top reads 40% idle, and says so in the verdict", () => {
    const report = buildMachineCapacityReport({
      ...HEALTHY_GAUGES,
      comms: [],
      cpuSampleText: cpuSampleWithIdle({ idle: 40 }),
      processes: [],
      swapText: undefined,
      topText: OVERLOADED_TOP_TEXT,
    });
    expect(report.hold).toBe(false);
    expect(report.holdSubjects).toEqual([]);
    expect(report.hiddenCpu.idlePct).toBe(40);
    expect(report.verdict).toBe(
      "machine capacity: ok on memory and cpu — 1-min load 46.5 · 40% idle · no foreign process observed · swap unmeasured · compressor 15% of segments limit · 3 swapfiles",
    );
  });

  it("HOLDs on the same load of 46.5 at 3% idle, with the idle named against its floor", () => {
    const report = buildMachineCapacityReport({
      ...HEALTHY_GAUGES,
      comms: [],
      cpuSampleText: cpuSampleWithIdle({ idle: 3 }),
      processes: [],
      swapText: undefined,
      topText: OVERLOADED_TOP_TEXT,
    });
    expect(report.hold).toBe(true);
    expect(report.holdSubjects).toEqual(["cpu"]);
    expect(report.verdict).toBe(
      "machine capacity: HOLD on cpu (1-min load 46.5, hold at 45, 3% idle, under the 20% floor) — 1-min load 46.5 · 3% idle · no foreign process observed · swap unmeasured · compressor 15% of segments limit · 3 swapfiles",
    );
  });

  it("holds on idle just under the floor and clears at exactly the floor", () => {
    const under = buildMachineCapacityReport({
      ...HEALTHY_GAUGES,
      comms: [],
      cpuSampleText: cpuSampleWithIdle({ idle: 19.9 }),
      processes: [],
      swapText: undefined,
      topText: OVERLOADED_TOP_TEXT,
    });
    const at = buildMachineCapacityReport({
      ...HEALTHY_GAUGES,
      comms: [],
      cpuSampleText: cpuSampleWithIdle({ idle: 20 }),
      processes: [],
      swapText: undefined,
      topText: OVERLOADED_TOP_TEXT,
    });
    expect(under.hold).toBe(true);
    expect(at.hold).toBe(false);
  });

  it("falls back to load alone when the cpu sample is unreadable, rather than clearing on a missing idle", () => {
    const report = buildMachineCapacityReport({
      ...HEALTHY_GAUGES,
      comms: [],
      cpuSampleText: "not a top report\n",
      processes: [],
      swapText: undefined,
      topText: OVERLOADED_TOP_TEXT,
    });
    expect(report.hiddenCpu.idlePct).toBeUndefined();
    expect(report.hold).toBe(true);
  });

  it("names both subjects when the compressor and the load both cross their holds", () => {
    const report = buildMachineCapacityReport({
      chairSessionId: undefined,
      comms: [],
      compressorText: PANIC_COMPRESSOR_TEXT,
      cores: CORES,
      processes: [],
      sessions: [],
      swapText: undefined,
      swapfileCount: 3,
      topText: OVERLOADED_TOP_TEXT,
    });
    expect(report.holdSubjects).toEqual(["memory", "cpu"]);
    expect(report.verdict).toBe(
      `machine capacity: HOLD on memory and cpu (compressor at 100% of its segments limit, hold at ${String(DEFAULT_SEGMENTS_HOLD_PCT)}%; 1-min load 46.5, hold at 45, idle unmeasured, so load judged alone) — 1-min load 46.5 · idle unmeasured · no foreign process observed · swap unmeasured · compressor 100% of segments limit · 3 swapfiles`,
    );
  });

  it("calls cpu UNGRADED rather than ok when top printed no load header, memory readings and all", () => {
    const report = buildMachineCapacityReport({
      ...HEALTHY_GAUGES,
      comms: [],
      processes: [],
      swapText: "vm.swapusage: total = 4096.00M  used = 512.00M  free = 3584.00M",
      topText: "PID    MEM  \n",
    });
    expect(report.hold).toBe(false);
    expect(report.graded).toEqual(["memory"]);
    expect(report.ungraded).toEqual(["cpu"]);
    expect(report.verdict).toBe(
      "machine capacity: ok on memory · cpu UNGRADED — load unmeasured · idle unmeasured · no foreign process observed · swap 0.5/4 GB · compressor 15% of segments limit · 3 swapfiles",
    );
  });

  it("holds at the default 45 when the core count could not be read", () => {
    const report = buildMachineCapacityReport({
      ...HEALTHY_GAUGES,
      comms: [],
      cores: undefined,
      processes: [],
      swapText: undefined,
      topText: OVERLOADED_TOP_TEXT,
    });
    expect(report.loadHold).toBe(DEFAULT_LOAD_HOLD);
    expect(DEFAULT_LOAD_HOLD).toBe(45);
    expect(report.hold).toBe(true);
  });

  it("folds a process that refused its stats into the foreign-hog clause, holding and alerting on nothing new", () => {
    const report = buildMachineCapacityReport({
      ...ENDPOINT_READING,
    });
    expect(report.hold).toBe(false);
    expect(report.alert).toBe(false);
    expect(report.topForeign?.label).toBe("com.apple.Virtualization.VirtualMachine");
    expect(report.verdict).toBe(
      "machine capacity: ok on memory and cpu — 1-min load 8.38 · 64.35% idle · top foreign hog 'com.apple.Virtualization.VirtualMachine' at 6 GB · hidden from top: 'com.example.endpoint.Agent' +3 more, 2.8 cores of cpu unattributed · swap unmeasured · compressor 15% of segments limit · 3 swapfiles",
    );
  });

  it("respects custom hold thresholds", () => {
    const report = buildMachineCapacityReport({
      ...HEALTHY_GAUGES,
      comms: [],
      processes: [],
      segmentsHoldPct: 15,
      swapText: undefined,
      swapfileHoldCount: 3,
      topText: undefined,
    });
    expect(report.hold).toBe(true);
    expect(report.segmentsHoldPct).toBe(15);
    expect(report.swapfileHoldCount).toBe(3);
  });
});
