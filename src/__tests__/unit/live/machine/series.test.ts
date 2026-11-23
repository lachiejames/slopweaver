/**
 * The pure core of `machine series`: fleet is a whole process tree, a session's figure is its tree, other
 * consumers are named by `comm`, the ring keeps an hour, and the hold's start is read off the ring.
 */
import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../../lib/result.js";
import { buildMachineSeriesSample, type MachineSeriesInputs, UNNAMED_LABEL } from "../../../../live/machine/series.js";
import { parseMachineSeriesTop } from "../../../../live/machine/seriesParse.js";
import {
  currentLoadHoldOf,
  MACHINE_SERIES_MAX_SAMPLES,
  machineSeriesDocument,
  retainMachineSeries,
  sampleFresh,
} from "../../../../live/machine/seriesRing.js";
import {
  COMMS,
  PROCESSES,
  SESSION_ID,
  sampleAt,
  TOP_TEXT,
  TOTAL_MEMORY_BYTES,
  VM_STAT_USED_BYTES,
} from "./seriesFixtures.js";

const MIB = 1024 ** 2;

/**
 * The fixture's inputs, with the session registry overridable.
 *
 * @returns the inputs
 */
function inputs({ registryId = SESSION_ID }: { registryId?: string } = {}): MachineSeriesInputs {
  return {
    comms: COMMS,
    compressor: { compressedPagesPct: 10, segmentsLimit: 1000, segmentsPct: 50, segmentsUsed: 500 },
    cores: 15,
    memoryTotalBytes: TOTAL_MEMORY_BYTES,
    memoryUsedBytes: VM_STAT_USED_BYTES,
    observedAtIso: "2026-10-17T20:00:01.000Z",
    processes: PROCESSES,
    sessions: [{ cwd: "/repo", pid: 100, sessionId: registryId }],
    swap: { totalGb: 4, usedGb: 1.5 },
    top: unwrap(parseMachineSeriesTop({ text: TOP_TEXT })),
  };
}

