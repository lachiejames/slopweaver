/*
 * What a plan call's stop may say (`site/lib/talkCallStop.ts`): nothing is the owner's hang-up, one bounded reason is the
 * crash the reloaded voice window ends it with, and anything else is refused rather than recorded.
 */
import { describe, expect, it } from "vitest";

import { HUNG_UP_REASON, parseTalkCallStopRequest } from "../../lib/talkCallStop";

describe("parseTalkCallStopRequest", () => {
  it("reads an empty body and an empty object as the owner's hang-up", () => {
    expect(parseTalkCallStopRequest({ raw: "" })).toEqual({ kind: "stop", reason: HUNG_UP_REASON });
    expect(parseTalkCallStopRequest({ raw: "{}" })).toEqual({ kind: "stop", reason: "the owner hung up" });
  });

  it("takes one reason, a bounded line, up to the bound", () => {
    const reason = "the voice window's renderer crashed (crashed, exit 133)";
    expect(parseTalkCallStopRequest({ raw: JSON.stringify({ reason }) })).toEqual({ kind: "stop", reason });
    const longest = "x".repeat(512);
    expect(parseTalkCallStopRequest({ raw: JSON.stringify({ reason: longest }) })).toEqual({
      kind: "stop",
      reason: longest,
    });
  });

  it("refuses a body that is not JSON, or not an object", () => {
    expect(parseTalkCallStopRequest({ raw: "stop" })).toEqual({ kind: "refused", why: "the body is not JSON" });
    expect(parseTalkCallStopRequest({ raw: "[]" })).toEqual({ kind: "refused", why: "the body is not an object" });
    expect(parseTalkCallStopRequest({ raw: "null" })).toEqual({ kind: "refused", why: "the body is not an object" });
  });

  it("refuses a reason past the bound, not a string, beside another key, or with any but printable ASCII", () => {
    const why = "the body carries anything but one reason, a single bounded line";
    const bodies = [
      { reason: "a\nb" },
      { reason: "a\u2028b" },
      { reason: "a\u2029b" },
      { reason: "a\u0085b" },
      { reason: "a\u001bb" },
      { reason: "x".repeat(513) },
      { reason: 1 },
      { reason: "crashed", by: "x" },
      { by: "crashed" },
      { reason: "ok\u202etxt" },
      { reason: "a\u200bb" },
      { reason: "\ufe0f" },
      { reason: "caf\u00e9" },
      { reason: "a\tb" },
    ];
    expect(bodies.map((body) => parseTalkCallStopRequest({ raw: JSON.stringify(body) }))).toEqual(
      bodies.map(() => ({ kind: "refused", why })),
    );
  });
});
