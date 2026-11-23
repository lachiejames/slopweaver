import { describe, expect, it } from "vitest";
import { unwrap, unwrapErr } from "#lib/result.js";
import {
  isGradeable,
  loadAnswerCandidates,
  loadAnswerQualityCases,
} from "../../../../eval/answerQuality/caseSchema.js";

const GRADEABLE = {
  attributions: [],
  caveats: [],
  claims: [{ id: "c1", label: "the pool exhausted", requires: [["pool"]] }],
  goldenText: "The pool exhausted.",
  id: "case-01",
  inventedCertainty: [],
};

describe("loadAnswerQualityCases", () => {
  it("parses a case file and defaults every absent dimension to empty", () => {
    const raw = JSON.stringify({
      cases: [{ claims: GRADEABLE.claims, goldenText: "The pool exhausted.", id: "case-01" }],
      schemaVersion: 1,
    });
    const cases = unwrap(loadAnswerQualityCases({ label: "cases.json", raw }));
    expect(cases.length).toBe(1);
    expect(cases[0]!.id).toBe("case-01");
    expect(cases[0]!.caveats).toEqual([]);
    expect(cases[0]!.attributions).toEqual([]);
    expect(cases[0]!.inventedCertainty).toEqual([]);
    expect(cases[0]!.paraphrase).toBeUndefined();
  });

  it("refuses a file at the wrong schema version, naming the field", () => {
    const raw = JSON.stringify({ cases: [GRADEABLE], schemaVersion: 2 });
    const errors = unwrapErr(loadAnswerQualityCases({ label: "cases.json", raw }));
    expect(errors.length).toBe(1);
    expect(errors[0]).toContain("schemaVersion");
  });

  it("refuses an empty any-of group, which would make an expectation unfalsifiable", () => {
    const raw = JSON.stringify({
      cases: [{ ...GRADEABLE, claims: [{ id: "c1", label: "empty", requires: [[]] }] }],
      schemaVersion: 1,
    });
    const errors = unwrapErr(loadAnswerQualityCases({ label: "cases.json", raw }));
    expect(errors[0]).toContain("cases.0.claims.0.requires.0");
  });

  it("refuses a case whose golden carries no gradeable answer, naming the case", () => {
    const raw = JSON.stringify({
      cases: [{ ...GRADEABLE, claims: [], id: "case-07" }],
      schemaVersion: 1,
    });
    const errors = unwrapErr(loadAnswerQualityCases({ label: "cases.json", raw }));
    expect(errors).toEqual([
      "cases.json: case case-07 declares no claim, caveat or attribution — its golden carries no gradeable answer",
    ]);
  });

  it("refuses text that is not JSON at all", () => {
    const errors = unwrapErr(loadAnswerQualityCases({ label: "cases.json", raw: "{" }));
    expect(errors.length).toBeGreaterThan(0);
  });
});

describe("isGradeable", () => {
  it("is true when the case declares a claim", () => {
    expect(isGradeable({ answerCase: GRADEABLE })).toBe(true);
  });

  it("is true when the only declared dimension is a caveat", () => {
    const answerCase = {
      ...GRADEABLE,
      caveats: [{ id: "v1", label: "hedged", requires: [["not sure"]] }],
      claims: [],
    };
    expect(isGradeable({ answerCase })).toBe(true);
  });

  it("is false when a case declares only invented-certainty phrases", () => {
    const answerCase = { ...GRADEABLE, claims: [], inventedCertainty: ["this confirms"] };
    expect(isGradeable({ answerCase })).toBe(false);
  });
});

describe("loadAnswerCandidates", () => {
  it("parses candidates in file order", () => {
    const raw = JSON.stringify({
      candidates: [
        { caseId: "case-01", label: "golden", text: "The pool exhausted." },
        { caseId: "case-01", label: "stripped", text: "Something happened." },
      ],
      schemaVersion: 1,
    });
    const candidates = unwrap(loadAnswerCandidates({ label: "candidates.json", raw }));
    expect(candidates.map((candidate) => candidate.label)).toEqual(["golden", "stripped"]);
  });

  it("accepts an empty candidate text, which is the degenerate answer worth grading", () => {
    const raw = JSON.stringify({
      candidates: [{ caseId: "case-01", label: "empty", text: "" }],
      schemaVersion: 1,
    });
    expect(unwrap(loadAnswerCandidates({ label: "candidates.json", raw }))[0]!.text).toBe("");
  });

  it("refuses a candidate file with no candidates in it", () => {
    const raw = JSON.stringify({ candidates: [], schemaVersion: 1 });
    const errors = unwrapErr(loadAnswerCandidates({ label: "candidates.json", raw }));
    expect(errors[0]).toContain("candidates");
  });
});