describe("buildMachineSeriesSample", () => {
  it("counts a cmux child as fleet, sums the session's whole tree, and names others by comm", () => {
    const sample = buildMachineSeriesSample(inputs());
    expect(sample.cpu).toEqual({ fleetPct: 85.5, idlePct: 40, otherPct: 132 });
    expect(sample.load).toEqual({ holdAt: 45, load1: 24.5 });
    expect(sample.memory).toEqual({
      compressorSegmentsPct: 50,
      swapTotalGb: 4,
      swapUsedGb: 1.5,
      totalBytes: TOTAL_MEMORY_BYTES,
      usedBytes: VM_STAT_USED_BYTES,
    });
    expect(sample.sessions).toEqual([{ cpuPct: 80.5, memoryBytes: 300 * MIB, processCount: 2, sessionId: SESSION_ID }]);
    expect(sample.topOtherCpu).toEqual([
      { cpuPct: 120, label: "Trajectory", memoryBytes: 1024 ** 3, processCount: 1 },
      { cpuPct: 10, label: "esbuild", memoryBytes: 2 * MIB, processCount: 1 },
      { cpuPct: 2, label: "kernel_task", memoryBytes: 30 * MIB, processCount: 1 },
    ]);
    expect(sample.topOtherMemory.map((other) => other.label)).toEqual(["Trajectory", "kernel_task", "esbuild"]);
  });

  it("never carries argv into a label, so a flag's token cannot reach the ring", () => {
    const sample = buildMachineSeriesSample(inputs());
    expect(PROCESSES.some((row) => row.argv.includes("--token=secret"))).toBe(true);
    expect(JSON.stringify(sample)).not.toContain("secret");
  });

  it("groups a pid ps printed no comm for under one fixed label, never its argv's first token", () => {
    const sample = buildMachineSeriesSample({
      ...inputs(),
      comms: COMMS.filter((row) => row.pid !== 200),
      processes: PROCESSES.map((row) => (row.pid === 200 ? { ...row, argv: "/tmp/--token=supersecret run" } : row)),
    });
    expect(sample.topOtherCpu[0]).toEqual({
      cpuPct: 120,
      label: UNNAMED_LABEL,
      memoryBytes: 1024 ** 3,
      processCount: 1,
    });
    expect(JSON.stringify(sample)).not.toContain("supersecret");
  });

  it("roots no session on an argv --session-id that is not a whole UUID", () => {
    const sample = buildMachineSeriesSample({
      ...inputs(),
      processes: PROCESSES.map((row) => (row.pid === 200 ? { ...row, argv: "worker --session-id deadbeefcafe" } : row)),
    });
    expect(sample.sessions.map((session) => session.sessionId)).toEqual([SESSION_ID]);
    expect(sample.cpu).toEqual({ fleetPct: 85.5, idlePct: 40, otherPct: 132 });
  });

  it("roots no session on a UUID-shaped prefix of a longer value, nor on two --session-id flags", () => {
    const uuid = "cccccccc-1111-2222-3333-444444444444";
    for (const argv of [
      `worker --session-id ${uuid}g`,
      `worker --session-id=${uuid} --session-id ${uuid}`,
      `worker --session-id ${uuid} --session-id`,
      `worker --session-id`,
    ]) {
      const sample = buildMachineSeriesSample({
        ...inputs(),
        processes: PROCESSES.map((row) => (row.pid === 200 ? { ...row, argv } : row)),
      });
      expect(sample.sessions.map((session) => session.sessionId)).toEqual([SESSION_ID]);
      expect(sample.cpu).toEqual({ fleetPct: 85.5, idlePct: 40, otherPct: 132 });
    }
  });

  it("roots a session on an argv --session-id that is a whole UUID, with = or a space", () => {
    const uuid = "cccccccc-1111-2222-3333-444444444444";
    for (const argv of [`worker --session-id=${uuid}`, `worker --session-id ${uuid} --resume`]) {
      const sample = buildMachineSeriesSample({
        ...inputs(),
        processes: PROCESSES.map((row) => (row.pid === 200 ? { ...row, argv } : row)),
      });
      expect(sample.sessions.map((session) => session.sessionId)).toEqual([SESSION_ID, uuid]);
      expect(sample.cpu).toEqual({ fleetPct: 205.5, idlePct: 40, otherPct: 12 });
    }
  });

  it("sums a descendant however deep it nests under the session", () => {
    const chain = Array.from({ length: 30 }, (_, at) => ({
      argv: "sh",
      pid: 1000 + at,
      ppid: at === 0 ? 100 : 999 + at,
    }));
    const sample = buildMachineSeriesSample({
      ...inputs(),
      processes: [...PROCESSES.map((row) => (row.pid === 300 ? { ...row, ppid: 1029 } : row)), ...chain],
    });
    expect(sample.sessions).toEqual([
      { cpuPct: 90.5, memoryBytes: 300 * MIB + 2 * MIB, processCount: 3, sessionId: SESSION_ID },
    ]);
    expect(sample.cpu).toEqual({ fleetPct: 95.5, idlePct: 40, otherPct: 122 });
  });

  it("gives a session whose argv and registry disagree no row, while its tree still counts as fleet", () => {
    const sample = buildMachineSeriesSample(inputs({ registryId: "bbbbbbbb-1111-2222-3333-444444444444" }));
    expect(sample.sessions).toEqual([]);
    expect(sample.cpu).toEqual({ fleetPct: 85.5, idlePct: 40, otherPct: 132 });
  });

  it("reads pid 1's own roots before it stops climbing, so no pid is skipped as launchd", () => {
    const uuid = "cccccccc-1111-2222-3333-444444444444";
    const sample = buildMachineSeriesSample({
      ...inputs(),
      processes: [{ argv: `claude --session-id ${uuid}`, pid: 1, ppid: 0 }],
      sessions: [],
      top: {
        idlePct: undefined,
        load: { load1: 1, load15: 1, load5: 1 },
        processes: [{ cpuPct: 10, footprintBytes: 100, pid: 1 }],
      },
    });
    expect(sample.sessions).toEqual([{ cpuPct: 10, memoryBytes: 100, processCount: 1, sessionId: uuid }]);
    expect(sample.cpu).toEqual({ fleetPct: 10, otherPct: 0 });
  });

  it("records top's idle percentage on the sample, and the hold at 3 x the cores", () => {
    const sample = buildMachineSeriesSample(inputs());
    expect(sample.cpu.idlePct).toBe(40);
    expect(sample.load.holdAt).toBe(45);
  });
});

