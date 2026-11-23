import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { unwrap } from "#lib/result.js";
import type { AnswerQualityCase } from "../../../../eval/answerQuality/caseSchema.js";
import { loadAnswerQualityCases } from "../../../../eval/answerQuality/caseSchema.js";
import { degradeGolden } from "../../../../eval/answerQuality/degrade.js";
import {
  PARAPHRASE_MAX_OVERLAP,
  runSelftest,
  selftestFailed,
  tokenOverlap,
} from "../../../../eval/answerQuality/selftest.js";

const CASE: AnswerQualityCase = {
  attributions: [],
  caveats: [
    { id: "v1", label: "does not claim it was reproduced", requires: [["not sure whether", "cannot confirm"]] },
  ],
  claims: [{ id: "c1", label: "the pool exhausted", requires: [["pool"], ["exhausted", "ran out"]] }],
  goldenText: "The pool exhausted overnight.\n\nI am not sure whether that is what broke checkout.",
  id: "case-01",
  inventedCertainty: ["this confirms the root cause"],
  paraphrase: "Connections ran out around midnight. Cannot confirm the pool is why checkout fell over.",
};

const statesOf = ({ cases }: { cases: readonly AnswerQualityCase[] }) =>
  Object.fromEntries(runSelftest({ cases }).map((outcome) => [outcome.property, outcome.state]));

describe("tokenOverlap", () => {
  it("is 1 for identical text and 0 for disjoint text", () => {
    expect(tokenOverlap({ left: "the pool exhausted", right: "the pool exhausted" })).toBe(1);
    expect(tokenOverlap({ left: "alpha beta", right: "gamma delta" })).toBe(0);
  });

  it("is 0 rather than NaN when both sides hold no tokens at all", () => {
    expect(tokenOverlap({ left: "   ", right: "!!!" })).toBe(0);
  });

  it("ignores punctuation and case", () => {
    expect(tokenOverlap({ left: "Out-of-sync!", right: "out of sync" })).toBe(1);
  });
});

