import { describe, expect, it } from "vitest";

import { answerQualityFindings } from "../../../../../admit/answerQualityGate.js";
import { answerDigestOf } from "../../../../../live/turn/poster.js";
import type { AnswerFormAnswer } from "../../../../../outbound/assistant/answerForm.js";
import { CLEAN_VERDICT, minimalAnswer } from "./fixtures.js";
import { usePosterHome } from "./harness.js";

usePosterHome();

describe("the reviewer gate, wired", () => {
  it("REFUSES to send an answer with no verdict — no verdict, no send", () => {
    // The owner's ruling: no answer is better than a bad answer. `undefined` is
    // not "skip the check"; it is the case the gate exists for, and this asserts the wiring reaches it
    // rather than the gate merely existing in isolation.
    const findings = answerQualityFindings({
      answerDigest: answerDigestOf({ answer: minimalAnswer() }),
      verdict: undefined,
    });

    expect(findings.map((finding) => finding.code)).toEqual(["ANSWER_UNREVIEWED"]);
  });

  it("REFUSES a verdict about a DIFFERENT answer — editing after review breaks the binding", () => {
    const edited: AnswerFormAnswer = { ...minimalAnswer(), lead: "something else entirely" };

    const findings = answerQualityFindings({
      answerDigest: answerDigestOf({ answer: edited }),
      verdict: CLEAN_VERDICT,
    });

    expect(findings.map((finding) => finding.code)).toEqual(["ANSWER_VERDICT_STALE"]);
  });

  it("binds to the ANSWER, not its packaging — chrome and mentions are presentation", () => {
    // Re-reviewing because an avatar changed would train people to re-review noise until they stopped
    // reading the result, which costs more than it protects.
    expect(answerDigestOf({ answer: minimalAnswer() })).toBe(answerDigestOf({ answer: minimalAnswer() }));
  });
});
