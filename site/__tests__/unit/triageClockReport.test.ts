import { describe, expect, it } from "vitest";

import { sameTriageClockReport, triageClockReportOf } from "../../lib/triageClockReport";
import type { TriageVisit, TriageWalk } from "../../lib/triageWalkTypes";

const visit = (over: Partial<TriageVisit> = {}): TriageVisit => ({
  arrived: false,
  fingerprint: "words-1",
  key: "ask:pool-exhaustion",
  opened: true,
  presentedMs: 1_000_000,
  rewritten: false,
  ruled: false,
  visitId: "walk-1:1",
  ...over,
});

const walk = (over: Partial<TriageWalk> = {}): TriageWalk => ({
  current: visit(),
  focus: [],
  order: ["ask:pool-exhaustion"],
  out: [],
  paused: false,
  previous: undefined,
  rulings: [],
  settled: [],
  shown: ["ask:pool-exhaustion"],
  stoppedMs: undefined,
  touchedMs: 1_000_000,
  visits: 1,
  walkId: "walk-1",
  ...over,
});

describe("triageClockReportOf", () => {
  it("runs the clock to the deadline the page armed", () => {
    expect(triageClockReportOf({ armedDeadlineMs: 1_120_000, walk: walk() })).toEqual({
      deadlineMs: 1_120_000,
      on: true,
      phase: "running",
    });
  });

  it("runs a briefing's ten minutes to its own deadline", () => {
    expect(triageClockReportOf({ armedDeadlineMs: 1_600_000, walk: walk() })).toEqual({
      deadlineMs: 1_600_000,
      on: true,
      phase: "running",
    });
  });

  it("is off before the first card", () => {
    expect(triageClockReportOf({ armedDeadlineMs: undefined, walk: undefined })).toEqual({ on: false });
  });

  it("is off once the pass is stopped, even with a card in front of the owner", () => {
    expect(triageClockReportOf({ armedDeadlineMs: 1_120_000, walk: walk({ stoppedMs: 1_050_000 }) })).toEqual({
      on: false,
    });
  });

  it("is paused while the owner has paused it, whatever the card", () => {
    expect(triageClockReportOf({ armedDeadlineMs: 1_120_000, walk: walk({ paused: true }) })).toEqual({
      on: true,
      phase: "paused",
    });
  });

  it("is between cards when the page holds no armed timer", () => {
    expect(triageClockReportOf({ armedDeadlineMs: undefined, walk: walk() })).toEqual({ on: true, phase: "between" });
  });

  it("is between cards while the card is still opening", () => {
    expect(
      triageClockReportOf({ armedDeadlineMs: 1_120_000, walk: walk({ current: visit({ opened: false }) }) }),
    ).toEqual({
      on: true,
      phase: "between",
    });
  });

  it("is between cards once the owner has ruled the card", () => {
    expect(
      triageClockReportOf({ armedDeadlineMs: 1_120_000, walk: walk({ current: visit({ ruled: true }) }) }),
    ).toEqual({
      on: true,
      phase: "between",
    });
  });

  it("is between cards when no card is in front of the owner", () => {
    expect(triageClockReportOf({ armedDeadlineMs: 1_120_000, walk: walk({ current: undefined }) })).toEqual({
      on: true,
      phase: "between",
    });
  });
});

describe("sameTriageClockReport", () => {
  it("sends the first report whatever it says", () => {
    expect(sameTriageClockReport({ after: { on: false }, before: undefined })).toBe(false);
  });

  it("holds back an off repeated", () => {
    expect(sameTriageClockReport({ after: { on: false }, before: { on: false } })).toBe(true);
  });

  it("sends off after on", () => {
    expect(sameTriageClockReport({ after: { on: false }, before: { on: true, phase: "paused" } })).toBe(false);
  });

  it("sends a new deadline for the next card", () => {
    expect(
      sameTriageClockReport({
        after: { deadlineMs: 1_240_000, on: true, phase: "running" },
        before: { deadlineMs: 1_120_000, on: true, phase: "running" },
      }),
    ).toBe(false);
  });

  it("holds back the same deadline repeated", () => {
    expect(
      sameTriageClockReport({
        after: { deadlineMs: 1_120_000, on: true, phase: "running" },
        before: { deadlineMs: 1_120_000, on: true, phase: "running" },
      }),
    ).toBe(true);
  });

  it("sends a change of phase", () => {
    expect(
      sameTriageClockReport({
        after: { on: true, phase: "paused" },
        before: { deadlineMs: 1_120_000, on: true, phase: "running" },
      }),
    ).toBe(false);
  });

  it("holds back between cards repeated", () => {
    expect(
      sameTriageClockReport({ after: { on: true, phase: "between" }, before: { on: true, phase: "between" } }),
    ).toBe(true);
  });
});
