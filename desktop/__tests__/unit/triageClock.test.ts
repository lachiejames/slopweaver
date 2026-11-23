/**
 * Rapid triage in the menu bar: the report is parsed exactly, the countdown reads as you would say it, the menu offers
 * only what the pass can do now, and a note's press is taken only when it is one and fresh.
 */
import { describe, expect, it } from "vitest";

import {
  parseTriageClockReport,
  parseTriageCommand,
  TRIAGE_OFF,
  triageCommandFile,
  triageMenuItems,
  triagePathsOf,
  triageProjectionText,
  triageTicking,
  triageTitle,
} from "../../src/triageClock";

const RUNNING = { deadlineMs: 1_120_000, on: true, phase: "running" } as const;
const PRESS = "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d";

describe("parseTriageClockReport", () => {
  it("takes a running clock with its deadline", () => {
    expect(parseTriageClockReport({ value: { ...RUNNING } })).toEqual(RUNNING);
  });

  it("takes off, paused and between", () => {
    expect([
      parseTriageClockReport({ value: { on: false } }),
      parseTriageClockReport({ value: { on: true, phase: "paused" } }),
      parseTriageClockReport({ value: { on: true, phase: "between" } }),
    ]).toEqual([TRIAGE_OFF, { on: true, phase: "paused" }, { on: true, phase: "between" }]);
  });

  it("refuses a report with any other key", () => {
    expect(parseTriageClockReport({ value: { on: false, phase: "paused" } })).toBeUndefined();
  });

  it("refuses a running clock with no whole, positive deadline", () => {
    expect([
      parseTriageClockReport({ value: { on: true, phase: "running" } }),
      parseTriageClockReport({ value: { deadlineMs: 1.5, on: true, phase: "running" } }),
      parseTriageClockReport({ value: { deadlineMs: -1, on: true, phase: "running" } }),
      parseTriageClockReport({ value: { deadlineMs: "1120000", on: true, phase: "running" } }),
    ]).toEqual([undefined, undefined, undefined, undefined]);
  });

  it("refuses a deadline on a paused clock and anything that is not a record", () => {
    expect([
      parseTriageClockReport({ value: { deadlineMs: 1_120_000, on: true, phase: "paused" } }),
      parseTriageClockReport({ value: "on" }),
      parseTriageClockReport({ value: null }),
    ]).toEqual([undefined, undefined, undefined]);
  });
});

describe("parseTriageCommand", () => {
  it("takes the four commands and nothing else", () => {
    expect(["start", "pause", "resume", "off", "stop", 1].map((value) => parseTriageCommand({ value }))).toEqual([
      "start",
      "pause",
      "resume",
      "off",
      undefined,
      undefined,
    ]);
  });
});

describe("triageTitle", () => {
  it("shows two minutes as the card is presented", () => {
    expect(triageTitle({ nowMs: 1_000_000, report: RUNNING })).toBe("2:00");
  });

  it("rounds up, so a part second still left never reads as zero", () => {
    expect(triageTitle({ nowMs: 1_119_001, report: RUNNING })).toBe("0:01");
  });

  it("pads the seconds", () => {
    expect(triageTitle({ nowMs: 1_065_000, report: RUNNING })).toBe("0:55");
  });

  it("says time is up at the deadline and after it, never a stuck 0:00", () => {
    expect([
      triageTitle({ nowMs: 1_120_000, report: RUNNING }),
      triageTitle({ nowMs: 1_500_000, report: RUNNING }),
    ]).toEqual(["Time up", "Time up"]);
  });

  it("names paused and between, and draws nothing while off", () => {
    expect([
      triageTitle({ nowMs: 0, report: { on: true, phase: "paused" } }),
      triageTitle({ nowMs: 0, report: { on: true, phase: "between" } }),
      triageTitle({ nowMs: 0, report: TRIAGE_OFF }),
    ]).toEqual(["Paused", "Triage", ""]);
  });
});

