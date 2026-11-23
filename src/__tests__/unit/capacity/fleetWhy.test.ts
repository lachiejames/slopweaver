import { describe, expect, it } from "vitest";

import { type FleetWhyCeiling, FleetWhyErrors, measureFleetWhy } from "../../../capacity/fleetWhy.js";
import { renderFleetWhyLines } from "../../../capacity/fleetWhyRender.js";
import type { FleetWhyMachineSample, FleetWhySource } from "../../../capacity/fleetWhyWindow.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";

/** One machine sample, quiet unless a case says otherwise. */
function sample(over: Partial<FleetWhyMachineSample> = {}): FleetWhyMachineSample {
  return {
    busyCores: 8,
    fleetCpuPct: 250,
    foreignHogs: [],
    hiddenFromTop: [],
    hold: false,
    holdSubjects: [],
    load1: 12,
    loadHold: 22,
    unattributedCores: 2,
    ...over,
  };
}

/** A source stamped by `by` at `observedAtIso`. */
function source<T>({
  value,
  observedAtIso,
  by = "tick-27",
}: {
  value: T;
  observedAtIso: string;
  by?: string;
}): FleetWhySource<T> {
  return { by, observedAtIso, value };
}

/** The quiet reading: no hold, Chrome in two processes, WindowServer, the endpoint sensor hidden from top. */
const QUIET = source({
  observedAtIso: "2026-10-09T14:10:00.000Z",
  value: sample({
    foreignHogs: [
      { cpuPct: 50, label: "Google Chrome" },
      { cpuPct: 20, label: "Google Chrome" },
      { cpuPct: 40, label: "WindowServer" },
    ],
    hiddenFromTop: ["com.example.endpoint.Agent"],
  }),
});

/** The held reading: held on cpu at a load of 26.61, mds hidden beside the endpoint sensor. */
const HELD = source({
  observedAtIso: "2026-10-09T14:40:00.000Z",
  value: sample({
    busyCores: 9.5,
    fleetCpuPct: 270,
    foreignHogs: [{ cpuPct: 60, label: "WindowServer" }],
    hiddenFromTop: ["com.example.endpoint.Agent", "mds"],
    hold: true,
    holdSubjects: ["cpu"],
    load1: 26.61,
    unattributedCores: 5,
  }),
});

/** Four seats, from a burn of 1/256 of a plan's week per working seat-hour against 1/64 remaining per hour. */
const MEASURED: FleetWhyCeiling = {
  burnPerWorkingSeatHour: 0.00390625,
  kind: "measured",
  seats: 4,
  sustainablePlanWeeksPerHour: 0.015625,
};

/** The measured hour, every source from one tick, `over` replacing any of them. */
function measure(over: Partial<Parameters<typeof measureFleetWhy>[0]> = {}) {
  return measureFleetWhy({
    ceiling: source({ observedAtIso: "2026-10-09T14:40:00.000Z", value: MEASURED }),
    latestMachine: HELD,
    machineReadings: [QUIET, HELD],
    minutes: 60,
    nowIso: "2026-10-09T15:00:00.000Z",
    problems: [],
    workingSeats: source({ observedAtIso: "2026-10-09T14:40:00.000Z", value: { working: 5 } }),
    ...over,
  });
}

