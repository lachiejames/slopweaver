/*
 * `validateFallbackReview`: a valid answer binds to its request by id and by digest of the request bytes, and a moved
 * HEAD, a changed working tree, an answer to another property or a BROKEN with no counterexample is refused.
 */
import { describe, expect, it } from "vitest";

import { fallbackDocumentSha256, validateFallbackReview } from "../../../../codex/fallbackReview.js";
import { CLEAN_ANSWER, CLEAN_NOW, fingerprintOn, HEAD, OTHER_HEAD, REVIEWER, receiptFor, request } from "./harness.js";

describe("validateFallbackReview", () => {
  it("binds a valid answer to its request, by id and by digest of the request bytes", () => {
    const req = request();
    const receipt = receiptFor({ req });
    expect(receipt.requestId).toBe("req-1");
    expect(receipt.requestSha256).toBe(fallbackDocumentSha256({ bytes: JSON.stringify(req) }));
    expect(receipt.answer.verdict).toBe("CLEAN");
    expect(receipt.reviewer.host).toBe("claude-code");
  });

  it("REFUSES when HEAD moved after prepare — the packet no longer describes the checkout", () => {
    const result = validateFallbackReview({
      answer: CLEAN_ANSWER,
      completedAtIso: "2026-09-14T01:30:00.000Z",
      now: fingerprintOn({ headSha: OTHER_HEAD, patch: "" }),
      receiptId: "rcpt-1",
      request: request(),
      requestBytes: "{}",
      reviewer: REVIEWER,
    });
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr()[0]).toContain(`the request was prepared at HEAD ${HEAD}`);
  });

  it("REFUSES when the working tree changed on the same HEAD", () => {
    const result = validateFallbackReview({
      answer: CLEAN_ANSWER,
      completedAtIso: "2026-09-14T01:30:00.000Z",
      now: fingerprintOn({ headSha: HEAD, patch: "diff --git a/x b/x\n+edited\n" }),
      receiptId: "rcpt-1",
      request: request(),
      requestBytes: "{}",
      reviewer: REVIEWER,
    });
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr()[0]).toContain("the working tree changed after the request was prepared");
  });

  it("REFUSES an answer to a different property, exactly as a Codex review would", () => {
    const result = validateFallbackReview({
      answer: JSON.stringify({ counterexample: "", evidence: "", propertyId: "r2-02", summary: "s", verdict: "CLEAN" }),
      completedAtIso: "2026-09-14T01:30:00.000Z",
      now: CLEAN_NOW,
      receiptId: "rcpt-1",
      request: request(),
      requestBytes: "{}",
      reviewer: REVIEWER,
    });
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr()[0]).toContain('the response answered property "r2-02"');
  });

  it("REFUSES a BROKEN with no counterexample", () => {
    const result = validateFallbackReview({
      answer: JSON.stringify({
        counterexample: "",
        evidence: "e",
        propertyId: "r2-01",
        summary: "s",
        verdict: "BROKEN",
      }),
      completedAtIso: "2026-09-14T01:30:00.000Z",
      now: CLEAN_NOW,
      receiptId: "rcpt-1",
      request: request(),
      requestBytes: "{}",
      reviewer: REVIEWER,
    });
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr()).toContain("verdict BROKEN requires a concrete counterexample");
  });
});
