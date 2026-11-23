import { describe, expect, it } from "vitest";

import { NO_CALL_EVIDENCE } from "../../../desktop/e2eCallOutcome.js";
import { type E2eStepResult, e2eReport, e2eReportLines, e2eStepLine } from "../../../desktop/e2eReport.js";

const PASSED: E2eStepResult = {
  elapsedMs: 1240,
  screenshot: "/out/01-queue.png",
  step: { id: "queue", kind: "page", path: "/queue", reach: "sidebar" },
  url: "http://localhost:3000/queue",
  verdict: { passed: true },
};

const FAILED: E2eStepResult = {
  elapsedMs: 30_050,
  screenshot: undefined,
  step: { id: "settings", kind: "settings", tab: "opening" },
  url: "http://localhost:3000/queue",
  verdict: { detail: "the settings dialog never appeared", kind: "missing-landmark", passed: false },
};

const EMPTY_QUEUE = "the Queue was empty: every register read and none holds a card, so there was no card to open";

const NOT_APPLICABLE: E2eStepResult = {
  elapsedMs: 210,
  screenshot: "/out/02-queue-card.png",
  step: { id: "queue-card", kind: "queue-card" },
  url: "http://localhost:3000/queue",
  verdict: { detail: EMPTY_QUEUE, kind: "not-applicable", passed: false },
};

const report = e2eReport({
  app: "/Applications/Slopweaver.app",
  checkout: "/c",
  out: "/out",
  fatal: undefined,
  startedIso: "2026-10-25T14:00:00.000Z",
  steps: [PASSED, FAILED],
});

const CALL: E2eStepResult = {
  call: { ...NO_CALL_EVIDENCE, planCallIds: ["plan-1"], transcriptCallIds: ["tx-1"] },
  elapsedMs: 61_000,
  screenshot: "/out/16-call-live.png",
  step: {
    capMs: 90_000,
    cardKey: undefined,
    holdMs: 0,
    id: "call-live",
    kind: "call",
    prompt: "test",
    silenceMs: 20_000,
  },
  url: "http://localhost:3000/voice",
  verdict: { passed: true },
};

describe("e2eReport", () => {
  it("counts passed and failed steps", () => {
    expect([report.passed, report.failed, report.notApplicable]).toEqual([1, 1, 0]);
  });

  it("counts a not-applicable step apart from both a pass and a failure", () => {
    const mixed = e2eReport({ ...report, steps: [PASSED, NOT_APPLICABLE, FAILED] });
    expect([mixed.passed, mixed.failed, mixed.notApplicable]).toEqual([1, 1, 1]);
  });

  it("counts no failure on a walk whose only unpassed step was not applicable", () => {
    const empty = e2eReport({ ...report, steps: [PASSED, NOT_APPLICABLE] });
    expect([empty.passed, empty.failed, empty.notApplicable]).toEqual([1, 0, 1]);
  });

  it("keeps a call's ids in the report, never in its line", () => {
    const called = e2eReport({ ...report, fatal: undefined, steps: [CALL] });
    expect(called.steps[0]!.call!.planCallIds).toEqual(["plan-1"]);
    expect(e2eStepLine({ result: CALL })).toBe("PASS  call-live  61.0s  /out/16-call-live.png");
  });

  it("says why a run stopped early, before the count", () => {
    const stopped = e2eReport({ ...report, fatal: "a test call could not be proven ended", steps: [CALL] });
    expect(e2eReportLines({ report: stopped })).toEqual([
      "PASS  call-live  61.0s  /out/16-call-live.png",
      "STOPPED  a test call could not be proven ended",
      "desktop e2e: 1 of 1 step(s) passed on /Applications/Slopweaver.app — /out",
    ]);
  });
});

describe("e2eReportLines", () => {
  it("prints a line per step with its photograph, then the count", () => {
    expect(e2eReportLines({ report })).toEqual([
      "PASS  queue  1.2s  /out/01-queue.png",
      "FAIL  settings  30.1s  missing-landmark: the settings dialog never appeared  no screenshot",
      "desktop e2e: 1 of 2 step(s) passed on /Applications/Slopweaver.app — /out",
    ]);
  });

  it("prints a not-applicable step as N/A with its reason, and names it in the count", () => {
    const empty = e2eReport({ ...report, steps: [PASSED, NOT_APPLICABLE] });
    expect(e2eReportLines({ report: empty })).toEqual([
      "PASS  queue  1.2s  /out/01-queue.png",
      `N/A   queue-card  0.2s  ${EMPTY_QUEUE}  /out/02-queue-card.png`,
      "desktop e2e: 1 of 2 step(s) passed, 1 not applicable (queue-card) on /Applications/Slopweaver.app — /out",
    ]);
  });
});
