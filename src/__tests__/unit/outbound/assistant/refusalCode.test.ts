/**
 * The code a refused `assistant.threads.*` call is named by: Slack's own `error` when the body carries one,
 * `unreadable_response` for every body that does not. Pure.
 */
import { describe, expect, it } from "vitest";

import { assistantRefusalCode } from "../../../../outbound/assistant/refusalCode.js";

describe("assistantRefusalCode", () => {
  it("names Slack's own error code when the refusal carries one", () => {
    expect(assistantRefusalCode({ body: { error: "missing_scope", ok: false } })).toBe("missing_scope");
  });

  it("names a body that is not a JSON object as unreadable", () => {
    expect(assistantRefusalCode({ body: "<html>bad gateway</html>" })).toBe("unreadable_response");
  });

  it("names a record with no error field as unreadable", () => {
    expect(assistantRefusalCode({ body: { ok: false } })).toBe("unreadable_response");
  });

  it("names an empty error as unreadable rather than as an empty code", () => {
    expect(assistantRefusalCode({ body: { error: "", ok: false } })).toBe("unreadable_response");
  });

  it("names a non-string error as unreadable", () => {
    expect(assistantRefusalCode({ body: { error: 42, ok: false } })).toBe("unreadable_response");
  });
});