describe("runSelftest", () => {
  it("passes every property for a sound rubric", () => {
    const outcomes = runSelftest({ cases: [CASE] });
    expect(outcomes.every((outcome) => outcome.state === "pass")).toBe(true);
    expect(selftestFailed({ outcomes })).toBe(false);
  });

  it("runs one property per case plus one per degraded variant", () => {
    expect(runSelftest({ cases: [CASE] }).map((outcome) => outcome.property)).toEqual([
      "verbatim-golden-scores-top",
      "paraphrase-is-measurably-a-paraphrase",
      "paraphrase-scores-top",
      "anchors-are-droppable",
      "degrades-down · caveat-dropped · v1",
      "degrades-down · certainty-invented · k1",
    ]);
  });

  it("keeps every golden-derived label out of the property name and in the detail instead", () => {
    const outcomes = runSelftest({ cases: [CASE] });
    const degradations = outcomes.filter((outcome) => outcome.redacted.family === "degrades-down");
    expect(degradations.map((outcome) => outcome.property)).toEqual([
      "degrades-down · caveat-dropped · v1",
      "degrades-down · certainty-invented · k1",
    ]);
    expect(degradations[0]!.detail).toContain("caveat-dropped: does not claim it was reproduced");
    expect(degradations[1]!.detail).toContain('certainty-invented: "this confirms the root cause"');
  });

  it("carries a redaction-safe target and both scores on every degradation outcome", () => {
    const degradations = runSelftest({ cases: [CASE] }).filter(
      (outcome) => outcome.redacted.family === "degrades-down",
    );
    expect(degradations.map((outcome) => outcome.redacted.target)).toEqual([
      { expectationId: "v1", kind: "caveat-dropped" },
      { expectationId: "k1", kind: "certainty-invented" },
    ]);
    expect(degradations[0]!.redacted.metrics).toEqual([
      { name: "score", value: 2 / 3 },
      { name: "golden-score", value: 1 },
    ]);
    expect(degradations[0]!.redacted.band).toBe("degraded");
  });

  it("reports the paraphrase overlap and its bound as numbers, not only in prose", () => {
    const outcome = runSelftest({ cases: [CASE] }).find(
      (entry) => entry.redacted.family === "paraphrase-is-measurably-a-paraphrase",
    )!;
    expect(outcome.redacted.metrics.map((metric) => metric.name)).toEqual(["token-overlap", "overlap-bound"]);
    expect(outcome.redacted.metrics[1]!.value).toBe(PARAPHRASE_MAX_OVERLAP);
    expect(outcome.redacted.band).toBeUndefined();
  });

  it("fails the verbatim property when the rubric does not fit its own golden", () => {
    const answerCase: AnswerQualityCase = {
      ...CASE,
      claims: [{ id: "c1", label: "names the replica set", requires: [["replica set"]] }],
    };
    expect(statesOf({ cases: [answerCase] })["verbatim-golden-scores-top"]).toBe("fail");
  });

  it("fails the paraphrase property when the paraphrase is a near-copy of the golden", () => {
    const answerCase: AnswerQualityCase = { ...CASE, paraphrase: CASE.goldenText };
    const states = statesOf({ cases: [answerCase] });
    expect(states["paraphrase-is-measurably-a-paraphrase"]).toBe("fail");
    expect(states["paraphrase-scores-top"]).toBe("pass");
  });

  it("fails the paraphrase-scores-top property when the restatement drops a caveat", () => {
    const answerCase: AnswerQualityCase = { ...CASE, paraphrase: "Connections ran out around midnight." };
    expect(statesOf({ cases: [answerCase] })["paraphrase-scores-top"]).toBe("fail");
  });

  it("skips, never passes, the two paraphrase properties when a case declares none", () => {
    const { paraphrase: _unused, ...withoutParaphrase } = CASE;
    const states = statesOf({ cases: [withoutParaphrase] });
    expect(states["paraphrase-is-measurably-a-paraphrase"]).toBe("skip");
    expect(states["paraphrase-scores-top"]).toBe("skip");
    expect(selftestFailed({ outcomes: runSelftest({ cases: [withoutParaphrase] }) })).toBe(false);
  });

  it("fails the droppable property for an anchor that straddles a sentence boundary", () => {
    const answerCase: AnswerQualityCase = {
      ...CASE,
      caveats: [{ id: "v1", label: "straddles", requires: [["overnight. i am"]] }],
    };
    expect(statesOf({ cases: [answerCase] })["anchors-are-droppable"]).toBe("fail");
  });
});

describe("PARAPHRASE_MAX_OVERLAP", () => {
  it("is the bound the paraphrase property is measured against", () => {
    expect(PARAPHRASE_MAX_OVERLAP).toBe(0.5);
    expect(tokenOverlap({ left: CASE.goldenText, right: CASE.paraphrase! })).toBeLessThan(PARAPHRASE_MAX_OVERLAP);
  });
});

describe("the shipped fixture's overlap profile", () => {
  const raw = readFileSync(
    fileURLToPath(new URL("../../../../../eval/answer-quality.fixture.json", import.meta.url)),
    "utf8",
  );
  const cases = unwrap(loadAnswerQualityCases({ label: "fixture", raw }));

  const overlapsFor = ({ answerCase }: { answerCase: AnswerQualityCase }) =>
    Object.fromEntries(
      degradeGolden({ answerCase }).map((variant) => [
        variant.kind,
        Number(tokenOverlap({ left: answerCase.goldenText, right: variant.text }).toFixed(3)),
      ]),
    );

  it("ranks the invented-certainty variant CLOSEST to the golden while the scorer holds it furthest down", () => {
    const diagnosis = cases.find((answerCase) => answerCase.id === "fixture-diagnosis")!;
    expect(tokenOverlap({ left: diagnosis.goldenText, right: diagnosis.goldenText })).toBe(1);
    expect(overlapsFor({ answerCase: diagnosis })).toEqual({
      "attribution-dropped": 0.755,
      "caveat-dropped": 0.612,
      "certainty-invented": 0.942,
    });

    const refusal = cases.find((answerCase) => answerCase.id === "fixture-refusal")!;
    expect(overlapsFor({ answerCase: refusal })).toEqual({
      "caveat-dropped": 0.782,
      "certainty-invented": 0.948,
    });
  });
});
