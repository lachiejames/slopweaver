import { describe, expect, it } from "vitest";
import type { AnswerQualityCase } from "../../../../eval/answerQuality/caseSchema.js";
import {
  bandForScore,
  capBand,
  DEGRADED_THRESHOLD,
  normaliseForMatching,
  SOUND_THRESHOLD,
  satisfiesRequires,
  scoreAnswer,
} from "../../../../eval/answerQuality/score.js";

const CASE: AnswerQualityCase = {
  attributions: [
    {
      id: "a1",
      label: "the limit is credited to the runbook",
      requires: [["runbook"], ["says", "states"]],
      source: "notion",
    },
  ],
  caveats: [{ id: "v1", label: "does not claim it was reproduced", requires: [["not sure whether"]] }],
  claims: [{ id: "c1", label: "the pool exhausted", requires: [["pool"], ["exhausted", "ran out"]] }],
  goldenText: "The pool exhausted. I am not sure whether that caused it. The runbook says the limit is 20.",
  id: "case-01",
  inventedCertainty: ["this confirms the root cause"],
};

const grade = ({ text }: { text: string }) =>
  scoreAnswer({ answerCase: CASE, candidate: { caseId: CASE.id, label: "candidate", text } });

describe("normaliseForMatching", () => {
  it("lowercases and collapses every whitespace run, so an anchor matches across a line break", () => {
    expect(normaliseForMatching({ text: "  Out\nOf   Sync  " })).toBe("out of sync");
  });
});

describe("satisfiesRequires", () => {
  it("needs every group, and any one alternative inside a group", () => {
    const requires = [["pool"], ["exhausted", "ran out"]];
    expect(satisfiesRequires({ requires, text: "the pool ran out overnight" })).toBe(true);
    expect(satisfiesRequires({ requires, text: "the pool was fine" })).toBe(false);
    expect(satisfiesRequires({ requires, text: "it ran out overnight" })).toBe(false);
  });
});

describe("bandForScore", () => {
  it("names top only at exactly 1", () => {
    expect(bandForScore({ score: 1 })).toBe("top");
    expect(bandForScore({ score: 0.999 })).toBe("sound");
  });

  it("bands the declared thresholds and everything under them", () => {
    expect(bandForScore({ score: SOUND_THRESHOLD })).toBe("sound");
    expect(bandForScore({ score: DEGRADED_THRESHOLD })).toBe("degraded");
    expect(bandForScore({ score: 0.49 })).toBe("unsound");
  });
});

describe("capBand", () => {
  it("returns the worse of the two", () => {
    expect(capBand({ band: "top", ceiling: "degraded" })).toBe("degraded");
    expect(capBand({ band: "unsound", ceiling: "degraded" })).toBe("unsound");
    expect(capBand({ band: "sound", ceiling: "top" })).toBe("sound");
  });
});