describe("measureFleetWhy", () => {
  it("summarises the window's sampled readings", () => {
    expect(unwrap(measure()).window).toEqual({
      busyCores: { last: 9.5, max: 9.5, mean: 8.8, min: 8 },
      firstObservedAtIso: "2026-10-09T14:10:00.000Z",
      fleetCpuPct: { last: 270, max: 270, mean: 260, min: 250 },
      fromIso: "2026-10-09T14:00:00.000Z",
      heldReadings: 1,
      heldSubjects: [{ readings: 1, subject: "cpu" }],
      hiddenFromTop: [
        { label: "com.example.endpoint.Agent", readings: 2 },
        { label: "mds", readings: 1 },
      ],
      lastObservedAtIso: "2026-10-09T14:40:00.000Z",
      load1: { last: 26.61, max: 26.61, mean: 19.3, min: 12 },
      loadHold: 22,
      readings: 2,
      toIso: "2026-10-09T15:00:00.000Z",
      topForeign: [
        { label: "WindowServer", meanCapturedCpuPct: 50, readingsSeen: 2 },
        { label: "Google Chrome", meanCapturedCpuPct: 35, readingsSeen: 1 },
      ],
      unattributedCores: { last: 5, max: 5, mean: 3.5, min: 2 },
      widestGapSeconds: 1800,
    });
  });

  it("summarises the same window whatever order the ledger handed its readings over in", () => {
    expect(unwrap(measure({ machineReadings: [HELD, QUIET] })).window).toEqual(unwrap(measure()).window);
  });

  it("ranks the foreign processes on their unrounded mean, so two that print alike keep their order", () => {
    const hogs = [
      { cpuPct: 3, label: "bravo" },
      { cpuPct: 2, label: "charlie" },
      { cpuPct: 1.04, label: "zulu" },
      { cpuPct: 1.03, label: "alpha" },
    ];
    const one = source({ observedAtIso: "2026-10-09T14:30:00.000Z", value: sample({ foreignHogs: hogs }) });
    const report = unwrap(measure({ machineReadings: [one] }));
    expect(report.window.topForeign.map((hog) => hog.label)).toEqual(["bravo", "charlie", "zulu"]);
  });

  it("summarises two readings at one instant the same whichever arrived first", () => {
    const at = "2026-10-09T14:30:00.000Z";
    const high = source({ observedAtIso: at, value: sample({ busyCores: 1, load1: 30, loadHold: 40 }) });
    const low = source({ observedAtIso: at, value: sample({ busyCores: 2, load1: 30, loadHold: 20 }) });
    const forward = unwrap(measure({ machineReadings: [high, low] })).window;
    const reversed = unwrap(measure({ machineReadings: [low, high] })).window;
    expect([reversed.loadHold, reversed.busyCores]).toEqual([forward.loadHold, forward.busyCores]);
  });

  it("reads both the plans and the machine as binding when the seats reach the ceiling on a held tick", () => {
    const report = unwrap(measure());
    expect(report.binding).toBe("both");
    expect(report.unknownBecause).toBe(null);
    expect(report.current).toEqual({
      ceilingSeats: 4,
      hold: true,
      holdSubjects: ["cpu"],
      machineObservedAtIso: "2026-10-09T14:40:00.000Z",
      tick: "tick-27",
      working: 5,
    });
    expect(report.plans).toEqual({
      burnPerWorkingSeatDay: 0.09375,
      ceilingSeats: 4,
      kind: "measured",
      sustainableWorkingSeats: 4,
      tenSeatSpendMultiple: 2.5,
    });
    expect(report.sentences).toEqual([
      "5 working seats, above the 4 the plans' week carries, and the latest tick also held new seats on cpu. A working seat spends about 9% of a plan's week a day; ten would spend the plans 2.5× as fast as they reset.",
      "1 of 2 sampled machine readings held in the last 60 min, on cpu; 1-minute load peaked at 26.61 against the hold at 22, 9.5 cores busy at the most.",
      "The seats and their tools used 2.6 cores on average; the heaviest other processes were WindowServer 50%, Google Chrome 35%; 3.5 cores went unattributed, while com.example.endpoint.Agent and 1 more ran hidden from top.",
    ]);
  });

  it("reads the plans alone as binding when the seats fill the ceiling on an unheld tick", () => {
    const report = unwrap(measure({ latestMachine: QUIET, machineReadings: [QUIET] }));
    expect(report.binding).toBe("plans");
    expect(report.sentences[0]).toBe(
      "5 working seats, above the 4 the plans' week carries, and the latest tick did not hold the machine. A working seat spends about 9% of a plan's week a day; ten would spend the plans 2.5× as fast as they reset.",
    );
    expect(report.sentences[1]).toBe(
      "The one sampled machine reading in the last 60 min did not hold; 1-minute load peaked at 12 against the hold at 22, 8 cores busy at the most.",
    );
  });

  it("sets the peak load against the hold its own reading carried, never another reading's", () => {
    const peak = source({ observedAtIso: "2026-10-09T14:10:00.000Z", value: sample({ load1: 30, loadHold: 40 }) });
    const report = unwrap(measure({ machineReadings: [peak, HELD] }));
    expect([report.window.load1!.max, report.window.loadHold]).toEqual([30, 40]);
    expect(report.sentences[1]).toContain("1-minute load peaked at 30 against the hold at 40");
  });

  it("says which sampled readings held, in every count", () => {
    const held = unwrap(measure({ machineReadings: [HELD] }));
    expect(held.sentences[1]).toBe(
      "The one sampled machine reading in the last 60 min held, on cpu; 1-minute load peaked at 26.61 against the hold at 22, 9.5 cores busy at the most.",
    );
    const quiet = unwrap(measure({ machineReadings: [QUIET, QUIET] }));
    expect(quiet.sentences[1]).toBe(
      "None of 2 sampled machine readings held in the last 60 min; 1-minute load peaked at 12 against the hold at 22, 8 cores busy at the most.",
    );
  });

  it("reads the machine alone as binding, and the seats the plans would still carry, under the ceiling", () => {
    const report = unwrap(
      measure({ workingSeats: source({ observedAtIso: "2026-10-09T14:40:00.000Z", value: { working: 2 } }) }),
    );
    expect(report.binding).toBe("machine");
    expect(report.sentences[0]).toBe(
      "The latest tick held new seats on cpu; the plans' week would carry 2 more than the 2 working.",
    );
  });

  it("reads neither as binding when the seats are under the ceiling on an unheld tick", () => {
    const report = unwrap(
      measure({
        latestMachine: QUIET,
        workingSeats: source({ observedAtIso: "2026-10-09T14:40:00.000Z", value: { working: 3 } }),
      }),
    );
    expect(report.binding).toBe("neither");
    expect(report.sentences[0]).toBe(
      "1 more working seat fits the plans' week than the 3 working, and the latest tick did not hold the machine.",
    );
  });

  it("names an unmeasured ceiling as why the binding is unknown on an unheld tick", () => {
    const report = unwrap(
      measure({
        ceiling: source({
          observedAtIso: "2026-10-09T14:40:00.000Z",
          value: { kind: "unmeasurable", reason: "no seat worked this week" },
        }),
        latestMachine: QUIET,
      }),
    );
    expect(report.binding).toBe("unknown");
    expect(report.plans).toEqual({ kind: "unmeasurable", reason: "no seat worked this week" });
    expect(report.unknownBecause).toBe(
      "how many working seats the plans carry is not measured: no seat worked this week",
    );
    expect(report.sentences[0]).toBe(
      "How many working seats the plans carry is not measured: no seat worked this week.",
    );
  });

  it("reads the machine as binding on a held tick even when the ceiling is unmeasured", () => {
    const report = unwrap(
      measure({
        ceiling: source({
          observedAtIso: "2026-10-09T14:40:00.000Z",
          value: { kind: "unmeasurable", reason: "no seat worked this week" },
        }),
      }),
    );
    expect(report.binding).toBe("machine");
    expect(report.sentences[0]).toBe(
      "The latest tick held new seats on cpu, and how many the plans carry is not measured.",
    );
  });

  it("refuses to call a ratio of a zero rate measured", () => {
    const report = unwrap(
      measure({
        ceiling: source({
          observedAtIso: "2026-10-09T14:40:00.000Z",
          value: { ...MEASURED, sustainablePlanWeeksPerHour: 0 },
        }),
      }),
    );
    expect(report.plans).toEqual({
      kind: "unmeasurable",
      reason: "the plans' remaining rate or the burn per working seat measured zero, so no ratio of them is real",
    });
  });

  it("will not judge three readings from different ticks as one", () => {
    const report = unwrap(
      measure({ ceiling: source({ by: "tick-26", observedAtIso: "2026-10-09T14:10:00.000Z", value: MEASURED }) }),
    );
    const because =
      "the latest machine, ceiling and seat readings came from different ticks (tick-27 at 2026-10-09T14:40:00.000Z, tick-26 at 2026-10-09T14:10:00.000Z, tick-27 at 2026-10-09T14:40:00.000Z), so what binds the fleet is not known";
    expect(report.binding).toBe("unknown");
    expect(report.current.tick).toBe(null);
    expect(report.unknownBecause).toBe(because);
    expect(report.problems).toEqual([because]);
    expect(report.sentences[0]).toBe(`T${because.slice(1)}.`);
  });

  it("will not judge a latest machine reading older than the window as now", () => {
    const stale = source({ observedAtIso: "2026-10-09T13:00:00.000Z", value: HELD.value });
    const report = unwrap(measure({ latestMachine: stale, machineReadings: [] }));
    expect(report.binding).toBe("unknown");
    expect(report.unknownBecause).toBe(
      "the latest machine capacity reading (2026-10-09T13:00:00.000Z) is older than the window, so what binds the fleet now is not known",
    );
  });

  it("will not judge a latest machine reading that claims an instant after the window ends", () => {
    const future = source({ observedAtIso: "2026-10-09T15:05:00.000Z", value: QUIET.value });
    const report = unwrap(measure({ latestMachine: future }));
    expect(report.binding).toBe("unknown");
    expect(report.unknownBecause).toBe(
      "the latest machine capacity reading (2026-10-09T15:05:00.000Z) claims an instant after the window ends, so what binds the fleet then is not known",
    );
  });

  it("names every missing source, and says the empty window measured nothing", () => {
    const report = unwrap(
      measure({
        ceiling: undefined,
        latestMachine: undefined,
        machineReadings: [],
        problems: ["the latest machine capacity reading (r-9) will not decode: load.load1: Required"],
        workingSeats: undefined,
      }),
    );
    const because =
      "no usable machine capacity, fleet ceiling, session watch reading, so what binds the fleet is not known";
    expect(report.plans).toEqual({ kind: "absent" });
    expect(report.problems).toEqual([
      "the latest machine capacity reading (r-9) will not decode: load.load1: Required",
      because,
    ]);
    expect(report.window.widestGapSeconds).toBe(null);
    expect(report.sentences).toEqual([
      "No usable machine capacity, fleet ceiling, session watch reading, so what binds the fleet is not known: the latest machine capacity reading (r-9) will not decode: load.load1: Required.",
      "No machine capacity reading landed in the last 60 min, so what the machine measured is not known.",
    ]);
  });

  it("refuses a window that is not a whole number of minutes to an instant", () => {
    expect(unwrapErr(measure({ minutes: 0 }))).toEqual(
      FleetWhyErrors.invalidWindow({ minutes: 0, nowIso: "2026-10-09T15:00:00.000Z" }),
    );
    const notAnInstant = unwrapErr(measure({ nowIso: "now" }));
    expect([notAnInstant.code, notAnInstant.message]).toEqual([
      "INVALID_WINDOW",
      "the window 60 minutes to now is not a whole number of minutes to an instant",
    ]);
  });
});

describe("renderFleetWhyLines", () => {
  it("prints the sentences, the binding with its tick and window, then each problem", () => {
    const report = unwrap(measure({ problems: ["reading r-1 will not decode"] }));
    expect(renderFleetWhyLines({ report }).slice(3)).toEqual([
      "binding: both (tick-27) · window 2026-10-09T14:00:00.000Z → 2026-10-09T15:00:00.000Z",
      "problem: reading r-1 will not decode",
    ]);
  });
});
