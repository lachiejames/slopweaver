/**
 * `JudgementMiningErrors`: each factory's literal code, its exact message, and the fields a caller reads
 * beside it — the counts two variants carry and the issue list `profileInvalid` joins in order.
 */
import { describe, expect, it } from "vitest";

import {
  type JudgementMiningAnswerShapeInvalidError,
  type JudgementMiningError,
  JudgementMiningErrors,
  type JudgementMiningHeldOutLeakError,
  type JudgementMiningInconsistentExamplesError,
  type JudgementMiningManifestTamperedError,
  type JudgementMiningNoSourcesError,
  type JudgementMiningProfileInvalidError,
  type JudgementMiningStaleFingerprintError,
} from "../../../judgement/miningBrief.errors.js";

describe("JudgementMiningErrors", () => {
  it("noSources is JUDGEMENT_MINING_NO_SOURCES with its exact message", () => {
    const error: JudgementMiningNoSourcesError = JudgementMiningErrors.noSources();
    expect(error).toEqual({
      code: "JUDGEMENT_MINING_NO_SOURCES",
      message: "at least one source sample is required to build a mining brief",
    });
  });

  it("staleFingerprint is JUDGEMENT_MINING_STALE_FINGERPRINT and says to rebuild", () => {
    const error: JudgementMiningStaleFingerprintError = JudgementMiningErrors.staleFingerprint();
    expect(error).toEqual({
      code: "JUDGEMENT_MINING_STALE_FINGERPRINT",
      message: "the brief's prompt fingerprint does not match the current mining contract — rebuild it",
    });
  });

  it("manifestTampered is JUDGEMENT_MINING_MANIFEST_TAMPERED and says the brief was tampered with", () => {
    const error: JudgementMiningManifestTamperedError = JudgementMiningErrors.manifestTampered();
    expect(error).toEqual({
      code: "JUDGEMENT_MINING_MANIFEST_TAMPERED",
      message: "the brief's source manifest hash does not match its own manifest — the brief was tampered with",
    });
  });

  it("answerShapeInvalid is JUDGEMENT_MINING_ANSWER_SHAPE_INVALID and names both required sections", () => {
    const error: JudgementMiningAnswerShapeInvalidError = JudgementMiningErrors.answerShapeInvalid();
    expect(error).toEqual({
      code: "JUDGEMENT_MINING_ANSWER_SHAPE_INVALID",
      message: "the answer must be a JSON object with `voice` and `routing` sections",
    });
  });

  it("inconsistentExamples is JUDGEMENT_MINING_INCONSISTENT_EXAMPLES and carries its count into the message", () => {
    const error: JudgementMiningInconsistentExamplesError = JudgementMiningErrors.inconsistentExamples({ count: 3 });
    expect(error).toEqual({
      code: "JUDGEMENT_MINING_INCONSISTENT_EXAMPLES",
      count: 3,
      message: "3 example(s) have a sourceHash that does not match their own text",
    });
  });

  it("heldOutLeak is JUDGEMENT_MINING_HELD_OUT_LEAK and carries its count into the message", () => {
    const error: JudgementMiningHeldOutLeakError = JudgementMiningErrors.heldOutLeak({ count: 1 });
    expect(error).toEqual({
      code: "JUDGEMENT_MINING_HELD_OUT_LEAK",
      count: 1,
      message: "1 example(s) match a held-out routing-eval case — mining on the test set is refused",
    });
  });

  it("profileInvalid is JUDGEMENT_MINING_PROFILE_INVALID, keeps every issue and joins them in order", () => {
    const error: JudgementMiningProfileInvalidError = JudgementMiningErrors.profileInvalid({
      issues: ["voice.tone: required", "routing.rules: expected array"],
    });
    expect(error).toEqual({
      code: "JUDGEMENT_MINING_PROFILE_INVALID",
      issues: ["voice.tone: required", "routing.rules: expected array"],
      message: "voice.tone: required; routing.rules: expected array",
    });
  });

  it("profileInvalid with no issues is JUDGEMENT_MINING_PROFILE_INVALID with an empty message", () => {
    expect(JudgementMiningErrors.profileInvalid({ issues: [] })).toEqual({
      code: "JUDGEMENT_MINING_PROFILE_INVALID",
      issues: [],
      message: "",
    });
  });

  it("gives every variant of the union a distinct code", () => {
    const all: readonly JudgementMiningError[] = [
      JudgementMiningErrors.noSources(),
      JudgementMiningErrors.staleFingerprint(),
      JudgementMiningErrors.manifestTampered(),
      JudgementMiningErrors.answerShapeInvalid(),
      JudgementMiningErrors.inconsistentExamples({ count: 2 }),
      JudgementMiningErrors.heldOutLeak({ count: 2 }),
      JudgementMiningErrors.profileInvalid({ issues: ["x"] }),
    ];
    expect(all.map((error) => error.code)).toEqual([
      "JUDGEMENT_MINING_NO_SOURCES",
      "JUDGEMENT_MINING_STALE_FINGERPRINT",
      "JUDGEMENT_MINING_MANIFEST_TAMPERED",
      "JUDGEMENT_MINING_ANSWER_SHAPE_INVALID",
      "JUDGEMENT_MINING_INCONSISTENT_EXAMPLES",
      "JUDGEMENT_MINING_HELD_OUT_LEAK",
      "JUDGEMENT_MINING_PROFILE_INVALID",
    ]);
  });
});
