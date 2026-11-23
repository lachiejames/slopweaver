/**
 * `measureUnusedCapacity` — pure. Every case below fixes its own `fromIso`/`toIso` span rather than sharing
 * one across tests, so a failure names its own numbers instead of a shared fixture's.
 */
import { describe, expect, it } from "vitest";
import { type MachineTickSample, measureUnusedCapacity, type PlanWindowSample } from "../../../capacity/unused.js";

const FROM_ISO = "2026-09-21T00:00:00.000Z";
const TO_ISO = "2026-09-28T00:00:00.000Z";

describe("measureUnusedCapacity — plan windows", () => {
  it("measures an expired window as 100 minus the highest reading in its instance, an upper bound", () => {
    const samples: readonly PlanWindowSample[] = [
      {
        ceilingId: "claude:plan-two",
        observedAtIso: "2026-09-21T18:00:00.000Z",
        resetAtIso: "2026-09-22T00:00:00.000Z",
        usedPct: 40,
        window: "five-hour",
      },
      {
        ceilingId: "claude:plan-two",
        observedAtIso: "2026-09-21T19:30:00.000Z",
        resetAtIso: "2026-09-22T00:00:00.000Z",
        usedPct: 55,
        window: "five-hour",
      },
    ];
    const report = measureUnusedCapacity({
      fromIso: FROM_ISO,
      loadHold: 22,
      problems: [],
      samples,
      ticks: [],
      toIso: TO_ISO,
    });
    const [window] = report.windows;
    expect(window!.expiredWindows).toBe(1);
    expect(window!.unusedAtResetPct).toBe(45);
    expect(window!.widestLastReadingToResetSeconds).toBe(16200);
    expect(window!.open).toBe(null);
  });

  it("merges two resets within 15 minutes of each other into one instance", () => {
    const samples: readonly PlanWindowSample[] = [
      {
        ceilingId: "claude:plan-two",
        observedAtIso: "2026-09-21T23:00:00.000Z",
        resetAtIso: "2026-09-22T00:00:00.000Z",
        usedPct: 30,
        window: "five-hour",
      },
      {
        ceilingId: "claude:plan-two",
        observedAtIso: "2026-09-21T23:30:00.000Z",
        resetAtIso: "2026-09-22T00:10:00.000Z",
        usedPct: 50,
        window: "five-hour",
      },
    ];
    const report = measureUnusedCapacity({
      fromIso: FROM_ISO,
      loadHold: 22,
      problems: [],
      samples,
      ticks: [],
      toIso: TO_ISO,
    });
    const [window] = report.windows;
    expect(window!.expiredWindows).toBe(1);
    expect(window!.unusedAtResetPct).toBe(50);
  });

  it("splits two resets more than 15 minutes apart into two instances", () => {
    const samples: readonly PlanWindowSample[] = [
      {
        ceilingId: "claude:plan-two",
        observedAtIso: "2026-09-21T23:00:00.000Z",
        resetAtIso: "2026-09-22T00:00:00.000Z",
        usedPct: 30,
        window: "five-hour",
      },
      {
        ceilingId: "claude:plan-two",
        observedAtIso: "2026-09-21T23:50:00.000Z",
        resetAtIso: "2026-09-22T00:20:00.000Z",
        usedPct: 60,
        window: "five-hour",
      },
    ];
    const report = measureUnusedCapacity({
      fromIso: FROM_ISO,
      loadHold: 22,
      problems: [],
      samples,
      ticks: [],
      toIso: TO_ISO,
    });
    const [window] = report.windows;
    expect(window!.expiredWindows).toBe(2);
    expect(window!.unusedAtResetPct).toBe(55);
    expect(window!.widestLastReadingToResetSeconds).toBe(3600);
  });

  it("reports an instance still open at the span's end with its LATEST reading, not its highest", () => {
    const samples: readonly PlanWindowSample[] = [
      {
        ceilingId: "claude:plan-two",
        observedAtIso: "2026-09-27T10:00:00.000Z",
        resetAtIso: "2026-09-29T00:00:00.000Z",
        usedPct: 30,
        window: "seven-day",
      },
      {
        ceilingId: "claude:plan-two",
        observedAtIso: "2026-09-27T12:00:00.000Z",
        resetAtIso: "2026-09-29T00:00:00.000Z",
        usedPct: 22,
        window: "seven-day",
      },
    ];
    const report = measureUnusedCapacity({
      fromIso: FROM_ISO,
      loadHold: 22,
      problems: [],
      samples,
      ticks: [],
      toIso: TO_ISO,
    });
    const [window] = report.windows;
    expect(window!.open).toEqual({ resetAtIso: "2026-09-29T00:00:00.000Z", usedPct: 22 });
    expect(window!.expiredWindows).toBe(0);
    expect(window!.unusedAtResetPct).toBe(null);
    expect(window!.widestLastReadingToResetSeconds).toBe(null);
  });

  it("excludes a sample observed after toIso", () => {
    const samples: readonly PlanWindowSample[] = [
      {
        ceilingId: "claude:plan-two",
        observedAtIso: "2026-09-25T00:00:00.000Z",
        resetAtIso: "2026-09-29T00:00:00.000Z",
        usedPct: 10,
        window: "weekly",
      },
      {
        ceilingId: "claude:plan-two",
        observedAtIso: "2026-09-28T01:00:00.000Z",
        resetAtIso: "2026-09-29T00:00:00.000Z",
        usedPct: 99,
        window: "weekly",
      },
    ];
    const report = measureUnusedCapacity({
      fromIso: FROM_ISO,
      loadHold: 22,
      problems: [],
      samples,
      ticks: [],
      toIso: TO_ISO,
    });
    const [window] = report.windows;
    expect(window!.samples).toBe(1);
    expect(window!.open).toEqual({ resetAtIso: "2026-09-29T00:00:00.000Z", usedPct: 10 });
  });

  it("excludes a sample whose window reset at or before fromIso", () => {
    const samples: readonly PlanWindowSample[] = [
      {
        ceilingId: "claude:plan-two",
        observedAtIso: "2026-09-22T00:00:00.000Z",
        resetAtIso: "2026-09-23T00:00:00.000Z",
        usedPct: 20,
        window: "five-hour",
      },
      {
        ceilingId: "claude:plan-two",
        observedAtIso: "2026-09-20T00:00:00.000Z",
        resetAtIso: "2026-09-21T00:00:00.000Z",
        usedPct: 5,
        window: "five-hour",
      },
    ];
    const report = measureUnusedCapacity({
      fromIso: FROM_ISO,
      loadHold: 22,
      problems: [],
      samples,
      ticks: [],
      toIso: TO_ISO,
    });
    const [window] = report.windows;
    expect(window!.samples).toBe(1);
    expect(window!.unusedAtResetPct).toBe(80);
  });

  it("counts an unparsable instant in problems and drops it from measurement", () => {
    const samples: readonly PlanWindowSample[] = [
      {
        ceilingId: "claude:plan-two",
        observedAtIso: "2026-09-21T18:00:00.000Z",
        resetAtIso: "2026-09-22T00:00:00.000Z",
        usedPct: 40,
        window: "five-hour",
      },
      {
        ceilingId: "claude:plan-two",
        observedAtIso: "not-a-date",
        resetAtIso: "2026-09-22T00:00:00.000Z",
        usedPct: 90,
        window: "five-hour",
      },
    ];
    const report = measureUnusedCapacity({
      fromIso: FROM_ISO,
      loadHold: 22,
      problems: [],
      samples,
      ticks: [],
      toIso: TO_ISO,
    });
    expect(report.problems).toEqual(["1 reading(s) carried an instant that does not parse, and were not counted"]);
    expect(report.windows[0]!.samples).toBe(1);
  });

  it("reports the widest gap between consecutive readings of one window", () => {
    const samples: readonly PlanWindowSample[] = [
      {
        ceilingId: "claude:plan-two",
        observedAtIso: "2026-09-21T10:00:00.000Z",
        resetAtIso: "2026-09-22T00:00:00.000Z",
        usedPct: 10,
        window: "five-hour",
      },
      {
        ceilingId: "claude:plan-two",
        observedAtIso: "2026-09-21T10:16:40.000Z",
        resetAtIso: "2026-09-22T00:00:00.000Z",
        usedPct: 20,
        window: "five-hour",
      },
      {
        ceilingId: "claude:plan-two",
        observedAtIso: "2026-09-21T11:40:00.000Z",
        resetAtIso: "2026-09-22T00:00:00.000Z",
        usedPct: 30,
        window: "five-hour",
      },
    ];
    const report = measureUnusedCapacity({
      fromIso: FROM_ISO,
      loadHold: 22,
      problems: [],
      samples,
      ticks: [],
      toIso: TO_ISO,
    });
    expect(report.windows[0]!.widestGapSeconds).toBe(5000);
  });

  it("sorts windows by ceilingId then window", () => {
    const samples: readonly PlanWindowSample[] = [
      {
        ceilingId: "codex:default",
        observedAtIso: "2026-09-22T00:00:00.000Z",
        resetAtIso: "2026-09-23T00:00:00.000Z",
        usedPct: 10,
        window: "weekly",
      },
      {
        ceilingId: "claude:plan-two",
        observedAtIso: "2026-09-22T00:00:00.000Z",
        resetAtIso: "2026-09-23T00:00:00.000Z",
        usedPct: 10,
        window: "seven-day",
      },
      {
        ceilingId: "claude:plan-two",
        observedAtIso: "2026-09-22T00:00:00.000Z",
        resetAtIso: "2026-09-23T00:00:00.000Z",
        usedPct: 10,
        window: "five-hour",
      },
    ];
    const report = measureUnusedCapacity({
      fromIso: FROM_ISO,
      loadHold: 22,
      problems: [],
      samples,
      ticks: [],
      toIso: TO_ISO,
    });
    expect(report.windows.map((window) => `${window.ceilingId}\u0000${window.window}`)).toEqual([
      "claude:plan-two\u0000five-hour",
      "claude:plan-two\u0000seven-day",
      "codex:default\u0000weekly",
    ]);
  });
});

