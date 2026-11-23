/*
 * The `machine series --json` reader: a window read exactly, and any sample that will not read refusing the whole
 * window rather than charting a gap as if it were measured.
 */
import { describe, expect, it } from "vitest";

import { readMachineSeries } from "../../components/live/readMachineSeries";

/** One sample as the verb prints it. */
function sample({
  observedAtIso,
  load1,
  cpu = { fleetPct: 317, otherPct: 260.4 },
}: {
  observedAtIso: string;
  load1: number;
  cpu?: Record<string, unknown>;
}): Record<string, unknown> {
  return {
    cores: 15,
    cpu,
    load: { holdAt: 22, load1 },
    memory: {
      compressorSegmentsPct: 15,
      swapTotalGb: 3,
      swapUsedGb: 1.7,
      totalBytes: 50_234_130_432,
      usedBytes: 45_097_156_608,
    },
    observedAtIso,
    sessions: [{ cpuPct: 37, memoryBytes: 1_199_751_168, processCount: 10, sessionId: "25e87475" }],
    topOtherCpu: [{ cpuPct: 43.1, label: "mds", memoryBytes: 1_127_219_200, processCount: 1 }],
    topOtherMemory: [{ cpuPct: 8.2, label: "Google Chrome Helper", memoryBytes: 2_286_944_256, processCount: 28 }],
  };
}

/** A window as the verb prints one: two samples, held since the second. */
const DOCUMENT = {
  currentLoadHold: { kind: "since", startedAtIso: "2026-10-17T20:44:30.000Z" },
  minimumSampleGapSeconds: 30,
  observedAtIso: "2026-10-17T20:44:30.000Z",
  samples: [
    sample({ load1: 18, observedAtIso: "2026-10-17T20:44:00.000Z" }),
    sample({ load1: 23.88, observedAtIso: "2026-10-17T20:44:30.000Z" }),
  ],
  windowSeconds: 3600,
};

