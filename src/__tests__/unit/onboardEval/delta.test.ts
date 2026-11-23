import { describe, expect, it } from "vitest";

import { diffReports, renderDeltaMarkdown } from "../../../onboardEval/delta.js";
import type { FrictionFinding, FrictionReport } from "../../../onboardEval/frictionReport.js";

function finding(overrides: Partial<FrictionFinding>): FrictionFinding {
  return {
    detail: "detail",
    severity: "unclear-instruction",
    skillRef: "skills/onboard/SKILL.md § 1",
    stepId: "step",
    verb: undefined,
    ...overrides,
  };
}

function report({
  runId,
  findings,
  totalDurationSeconds = 0,
}: {
  runId: string;
  findings: readonly FrictionFinding[];
  totalDurationSeconds?: number;
}): FrictionReport {
  return { findings, runId, totalDurationSeconds, totalSteps: findings.length, unprovenSteps: [] };
}

describe("diffReports", () => {
  it("treats every finding as new when there is no previous run", () => {
    const current = report({ findings: [finding({ stepId: "a" })], runId: "r1", totalDurationSeconds: 10 });
    const delta = diffReports({ current, previous: undefined });
    expect(delta.previousRunId).toBeUndefined();
    expect(delta.newFindings).toEqual(current.findings);
    expect(delta.resolvedFindings).toEqual([]);
    expect(delta.durationDeltaSeconds).toBe(10);
  });

  it("splits findings into new, resolved, and persisting by stepId", () => {
    const previous = report({
      findings: [finding({ stepId: "kept" }), finding({ stepId: "fixed" })],
      runId: "r1",
      totalDurationSeconds: 100,
    });
    const current = report({
      findings: [finding({ stepId: "kept" }), finding({ stepId: "new" })],
      runId: "r2",
      totalDurationSeconds: 80,
    });
    const delta = diffReports({ current, previous });
    expect(delta.previousRunId).toBe("r1");
    expect(delta.newFindings.map((f) => f.stepId)).toEqual(["new"]);
    expect(delta.resolvedFindings.map((f) => f.stepId)).toEqual(["fixed"]);
    expect(delta.persistingFindings.map((f) => f.stepId)).toEqual(["kept"]);
    expect(delta.durationDeltaSeconds).toBe(-20);
  });
});

describe("renderDeltaMarkdown", () => {
  it("says there is no previous run when there isn't one", () => {
    const lines = renderDeltaMarkdown({
      delta: diffReports({ current: report({ findings: [], runId: "r1" }), previous: undefined }),
    });
    expect(lines).toContain("No previous run to compare against — this is the first recorded evaluation.");
  });

  it("lists new and resolved findings under their own headings", () => {
    const previous = report({ findings: [finding({ detail: "old bug", stepId: "fixed" })], runId: "r1" });
    const current = report({ findings: [finding({ detail: "fresh bug", stepId: "new" })], runId: "r2" });
    const lines = renderDeltaMarkdown({ delta: diffReports({ current, previous }) });
    expect(lines).toContain("### New (1) — regressions since the previous run");
    expect(lines).toContain("1. skills/onboard/SKILL.md § 1 — fresh bug");
    expect(lines).toContain("### Resolved (1) — fixed since the previous run");
    expect(lines).toContain("1. skills/onboard/SKILL.md § 1 — old bug");
  });
});
