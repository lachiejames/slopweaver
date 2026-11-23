import { describe, expect, it } from "vitest";

import { DistilErrors } from "../../../gold/distil.errors.js";

describe("DistilErrors", () => {
  it("builds DISTIL_DIGEST_SHAPE_INVALID", () => {
    expect(DistilErrors.digestShapeInvalid()).toEqual({
      code: "DISTIL_DIGEST_SHAPE_INVALID",
      message: "digest must have a string summary and a points array",
    });
  });

  it("builds DISTIL_DIGEST_EMPTY", () => {
    expect(DistilErrors.digestEmpty()).toEqual({
      code: "DISTIL_DIGEST_EMPTY",
      message: "digest had neither a summary nor any cited point",
    });
  });

  it("builds DISTIL_BRIEF_NOT_OBJECT", () => {
    expect(DistilErrors.briefNotObject()).toEqual({
      code: "DISTIL_BRIEF_NOT_OBJECT",
      message: "the brief is not a JSON object",
    });
  });

  it("builds DISTIL_BRIEF_VERSION_MISMATCH rendering an unknown found version beside the expected one", () => {
    expect(DistilErrors.briefVersionMismatch({ expected: 4, found: undefined })).toEqual({
      code: "DISTIL_BRIEF_VERSION_MISMATCH",
      message:
        "the brief is version undefined, but this build writes version 4 — regenerate it with `slopweaver distil brief`",
    });
    expect(DistilErrors.briefVersionMismatch({ expected: 4, found: "3" }).message).toBe(
      "the brief is version 3, but this build writes version 4 — regenerate it with `slopweaver distil brief`",
    );
  });

  it("builds DISTIL_BRIEF_INVALID joining every problem in order", () => {
    expect(DistilErrors.briefInvalid({ problems: ["batch missing", "prompt not a string"] })).toEqual({
      code: "DISTIL_BRIEF_INVALID",
      message: "batch missing; prompt not a string",
      problems: ["batch missing", "prompt not a string"],
    });
  });

  it("builds DISTIL_CONTRACT_CHANGED carrying both fingerprints", () => {
    expect(DistilErrors.contractChanged({ briefFingerprint: "aaa111", currentFingerprint: "bbb222" })).toEqual({
      briefFingerprint: "aaa111",
      code: "DISTIL_CONTRACT_CHANGED",
      currentFingerprint: "bbb222",
      message:
        "the distil contract changed since this brief was written (aaa111 → bbb222) — regenerate with `slopweaver distil brief`",
    });
  });

  it("builds DISTIL_PINNED_REFS_INVALID joining every reason in order", () => {
    expect(DistilErrors.pinnedRefsInvalid({ reasons: ["ref a resolved to 0", "ref b resolved to 2"] })).toEqual({
      code: "DISTIL_PINNED_REFS_INVALID",
      message: "ref a resolved to 0; ref b resolved to 2",
      reasons: ["ref a resolved to 0", "ref b resolved to 2"],
    });
  });

  it("builds DISTIL_BATCH_HASH_MISMATCH", () => {
    expect(DistilErrors.batchHashMismatch()).toEqual({
      code: "DISTIL_BATCH_HASH_MISMATCH",
      message:
        "the batch's content hash no longer matches the brief — the corpus changed since it was written; regenerate with `slopweaver distil brief`",
    });
  });

  it("builds DISTIL_PROMPT_DRIFT joining every reason in order", () => {
    expect(DistilErrors.promptDrift({ reasons: ["system prompt differs", "record order differs"] })).toEqual({
      code: "DISTIL_PROMPT_DRIFT",
      message: "system prompt differs; record order differs",
      reasons: ["system prompt differs", "record order differs"],
    });
  });
});
