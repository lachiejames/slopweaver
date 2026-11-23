/**
 * The codex directory's typed failures print exactly what the `readonly string[]` they replaced printed: one
 * line per accumulated document problem, and the message otherwise.
 */
import { describe, expect, it } from "vitest";
import { CodexErrors, codexErrorLines } from "../../../codex/errors.js";

describe("codexErrorLines", () => {
  it("gives each reason a refused fallback document carries its own line", () => {
    const reasons = ["schemaVersion must be 1", "pass must be r1, r2 or r3"];
    expect(codexErrorLines({ error: CodexErrors.documentInvalid({ reasons }) })).toEqual(reasons);
  });

  it("gives a single-message variant its message", () => {
    expect(codexErrorLines({ error: CodexErrors.boundTooLarge({ boundSeconds: 90_000, max: 86_400 }) })).toEqual([
      "--bound-seconds must be at most 86400 (24h), got 90000",
    ]);
  });
});

describe("CodexErrors", () => {
  it("prefixes every reason of a refused request with its kind and id", () => {
    expect(
      CodexErrors.requestInvalid({ kind: "plan", reasons: ["tree must be an object"], requestId: "req-1" }),
    ).toEqual({
      code: "FALLBACK_DOCUMENT_INVALID",
      message: "fallback plan request req-1: tree must be an object",
      reasons: ["fallback plan request req-1: tree must be an object"],
    });
  });

  it("names a review request read as a plan by its own kind", () => {
    expect(CodexErrors.requestKindMismatch({ declared: undefined, requestId: "req-2", wanted: "plan" }).message).toBe(
      "fallback request req-2 is a review request, not a plan one",
    );
  });

  it("says a receipt that is not JSON with the parser's own words", () => {
    expect(CodexErrors.documentNotJson({ cause: new Error("Unexpected token"), label: "r.json" }).message).toBe(
      "r.json: not JSON: Unexpected token",
    );
  });
});
