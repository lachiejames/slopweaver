import { describe, expect, it } from "vitest";
import { AnswerQualityErrors } from "../../../../eval/answerQuality/errors.js";

describe("AnswerQualityErrors", () => {
  it("builds every variant with its own code and a displayable message", () => {
    expect(AnswerQualityErrors.casesPathMissing()).toEqual({
      code: "CASES_PATH_MISSING",
      message: "--cases <path> is required",
    });
    expect(AnswerQualityErrors.modeConflict().code).toBe("MODE_CONFLICT");
    expect(AnswerQualityErrors.modeMissing().message).toContain("--selftest to check the scorer's properties");
  });

  it("carries the path a read failed on, not only the sentence about it", () => {
    const error = AnswerQualityErrors.fileUnreadable({ path: "/tmp/cases.json" });
    expect(error.path).toBe("/tmp/cases.json");
    expect(error.message).toBe("cannot read /tmp/cases.json");
  });

  it("carries both the unknown case id and the candidate that named it", () => {
    const error = AnswerQualityErrors.unknownCase({ candidateLabel: "orphan", caseId: "case-99" });
    expect(error.caseId).toBe("case-99");
    expect(error.candidateLabel).toBe("orphan");
    expect(error.message).toBe("candidate orphan names unknown case case-99");
  });
});
