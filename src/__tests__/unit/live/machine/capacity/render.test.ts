import { describe, expect, it } from "vitest";
import {
  buildMachineCapacityReport,
  DEFAULT_SEGMENTS_HOLD_PCT,
  DEFAULT_SWAPFILE_HOLD_COUNT,
} from "../../../../../live/machine/capacity.js";
import { DEFAULT_LOAD_HOLD } from "../../../../../live/machine/capacityHolds.js";
import { machineCapacityJson, renderMachineCapacityLines } from "../../../../../live/machine/capacityRender.js";
import { TWO_SAMPLE_TOP_CPU_TEXT } from "../hiddenCpuFixtures.js";
import { ENDPOINT_READING, HEALTHY_GAUGES, NO_DISPATCH, OVERLOADED_TOP_TEXT, SAMPLE_SWAP_TEXT } from "./fixtures.js";

describe("renderMachineCapacityLines", () => {
  it("puts the verdict last, after the compressor and swapfile lines", () => {
    const report = buildMachineCapacityReport({
      ...HEALTHY_GAUGES,
      comms: [],
      processes: [],
      swapText: SAMPLE_SWAP_TEXT,
      topText: "Load Avg: 1.0, 1.0, 1.0 \nPID    MEM  \n",
    });
    const lines = renderMachineCapacityLines({ full: true, report });
    expect(lines).toEqual([
      `load avg: 1 1 1 (1-min hold at ${String(DEFAULT_LOAD_HOLD)})`,
      "swap: 6.2/4 GB",
      `compressor: 182761/1234946 segments (15%, hold at ${String(DEFAULT_SEGMENTS_HOLD_PCT)}%)`,
      `swapfiles: 3 (hold at ${String(DEFAULT_SWAPFILE_HOLD_COUNT)})`,
      report.verdict,
    ]);
  });

  it("counts the ranked processes on one line by default, keeping every gauge and the verdict last", () => {
    const report = buildMachineCapacityReport({ ...ENDPOINT_READING });
    expect(renderMachineCapacityLines({ full: false, report })).toEqual([
      `load avg: 8.38 8.76 10.23 (1-min hold at ${String(DEFAULT_LOAD_HOLD)})`,
      `compressor: 182761/1234946 segments (15%, hold at ${String(DEFAULT_SEGMENTS_HOLD_PCT)}%)`,
      `swapfiles: 3 (hold at ${String(DEFAULT_SWAPFILE_HOLD_COUNT)})`,
      "cpu: 64.35% idle, 5.3 cores busy, 2.6 visible per process, 2.8 unattributed",
      "hidden from top (rss 0, absent from its table): com.example.endpoint.Agent, ScanService, PredictService, Endpoint Notifications",
      "processes: 1 ranked · fleet: 0 live session(s) (--full lists them with the fleet's load; --json carries every field)",
      report.verdict,
    ]);
  });

  it("counts the fleet's live sessions by default and keeps every orphan group on its own line", () => {
    const base = buildMachineCapacityReport({ ...ENDPOINT_READING });
    const session = {
      bootsInFlight: 0,
      cpuPct: 12,
      hookStallScript: undefined,
      hookStallSeconds: undefined,
      nonHookProcessCount: 3,
      parallelToolCalls: 1,
      pid: 500,
      processCount: 3,
      sessionId: "s-1",
      toolShellsInFlight: 1,
      tree: [],
    };
    const report = {
      ...base,
      fleet: {
        ...base.fleet,
        orphans: [
          {
            cpuPct: 40,
            oldestSeconds: 600,
            pids: [901, 902],
            seatLive: false,
            snapshot: "/home/x/.claude/shell-snapshots/snapshot-zsh-dead.sh",
            tree: [],
          },
        ],
        sessions: Array.from({ length: 6 }, (_, index) => ({ ...session, sessionId: `s-${String(index + 1)}` })),
      },
    };
    expect(renderMachineCapacityLines({ full: false, report }).slice(-3)).toEqual([
      "processes: 1 ranked · fleet: 6 live session(s) (--full lists them with the fleet's load; --json carries every field)",
      "      40% cpu  ORPHANS 2 shell(s) from seat zsh-dead — slopweaver machine reap",
      report.verdict,
    ]);
    const sessionLines = renderMachineCapacityLines({ full: true, report }).filter((line) =>
      line.includes("session s-"),
    );
    expect(sessionLines).toEqual(
      [1, 2, 3, 4, 5, 6].map(
        (n) => `      12% cpu  session s-${String(n)} (pid 500) · 3 procs · 1 in flight · 0 boots · no hook running`,
      ),
    );
  });

  it("prints the cpu residual and every hidden process on their own lines when a process hid from top", () => {
    const report = buildMachineCapacityReport({ ...ENDPOINT_READING });
    expect(renderMachineCapacityLines({ full: true, report })).toEqual([
      `load avg: 8.38 8.76 10.23 (1-min hold at ${String(DEFAULT_LOAD_HOLD)})`,
      `compressor: 182761/1234946 segments (15%, hold at ${String(DEFAULT_SEGMENTS_HOLD_PCT)}%)`,
      `swapfiles: 3 (hold at ${String(DEFAULT_SWAPFILE_HOLD_COUNT)})`,
      "cpu: 64.35% idle, 5.3 cores busy, 2.6 visible per process, 2.8 unattributed",
      "hidden from top (rss 0, absent from its table): com.example.endpoint.Agent, ScanService, PredictService, Endpoint Notifications",
      "       6 GB  foreign  com.apple.Virtualization.VirtualMachine (pid 100)",
      report.verdict,
    ]);
    expect(machineCapacityJson({ dispatch: NO_DISPATCH, report }).hiddenCpu).toEqual({
      busyCores: 5.3,
      hiddenFromTop: ["com.example.endpoint.Agent", "ScanService", "PredictService", "Endpoint Notifications"],
      idlePct: 64.35,
      unattributedCores: 2.8,
      visibleCores: 2.6,
    });
  });

  it("grades a reading identically with and without a hidden process, so the clause changes words and nothing else", () => {
    // The endpoint-sensor sample reads 64% idle, which clears a load hold; the busy variant reads 5% so the load still holds.
    const cpuSampleText = TWO_SAMPLE_TOP_CPU_TEXT.replace(
      "CPU usage: 25.47% user, 10.17% sys, 64.35% idle ",
      "CPU usage: 80.00% user, 15.00% sys, 5.00% idle ",
    );
    const hidden = buildMachineCapacityReport({ ...ENDPOINT_READING, cpuSampleText, topText: OVERLOADED_TOP_TEXT });
    const plain = buildMachineCapacityReport({
      ...ENDPOINT_READING,
      cpuSampleText,
      statRows: [],
      topText: OVERLOADED_TOP_TEXT,
    });
    const graded = ({ alert, fleetChildAlert, graded: subjects, hold, holdSubjects }: typeof hidden): unknown => ({
      alert,
      fleetChildAlert,
      hold,
      holdSubjects,
      subjects,
    });
    expect(graded(hidden)).toEqual(graded(plain));
    expect(hidden.hold).toBe(true);
    expect(plain.verdict).toBe(
      "machine capacity: HOLD on cpu (1-min load 46.5, hold at 45, 5% idle, under the 20% floor) — 1-min load 46.5 · 5% idle · no foreign process observed · swap unmeasured · compressor 15% of segments limit · 3 swapfiles",
    );
    expect(hidden.verdict).toBe(
      "machine capacity: HOLD on cpu (1-min load 46.5, hold at 45, 5% idle, under the 20% floor) — 1-min load 46.5 · 5% idle · no foreign process observed · hidden from top: 'com.example.endpoint.Agent' +3 more, 11.7 cores of cpu unattributed · swap unmeasured · compressor 15% of segments limit · 3 swapfiles",
    );
  });
});