describe("retainMachineSeries", () => {
  it("keeps the hour before now, oldest first, dropping older and future rows", () => {
    const kept = retainMachineSeries({
      nowIso: "2026-10-17T20:00:00.000Z",
      samples: [
        sampleAt({ load1: 1, observedAtIso: "2026-10-17T19:30:00.000Z" }),
        sampleAt({ load1: 2, observedAtIso: "2026-10-17T18:59:59.000Z" }),
        sampleAt({ load1: 3, observedAtIso: "2026-10-17T20:00:01.000Z" }),
        sampleAt({ load1: 4, observedAtIso: "2026-10-17T19:00:00.000Z" }),
      ],
    });
    expect(kept.map((sample) => sample.load.load1)).toEqual([4, 1]);
  });

  it("keeps the newest rows when more than the cap fall inside the window", () => {
    const start = Date.parse("2026-10-17T19:30:00.000Z");
    const samples = Array.from({ length: MACHINE_SERIES_MAX_SAMPLES + 5 }, (_, index) =>
      sampleAt({ load1: index, observedAtIso: new Date(start + index * 1000).toISOString() }),
    );
    const kept = retainMachineSeries({ nowIso: "2026-10-17T20:00:00.000Z", samples });
    expect(kept.length).toBe(MACHINE_SERIES_MAX_SAMPLES);
    expect(kept[0]!.load.load1).toBe(5);
  });
});