describe("readMachineSeries", () => {
  it("reads the whole window", () => {
    const series = readMachineSeries(DOCUMENT)!;
    expect(series.observedAtIso).toBe("2026-10-17T20:44:30.000Z");
    expect(series.currentLoadHold).toEqual({ kind: "since", startedAtIso: "2026-10-17T20:44:30.000Z" });
    expect(series.samples.map((one) => one.load.load1)).toEqual([18, 23.88]);
    expect(series.samples[1].sessions).toEqual([
      { cpuPct: 37, memoryBytes: 1_199_751_168, processCount: 10, sessionId: "25e87475" },
    ]);
    expect(series.samples[1].topOtherMemory[0].processCount).toBe(28);
  });

  it("reads a sample's optional idle percentage, and a sample without one as having none", () => {
    const withIdle = sample({
      cpu: { fleetPct: 317, idlePct: 40.5, otherPct: 260.4 },
      load1: 23.88,
      observedAtIso: "2026-10-17T20:44:30.000Z",
    });
    // 23.88 is over the hold of 22, but 40.5% idle clears it, so the window is no longer held.
    const series = readMachineSeries({
      ...DOCUMENT,
      currentLoadHold: { kind: "clear" },
      samples: [DOCUMENT.samples[0], withIdle],
    })!;
    expect(series.samples[1].cpu).toEqual({ fleetPct: 317, idlePct: 40.5, otherPct: 260.4 });
    expect(Object.hasOwn(series.samples[0].cpu, "idlePct")).toBe(false);
    expect(series.samples[0].cpu).toEqual({ fleetPct: 317, otherPct: 260.4 });
  });

  it("refuses a sample whose idle percentage is present but not a percentage", () => {
    // Load 5 is under the hold whatever the idle, so the window is clear and only the idle itself can refuse it.
    const read = ({ idlePct }: { idlePct: unknown }): ReturnType<typeof readMachineSeries> =>
      readMachineSeries({
        ...DOCUMENT,
        currentLoadHold: { kind: "clear" },
        samples: [
          DOCUMENT.samples[0],
          sample({
            cpu: { fleetPct: 317, idlePct, otherPct: 260.4 },
            load1: 5,
            observedAtIso: "2026-10-17T20:44:30.000Z",
          }),
        ],
      });
    expect(read({ idlePct: 100 })).not.toBe(undefined);
    expect([101, -1, "40", null].map((idlePct) => read({ idlePct }))).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
    ]);
  });

  it("calls a load over its hold clear at 50% idle, and refuses it called held, by the verb's own predicate", () => {
    const idle = sample({
      cpu: { fleetPct: 317, idlePct: 50, otherPct: 260.4 },
      load1: 30,
      observedAtIso: "2026-10-17T20:44:30.000Z",
    });
    const clear = { ...DOCUMENT, currentLoadHold: { kind: "clear" }, samples: [DOCUMENT.samples[0], idle] };
    expect(readMachineSeries(clear)!.currentLoadHold).toEqual({ kind: "clear" });
    const held = { ...clear, currentLoadHold: { kind: "since", startedAtIso: "2026-10-17T20:44:30.000Z" } };
    expect(readMachineSeries(held)).toBe(undefined);
  });

  it("refuses a window with one sample missing a figure", () => {
    const broken = { ...sample({ load1: 1, observedAtIso: "2026-10-17T20:44:00.000Z" }), load: { holdAt: 22 } };
    expect(readMachineSeries({ ...DOCUMENT, samples: [broken, DOCUMENT.samples[1]] })).toBe(undefined);
  });

  it("refuses a window whose newest sample is not the document's instant", () => {
    expect(readMachineSeries({ ...DOCUMENT, observedAtIso: "2026-10-17T20:45:00.000Z" })).toBe(undefined);
  });

  it("refuses samples out of order, and an empty window", () => {
    expect(readMachineSeries({ ...DOCUMENT, samples: DOCUMENT.samples.toReversed() })).toBe(undefined);
    expect(readMachineSeries({ ...DOCUMENT, samples: [] })).toBe(undefined);
  });

  it("reads a hold first seen after a gap, and refuses one with no instant", () => {
    const gapped = {
      ...DOCUMENT,
      currentLoadHold: { earliestHeldIso: "2026-10-17T20:44:30.000Z", kind: "after-gap" },
      samples: [sample({ load1: 30, observedAtIso: "2026-10-17T20:40:00.000Z" }), DOCUMENT.samples[1]],
    };
    expect(readMachineSeries(gapped)!.currentLoadHold).toEqual(gapped.currentLoadHold);
    expect(readMachineSeries({ ...gapped, currentLoadHold: { kind: "after-gap" } })).toBe(undefined);
  });

  it("reads a window held throughout as held since at least its oldest sample", () => {
    const allHeld = {
      ...DOCUMENT,
      currentLoadHold: { kind: "before-window", oldestObservedAtIso: "2026-10-17T20:44:00.000Z" },
      samples: [sample({ load1: 25, observedAtIso: "2026-10-17T20:44:00.000Z" }), DOCUMENT.samples[1]],
    };
    expect(readMachineSeries(allHeld)!.currentLoadHold).toEqual(allHeld.currentLoadHold);
  });

  it("refuses a hold the samples do not show: an unseen instant, a clear sample called held, a held one called clear", () => {
    const unseen = "2026-10-17T20:44:10.000Z";
    expect(readMachineSeries({ ...DOCUMENT, currentLoadHold: { kind: "since", startedAtIso: unseen } })).toBe(
      undefined,
    );
    expect(readMachineSeries({ ...DOCUMENT, currentLoadHold: { earliestHeldIso: unseen, kind: "after-gap" } })).toBe(
      undefined,
    );
    const overClear = { kind: "before-window", oldestObservedAtIso: "2026-10-17T20:44:00.000Z" };
    expect(readMachineSeries({ ...DOCUMENT, currentLoadHold: overClear })).toBe(undefined);
    expect(readMachineSeries({ ...DOCUMENT, currentLoadHold: { kind: "clear" } })).toBe(undefined);
  });

  it("refuses a window whose samples disagree on the core count or the hold, which the charts draw from the newest", () => {
    const older = sample({ load1: 18, observedAtIso: "2026-10-17T20:44:00.000Z" });
    const otherHold = { ...older, load: { holdAt: 10, load1: 9 } };
    expect(readMachineSeries({ ...DOCUMENT, samples: [otherHold, DOCUMENT.samples[1]] })).toBe(undefined);
    expect(readMachineSeries({ ...DOCUMENT, samples: [{ ...older, cores: 14 }, DOCUMENT.samples[1]] })).toBe(undefined);
    expect(readMachineSeries({ ...DOCUMENT, samples: [older, DOCUMENT.samples[1]] })!.samples.length).toBe(2);
  });

  it("refuses a hold it does not know, and memory in use over the whole", () => {
    expect(readMachineSeries({ ...DOCUMENT, currentLoadHold: { kind: "maybe" } })).toBe(undefined);
    const over = sample({ load1: 23.88, observedAtIso: "2026-10-17T20:44:30.000Z" });
    const memory = { ...(over["memory"] as Record<string, unknown>), usedBytes: 60_000_000_000 };
    expect(readMachineSeries({ ...DOCUMENT, samples: [DOCUMENT.samples[0], { ...over, memory }] })).toBe(undefined);
  });

  it("reads only the hour the charts label, a gap no wider than it, and samples spanning no more than it", () => {
    expect(readMachineSeries(DOCUMENT)!.windowSeconds).toBe(3600);
    expect(readMachineSeries({ ...DOCUMENT, windowSeconds: 3599 })).toBe(undefined);
    expect(readMachineSeries({ ...DOCUMENT, windowSeconds: 86_400 })).toBe(undefined);
    expect(readMachineSeries({ ...DOCUMENT, windowSeconds: 30 })).toBe(undefined);
    expect(readMachineSeries({ ...DOCUMENT, minimumSampleGapSeconds: 3601 })).toBe(undefined);
    const spread = [sample({ load1: 18, observedAtIso: "2026-10-17T19:44:29.000Z" }), DOCUMENT.samples[1]];
    expect(readMachineSeries({ ...DOCUMENT, samples: spread })).toBe(undefined);
  });
});
