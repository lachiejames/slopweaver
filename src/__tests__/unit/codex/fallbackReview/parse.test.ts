/*
 * `parseFallbackRequest` / `parseFallbackReceipt`: both documents round-trip through JSON, and a request with a bad
 * pass or tree, or a receipt whose answer or reviewer would not have been recorded, is refused naming the field.
 */
import { describe, expect, it } from "vitest";

import { codexErrorLines } from "../../../../codex/errors.js";
import { parseFallbackReceipt, parseFallbackRequest } from "../../../../codex/fallbackReviewParse.js";
import { unwrap } from "../../../../lib/result.js";
import { BRANCH, HEAD, receiptFor, request } from "./harness.js";

describe("parseFallbackRequest / parseFallbackReceipt", () => {
  it("round-trips a request through JSON", () => {
    const req = request();
    expect(unwrap(parseFallbackRequest({ value: JSON.parse(JSON.stringify(req)) }))).toEqual(req);
  });

  it("refuses a request with a pass outside r1..r3 and names the field", () => {
    const result = parseFallbackRequest({ value: { ...request(), pass: "p2" } });
    expect(result.isErr()).toBe(true);
    expect(codexErrorLines({ error: result._unsafeUnwrapErr() })).toContain("pass must be r1, r2 or r3");
  });

  it("refuses a request whose tree is missing its fingerprint", () => {
    const result = parseFallbackRequest({ value: { ...request(), tree: { branch: BRANCH, headSha: HEAD } } });
    expect(result.isErr()).toBe(true);
    expect(codexErrorLines({ error: result._unsafeUnwrapErr() })).toContain(
      "tree must carry branch, fingerprint, headSha and dirtyBytes",
    );
  });

  it("round-trips a receipt through JSON", () => {
    const receipt = receiptFor();
    expect(unwrap(parseFallbackReceipt({ value: JSON.parse(JSON.stringify(receipt)) }))).toEqual(receipt);
  });

  it("refuses a receipt whose answer would not have passed the review validator", () => {
    const receipt = receiptFor();
    const result = parseFallbackReceipt({
      value: { ...receipt, answer: { ...receipt.answer, counterexample: "", evidence: "", verdict: "BROKEN" } },
    });
    expect(result.isErr()).toBe(true);
    expect(codexErrorLines({ error: result._unsafeUnwrapErr() })).toContain(
      "answer: verdict BROKEN requires a concrete counterexample",
    );
  });

  it("refuses a receipt from a host other than claude-code", () => {
    const receipt = receiptFor();
    const result = parseFallbackReceipt({ value: { ...receipt, reviewer: { ...receipt.reviewer, host: "codex" } } });
    expect(result.isErr()).toBe(true);
    expect(codexErrorLines({ error: result._unsafeUnwrapErr() })).toContain(
      "reviewer must carry host claude-code, workspace and model (each a string or null)",
    );
  });
});