describe("measureUnusedCapacity — machine", () => {
  it("counts a held tick as 0 free, whatever its load reads", () => {
    const ticks: readonly MachineTickSample[] = [{ hold: true, load1: 50, observedAtIso: "2026-09-22T00:00:00.000Z" }];
    const report = measureUnusedCapacity({
      fromIso: FROM_ISO,
      loadHold: 22,
      problems: [],
      samples: [],
      ticks,
      toIso: TO_ISO,
    });
    expect(report.machine).toEqual({
      heldPct: 100,
      loadHold: 22,
      meanLoad1: 50,
      ticks: 1,
      unusedLoadPct: 0,
      widestGapSeconds: 0,
    });
  });

  it("measures heldPct, meanLoad1 and unusedLoadPct against the given loadHold", () => {
    const ticks: readonly MachineTickSample[] = [
      { hold: true, load1: 5, observedAtIso: "2026-09-22T00:00:00.000Z" },
      { hold: false, load1: 11, observedAtIso: "2026-09-22T00:10:00.000Z" },
    ];
    const report = measureUnusedCapacity({
      fromIso: FROM_ISO,
      loadHold: 22,
      problems: [],
      samples: [],
      ticks,
      toIso: TO_ISO,
    });
    expect(report.machine.heldPct).toBe(50);
    expect(report.machine.meanLoad1).toBe(8);
    expect(report.machine.unusedLoadPct).toBe(25);
    expect(report.machine.widestGapSeconds).toBe(600);
  });

  it("excludes a tick observed outside the span", () => {
    const ticks: readonly MachineTickSample[] = [
      { hold: false, load1: 11, observedAtIso: "2026-09-22T00:00:00.000Z" },
      { hold: false, load1: 999, observedAtIso: "2026-09-19T00:00:00.000Z" },
      { hold: false, load1: 999, observedAtIso: "2026-09-29T00:00:00.000Z" },
    ];
    const report = measureUnusedCapacity({
      fromIso: FROM_ISO,
      loadHold: 22,
      problems: [],
      samples: [],
      ticks,
      toIso: TO_ISO,
    });
    expect(report.machine.ticks).toBe(1);
    expect(report.machine.meanLoad1).toBe(11);
  });

  it("reports every field null when no tick falls in the span", () => {
    const report = measureUnusedCapacity({
      fromIso: FROM_ISO,
      loadHold: 22,
      problems: [],
      samples: [],
      ticks: [],
      toIso: TO_ISO,
    });
    expect(report.machine).toEqual({
      heldPct: null,
      loadHold: 22,
      meanLoad1: null,
      ticks: 0,
      unusedLoadPct: null,
      widestGapSeconds: null,
    });
  });

  it("carries the readers' own problems through untouched when nothing new goes wrong", () => {
    const report = measureUnusedCapacity({
      fromIso: FROM_ISO,
      loadHold: 22,
      problems: ["codex: the plan register could not be read"],
      samples: [],
      ticks: [],
      toIso: TO_ISO,
    });
    expect(report.problems).toEqual(["codex: the plan register could not be read"]);
  });
});