describe("triageTicking", () => {
  it("ticks only while a running clock has time left", () => {
    expect([
      triageTicking({ nowMs: 1_000_000, report: RUNNING }),
      triageTicking({ nowMs: 1_120_000, report: RUNNING }),
      triageTicking({ nowMs: 0, report: { on: true, phase: "paused" } }),
      triageTicking({ nowMs: 0, report: TRIAGE_OFF }),
    ]).toEqual([true, false, false, false]);
  });
});

describe("triageMenuItems", () => {
  it("offers only Start triage while off", () => {
    expect(triageMenuItems({ report: TRIAGE_OFF })).toEqual([{ command: "start", label: "Start triage" }]);
  });

  it("offers pause and the way out while the clock runs or you are between cards", () => {
    const expected = [
      { command: "pause", label: "Pause timer" },
      { command: "off", label: "Turn triage off" },
    ];
    expect([triageMenuItems({ report: RUNNING }), triageMenuItems({ report: { on: true, phase: "between" } })]).toEqual(
      [expected, expected],
    );
  });

  it("offers resume while paused", () => {
    expect(triageMenuItems({ report: { on: true, phase: "paused" } })).toEqual([
      { command: "resume", label: "Resume timer" },
      { command: "off", label: "Turn triage off" },
    ]);
  });
});

describe("triagePathsOf", () => {
  it("puts the files under the home the console reads", () => {
    expect(triagePathsOf({ envHome: "/tmp/sw-home", userHome: "/Users/someone" })).toEqual({
      commands: "/tmp/sw-home/hand-steps/triage/commands",
      dir: "/tmp/sw-home/hand-steps/triage",
      state: "/tmp/sw-home/hand-steps/triage/state.json",
    });
  });

  it("falls to ~/.slopweaver when the home is unset or blank", () => {
    expect([
      triagePathsOf({ envHome: undefined, userHome: "/Users/someone" }).state,
      triagePathsOf({ envHome: "  ", userHome: "/Users/someone" }).state,
    ]).toEqual([
      "/Users/someone/.slopweaver/hand-steps/triage/state.json",
      "/Users/someone/.slopweaver/hand-steps/triage/state.json",
    ]);
  });
});

describe("triageProjectionText", () => {
  it("writes on, paused and the instant, one line", () => {
    expect([
      triageProjectionText({ nowMs: 5, report: RUNNING }),
      triageProjectionText({ nowMs: 6, report: { on: true, phase: "paused" } }),
      triageProjectionText({ nowMs: 7, report: TRIAGE_OFF }),
    ]).toEqual([
      '{"on":true,"paused":false,"writtenMs":5}\n',
      '{"on":true,"paused":true,"writtenMs":6}\n',
      '{"on":false,"paused":false,"writtenMs":7}\n',
    ]);
  });
});

describe("triageCommandFile", () => {
  it("takes a fresh press a note may send", () => {
    expect([
      triageCommandFile({ name: `1700000000000-${PRESS}.pause`, nowMs: 1_700_000_001_000 }),
      triageCommandFile({ name: `1700000000000-${PRESS}.resume`, nowMs: 1_700_000_001_000 }),
      triageCommandFile({ name: `1700000000000-${PRESS}.off`, nowMs: 1_700_000_001_000 }),
    ]).toEqual(["pause", "resume", "off"]);
  });

  it("refuses start, which only the menu bar and the voice may send", () => {
    expect(triageCommandFile({ name: `1700000000000-${PRESS}.start`, nowMs: 1_700_000_001_000 })).toBeUndefined();
  });

  it("refuses a press older than ten seconds", () => {
    expect(triageCommandFile({ name: `1700000000000-${PRESS}.off`, nowMs: 1_700_000_010_001 })).toBeUndefined();
  });

  it("refuses a name that is not exactly a press", () => {
    expect([
      triageCommandFile({ name: `1700000000000-${PRESS}.off.tmp`, nowMs: 1_700_000_000_000 }),
      triageCommandFile({ name: `170000000000-${PRESS}.off`, nowMs: 1_700_000_000_000 }),
      triageCommandFile({ name: "../state.json", nowMs: 1_700_000_000_000 }),
    ]).toEqual([undefined, undefined, undefined]);
  });
});
