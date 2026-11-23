import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../lib/result.js";
import { parseOnboardEvalRun } from "../../../onboardEval/runArtifact.js";

const VALID_STEP = {
  durationSeconds: 5,
  guessNote: null,
  guessed: false,
  id: "1-scaffold",
  instructionClear: true,
  outcome: "ok",
  outcomeDetail: "worked as documented",
  skillRef: "skills/onboard/SKILL.md § 1",
  verb: "slopweaver init",
  verbPresent: true,
};

function runJson({ steps }: { steps: readonly unknown[] }): string {
  return JSON.stringify({
    finishedAt: "2026-08-29T00:20:00Z",
    notes: "",
    onboardSkillCommit: "deadbeef",
    runId: "run-1",
    startedAt: "2026-08-29T00:00:00Z",
    steps,
  });
}

describe("parseOnboardEvalRun", () => {
  it("parses a complete, valid run", () => {
    const run = unwrap(parseOnboardEvalRun({ raw: runJson({ steps: [VALID_STEP] }) }));
    expect(run.runId).toBe("run-1");
    expect(run.steps).toHaveLength(1);
    expect(run.steps[0]?.verb).toBe("slopweaver init");
  });

  it("treats a null verb and null guessNote as absent", () => {
    const run = unwrap(
      parseOnboardEvalRun({ raw: runJson({ steps: [{ ...VALID_STEP, guessNote: null, verb: null }] }) }),
    );
    expect(run.steps[0]?.verb).toBeUndefined();
    expect(run.steps[0]?.guessNote).toBeUndefined();
  });

  it("rejects text that is not JSON", () => {
    expect(unwrapErr(parseOnboardEvalRun({ raw: "not json" }))[0]).toContain("not valid JSON");
  });

  it("rejects a JSON value that is not an object", () => {
    expect(unwrapErr(parseOnboardEvalRun({ raw: "[]" }))).toEqual([
      "the run artifact must be a JSON object matching OnboardEvalRun — see --schema",
    ]);
  });

  it("rejects an empty steps array", () => {
    expect(unwrapErr(parseOnboardEvalRun({ raw: runJson({ steps: [] }) }))).toEqual([
      "steps: steps must be a non-empty array",
    ]);
  });

  it("rejects an unknown outcome value, naming the step index", () => {
    const bad = runJson({ steps: [{ ...VALID_STEP, outcome: "maybe" }] });
    expect(unwrapErr(parseOnboardEvalRun({ raw: bad }))[0]).toContain("steps[0]: outcome must be one of");
  });

  it("rejects a step missing a required field", () => {
    const { id: _id, ...withoutId } = VALID_STEP;
    expect(unwrapErr(parseOnboardEvalRun({ raw: runJson({ steps: [withoutId] }) }))).toContain(
      "steps[0]: id must be a non-empty string",
    );
  });
});