describe("currentLoadHoldOf", () => {
  it("is clear when the newest sample is under the hold", () => {
    const samples = [
      sampleAt({ load1: 60, observedAtIso: "2026-10-17T19:59:00.000Z" }),
      sampleAt({ load1: 44.9, observedAtIso: "2026-10-17T20:00:00.000Z" }),
    ];
    expect(currentLoadHoldOf({ samples })).toEqual({ kind: "clear" });
  });

  it("is clear for a newest sample over its hold at 50% idle, which top reads as spare capacity", () => {
    const samples = [
      sampleAt({ idlePct: 3, load1: 60, observedAtIso: "2026-10-17T19:59:00.000Z" }),
      sampleAt({ idlePct: 50, load1: 60, observedAtIso: "2026-10-17T20:00:00.000Z" }),
    ];
    expect(currentLoadHoldOf({ samples })).toEqual({ kind: "clear" });
  });

  it("dates a hold from the first sample under the idle floor, not from the first load over the hold", () => {
    const samples = [
      sampleAt({ idlePct: 50, load1: 60, observedAtIso: "2026-10-17T19:59:00.000Z" }),
      sampleAt({ idlePct: 19.9, load1: 60, observedAtIso: "2026-10-17T19:59:30.000Z" }),
      sampleAt({ idlePct: 5, load1: 60, observedAtIso: "2026-10-17T20:00:00.000Z" }),
    ];
    expect(currentLoadHoldOf({ samples })).toEqual({ kind: "since", startedAtIso: "2026-10-17T19:59:30.000Z" });
  });

  it("dates the hold from the first held sample after the last clear one", () => {
    const samples = [
      sampleAt({ load1: 60, observedAtIso: "2026-10-17T19:58:00.000Z" }),
      sampleAt({ load1: 10, observedAtIso: "2026-10-17T19:59:00.000Z" }),
      sampleAt({ load1: 45, observedAtIso: "2026-10-17T19:59:20.000Z" }),
      sampleAt({ load1: 50, observedAtIso: "2026-10-17T20:00:00.000Z" }),
    ];
    expect(currentLoadHoldOf({ samples })).toEqual({ kind: "since", startedAtIso: "2026-10-17T19:59:20.000Z" });
  });

  it("names only the oldest sample kept, never an earlier start, when every sample is held, unbroken", () => {
    const samples = [
      sampleAt({ load1: 60, observedAtIso: "2026-10-17T19:58:00.000Z" }),
      sampleAt({ load1: 50, observedAtIso: "2026-10-17T20:00:00.000Z" }),
    ];
    expect(currentLoadHoldOf({ samples })).toEqual({
      kind: "before-window",
      oldestObservedAtIso: "2026-10-17T19:58:00.000Z",
    });
  });

  it("claims no start across an unsampled gap, held or clear on the far side of it", () => {
    const heldBefore = [
      sampleAt({ load1: 60, observedAtIso: "2026-10-17T19:00:00.000Z" }),
      sampleAt({ load1: 50, observedAtIso: "2026-10-17T20:00:00.000Z" }),
    ];
    expect(currentLoadHoldOf({ samples: heldBefore })).toEqual({
      earliestHeldIso: "2026-10-17T20:00:00.000Z",
      kind: "after-gap",
    });
    const clearBefore = [
      sampleAt({ load1: 10, observedAtIso: "2026-10-17T19:57:59.000Z" }),
      sampleAt({ load1: 50, observedAtIso: "2026-10-17T20:00:00.000Z" }),
      sampleAt({ load1: 52, observedAtIso: "2026-10-17T20:00:30.000Z" }),
    ];
    expect(currentLoadHoldOf({ samples: clearBefore })).toEqual({
      earliestHeldIso: "2026-10-17T20:00:00.000Z",
      kind: "after-gap",
    });
    const joined = [clearBefore[0]!, sampleAt({ load1: 50, observedAtIso: "2026-10-17T19:59:59.000Z" })];
    expect(currentLoadHoldOf({ samples: joined })).toEqual({
      kind: "since",
      startedAtIso: "2026-10-17T19:59:59.000Z",
    });
  });
});

describe("machineSeriesDocument", () => {
  it("stamps the document with its newest sample's instant", () => {
    const samples = [sampleAt({ load1: 1, observedAtIso: "2026-10-17T20:00:00.000Z" })];
    const document = unwrap(machineSeriesDocument({ samples }));
    expect(document.observedAtIso).toBe("2026-10-17T20:00:00.000Z");
    expect(document.windowSeconds).toBe(3600);
    expect(document.minimumSampleGapSeconds).toBe(30);
    expect(document.currentLoadHold).toEqual({ kind: "clear" });
  });

  it("refuses an empty ring", () => {
    expect(unwrapErr(machineSeriesDocument({ samples: [] })).code).toBe("SERIES_EMPTY");
  });
});

describe("sampleFresh", () => {
  const samples = [sampleAt({ load1: 1, observedAtIso: "2026-10-17T20:00:00.000Z" })];

  it("is fresh under the thirty-second gap and due at it", () => {
    expect(sampleFresh({ nowIso: "2026-10-17T20:00:29.999Z", samples })).toBe(true);
    expect(sampleFresh({ nowIso: "2026-10-17T20:00:30.000Z", samples })).toBe(false);
  });

  it("is due for an empty ring", () => {
    expect(sampleFresh({ nowIso: "2026-10-17T20:00:00.000Z", samples: [] })).toBe(false);
  });

  it("stays fresh across a clock stepped back inside the gap, and is due once it stepped back a whole gap", () => {
    expect(sampleFresh({ nowIso: "2026-10-17T19:59:59.000Z", samples })).toBe(true);
    expect(sampleFresh({ nowIso: "2026-10-17T19:59:30.001Z", samples })).toBe(true);
    expect(sampleFresh({ nowIso: "2026-10-17T19:59:30.000Z", samples })).toBe(false);
  });
});