describe("scoreAnswer", () => {
  it("grades the golden top over every declared dimension, with no reasons", () => {
    const result = grade({ text: CASE.goldenText });
    expect(result.score).toBe(1);
    expect(result.band).toBe("top");
    expect(result.reasons).toEqual([]);
    expect(result.dimensions).toEqual([
      { kind: "claims", met: 1, total: 1 },
      { kind: "caveats", met: 1, total: 1 },
      { kind: "attributions", met: 1, total: 1 },
      { kind: "certainty", met: 1, total: 1 },
    ]);
  });

  it("grades a restatement in different words exactly as high as the golden", () => {
    const result = grade({
      text: "The pool ran out. I am not sure whether that is what broke it. Our runbook states a cap of 20.",
    });
    expect(result.score).toBe(1);
    expect(result.band).toBe("top");
  });

  it("drops a quarter and names the caveat when the hedge is stripped from an otherwise identical answer", () => {
    const result = grade({ text: "The pool exhausted. The runbook says the limit is 20." });
    expect(result.score).toBe(0.75);
    expect(result.band).toBe("degraded");
    expect(result.reasons).toEqual(["caveat dropped: does not claim it was reproduced"]);
  });

  it("names the attribution and its source when a claim is asserted bare", () => {
    const result = grade({ text: "The pool exhausted. I am not sure whether that caused it. The limit is 20." });
    expect(result.reasons).toEqual(["attribution dropped: the limit is credited to the runbook (source: notion)"]);
  });

  it("caps the band at degraded when certainty is invented, however high the mean", () => {
    const answerCase: AnswerQualityCase = {
      ...CASE,
      inventedCertainty: ["this confirms the root cause", "this resolves the question"],
    };
    const result = scoreAnswer({
      answerCase,
      candidate: { caseId: answerCase.id, label: "certain", text: `${CASE.goldenText} This confirms the root cause.` },
    });
    expect(result.score).toBe(0.875);
    expect(bandForScore({ score: result.score })).toBe("sound");
    expect(result.band).toBe("degraded");
    expect(result.reasons).toEqual(['invented certainty: "this confirms the root cause"']);
  });

  it("scores an empty answer 0.25 — it carries nothing, and the only thing it got right is inventing nothing", () => {
    const result = grade({ text: "" });
    expect(result.score).toBe(0.25);
    expect(result.band).toBe("unsound");
    expect(result.reasons).toEqual([
      "claim not carried: the pool exhausted",
      "caveat dropped: does not claim it was reproduced",
      "attribution dropped: the limit is credited to the runbook (source: notion)",
    ]);
  });

  it("scores a case over only the dimensions it declares", () => {
    const answerCase: AnswerQualityCase = { ...CASE, attributions: [], inventedCertainty: [] };
    const result = scoreAnswer({
      answerCase,
      candidate: { caseId: answerCase.id, label: "half", text: "The pool exhausted." },
    });
    expect(result.dimensions).toEqual([
      { kind: "claims", met: 1, total: 1 },
      { kind: "caveats", met: 0, total: 1 },
    ]);
    expect(result.score).toBe(0.5);
  });

  /**
   * The converse of "ignores wording", pinned rather than described. The r1 review pass called the claim
   * "a rewording can never score below the golden" BROKEN, and this is the counterexample it named: the
   * matcher is `includes`, so substance carried in words the anchors never listed is invisible to it.
   * If this ever starts passing at TOP the matcher gained semantics, which this lane refuses on purpose.
   */
  it("grades a rewording outside the anchors below the golden, carrying identical substance", () => {
    const answerCase: AnswerQualityCase = {
      attributions: [],
      caveats: [],
      claims: [{ id: "c1", label: "the schema error is unrelated", requires: [["unrelated"]] }],
      goldenText: "The schema error is unrelated to the original fault.",
      id: "case-01",
      inventedCertainty: [],
      paraphrase: undefined,
    };
    const golden = scoreAnswer({
      answerCase,
      candidate: { caseId: answerCase.id, label: "the golden itself", text: answerCase.goldenText },
    });
    const reworded = scoreAnswer({
      answerCase,
      candidate: {
        caseId: answerCase.id,
        label: "a pure rewording",
        text: "The schema error has nothing to do with the original fault.",
      },
    });

    expect(golden.band).toBe("top");
    expect(golden.score).toBe(1);
    expect(reworded.band).toBe("unsound");
    expect(reworded.score).toBe(0);
    expect(reworded.reasons).toEqual(["claim not carried: the schema error is unrelated"]);
  });

  it("reports rather than divides by zero when a rubric declares nothing", () => {
    const answerCase: AnswerQualityCase = {
      ...CASE,
      attributions: [],
      caveats: [],
      claims: [],
      inventedCertainty: [],
    };
    const result = scoreAnswer({
      answerCase,
      candidate: { caseId: answerCase.id, label: "any", text: "anything at all" },
    });
    expect(result.score).toBe(0);
    expect(result.band).toBe("unsound");
    expect(result.reasons).toEqual(["case case-01 declares no expectations — nothing to grade"]);
  });
});
