import { describe, expect, it } from "vitest";

import {
  composeVelocityReport,
  renderVelocityLines,
  VELOCITY_CAUTION,
  velocityJson,
} from "../../../velocity/report.js";

function baseReport() {
  return composeVelocityReport({
    asksPath: "/sw-home/live/slack/asks.jsonl",
    docLatenciesHours: [4, 8],
    docsLandedByDay: [
      { dayKey: "2026-08-31", landed: 1 },
      { dayKey: "2026-09-01", landed: 2 },
    ],
    mergesByDay: [
      { dayKey: "2026-08-31", merges: 3 },
      { dayKey: "2026-09-01", merges: 5 },
    ],
    ref: "origin/main",
    repoLabel: "slopweaver",
    repoPath: "/repo",
    runsDir: "/sw-home/runs",
    sinceIso: "2026-08-31T00:00:00.000Z",
    turnsPerAsk: [1, 2, 3],
    untilIso: "2026-09-02T00:00:00.000Z",
    windowDays: 2,
  });
}

describe("composeVelocityReport", () => {
  it("sums the per-day counts into totals", () => {
    const report = baseReport();

    expect(report.mergesTotal).toBe(8);
    expect(report.docsLandedTotal).toBe(3);
  });

  it("computes the median doc latency and its sample size", () => {
    const report = baseReport();

    expect(report.medianDocLatencyHours).toBe(6);
    expect(report.docLatencySampleSize).toBe(2);
  });

  it("computes the mean and median turns per ask and the sample size", () => {
    const report = baseReport();

    expect(report.meanTurnsPerAsk).toBe(2);
    expect(report.medianTurnsPerAsk).toBe(2);
    expect(report.askSampleSize).toBe(3);
  });

  it("reports undefined latency/turns rather than a false zero over an empty sample", () => {
    const report = composeVelocityReport({
      asksPath: "/sw-home/live/slack/asks.jsonl",
      docLatenciesHours: [],
      docsLandedByDay: [],
      mergesByDay: [],
      ref: "origin/main",
      repoLabel: "slopweaver",
      repoPath: "/repo",
      runsDir: "/sw-home/runs",
      sinceIso: "2026-08-31T00:00:00.000Z",
      turnsPerAsk: [],
      untilIso: "2026-09-02T00:00:00.000Z",
      windowDays: 2,
    });

    expect(report.medianDocLatencyHours).toBe(undefined);
    expect(report.meanTurnsPerAsk).toBe(undefined);
  });
});

describe("renderVelocityLines", () => {
  it("carries the faster-is-not-better caution verbatim as the header", () => {
    const lines = renderVelocityLines({ report: baseReport() });

    expect(lines[1]).toBe(VELOCITY_CAUTION);
  });

  it("prints the exact git command that reproduces the merge count", () => {
    const lines = renderVelocityLines({ report: baseReport() });

    const reproLine = lines.find((line) => line.includes("git -C"));
    expect(reproLine).toBe(
      "  repro: git -C /repo log origin/main --since=2026-08-31T00:00:00.000Z --until=2026-09-02T00:00:00.000Z --pretty=%s | grep -cE '\\(#[0-9]+\\)'",
    );
  });

  it("prints the total merges and docs landed", () => {
    const lines = renderVelocityLines({ report: baseReport() });

    expect(lines.some((line) => line.startsWith("PRs merged: 8 total"))).toBe(true);
    expect(lines.some((line) => line.startsWith("Docs landed ready→done: 3 total"))).toBe(true);
  });
});

describe("velocityJson", () => {
  it("carries the same totals and the caution", () => {
    const json = velocityJson({ report: baseReport() });

    expect(json["mergesTotal"]).toBe(8);
    expect(json["docsLandedTotal"]).toBe(3);
    expect(json["caution"]).toBe(VELOCITY_CAUTION);
  });
});
