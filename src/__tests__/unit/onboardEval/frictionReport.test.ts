import { describe, expect, it } from "vitest";

import {
  buildFrictionFindings,
  buildFrictionReport,
  buildUnprovenSteps,
  renderFrictionReportMarkdown,
} from "../../../onboardEval/frictionReport.js";
import type { OnboardEvalRun, OnboardEvalStepRecord } from "../../../onboardEval/runArtifact.js";

function step(overrides: Partial<OnboardEvalStepRecord>): OnboardEvalStepRecord {
  return {
    durationSeconds: 1,
    guessNote: undefined,
    guessed: false,
    id: "step",
    instructionClear: true,
    outcome: "ok",
    outcomeDetail: "fine",
    skillRef: "skills/onboard/SKILL.md § 1",
    verb: undefined,
    verbPresent: true,
    ...overrides,
  };
}

function run({ steps }: { steps: readonly OnboardEvalStepRecord[] }): OnboardEvalRun {
  return {
    finishedAt: "2026-08-29T00:20:00Z",
    notes: "",
    onboardSkillCommit: "sha",
    runId: "run-1",
    startedAt: "2026-08-29T00:00:00Z",
    steps,
  };
}

describe("buildFrictionFindings", () => {
  it("finds nothing when every step is clean", () => {
    expect(buildFrictionFindings({ run: run({ steps: [step({})] }) })).toEqual([]);
  });

  it("classifies a silently-failed step as failed-silently, even when other flags are also set", () => {
    const findings = buildFrictionFindings({
      run: run({ steps: [step({ instructionClear: false, outcome: "failed-silently" })] }),
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]?.severity).toBe("failed-silently");
  });

  it("classifies an unclear instruction, a missing verb, and a guess as distinct severities", () => {
    const findings = buildFrictionFindings({
      run: run({
        steps: [
          step({ id: "a", instructionClear: false }),
          step({ id: "b", verbPresent: false }),
          step({ id: "c", guessNote: "guessed the flag name", guessed: true }),
        ],
      }),
    });
    expect(findings.map((finding) => finding.severity)).toEqual([
      "unclear-instruction",
      "missing-verb",
      "had-to-guess",
    ]);
  });

  it("orders findings worst-first across severities, not run order", () => {
    const findings = buildFrictionFindings({
      run: run({
        steps: [step({ id: "guess", guessed: true }), step({ id: "silent", outcome: "failed-silently" })],
      }),
    });
    expect(findings.map((finding) => finding.stepId)).toEqual(["silent", "guess"]);
  });

  it("does not treat unproven-credential-gated as friction on its own", () => {
    expect(buildFrictionFindings({ run: run({ steps: [step({ outcome: "unproven-credential-gated" })] }) })).toEqual(
      [],
    );
  });
});

describe("buildUnprovenSteps", () => {
  it("reports every credential-gated step, never dropping it silently", () => {
    const unproven = buildUnprovenSteps({
      run: run({ steps: [step({ outcomeDetail: "no token", outcome: "unproven-credential-gated" })] }),
    });
    expect(unproven).toEqual([
      { detail: "no token", skillRef: "skills/onboard/SKILL.md § 1", stepId: "step", verb: undefined },
    ]);
  });
});

describe("buildFrictionReport", () => {
  it("sums duration across steps and counts total steps", () => {
    const report = buildFrictionReport({
      run: run({ steps: [step({ durationSeconds: 5 }), step({ durationSeconds: 7, id: "two" })] }),
    });
    expect(report.totalSteps).toBe(2);
    expect(report.totalDurationSeconds).toBe(12);
  });
});

describe("renderFrictionReportMarkdown", () => {
  it("says plainly when there is no friction and no unproven steps", () => {
    const report = buildFrictionReport({ run: run({ steps: [step({})] }) });
    const lines = renderFrictionReportMarkdown({ report });
    expect(lines).toContain("No friction found — every step was clear, verb-backed, and unguessed.");
    expect(lines).toContain("No steps were credential-gated.");
  });

  it("numbers findings and anchors each to its skillRef", () => {
    const report = buildFrictionReport({
      run: run({ steps: [step({ outcome: "failed-silently", outcomeDetail: "exited 0 with nothing printed" })] }),
    });
    const lines = renderFrictionReportMarkdown({ report });
    expect(lines).toContain("1. (failed-silently) skills/onboard/SKILL.md § 1 — exited 0 with nothing printed");
  });
});
