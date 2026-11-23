import { describe, expect, it } from "vitest";

import { classifySendFailure, slackPlatformErrorCode } from "../../../../outbound/slack/sendFailure.js";

/** The shape the Slack SDK throws for an `ok: false` answer: `WebAPIPlatformError`, read structurally. */
function platformError({ error }: { error: string }): Error {
  return Object.assign(new Error(`An API error occurred: ${error}`), {
    code: "slack_webapi_platform_error",
    data: { error, ok: false },
  });
}

/** The composite send's own failure, read structurally: what was posted, and whether it was retracted. */
function compositeError({
  deletedMessage,
  posted,
}: {
  deletedMessage: boolean;
  posted?: { channel: string; ts: string };
}): Error {
  return Object.assign(new Error("chat.update did not attach the media"), {
    deletedMessage,
    posted,
    uploadedFileIds: ["F1"],
  });
}

describe("slackPlatformErrorCode", () => {
  it("reads Slack's own error string off a platform rejection", () => {
    expect(slackPlatformErrorCode({ value: platformError({ error: "channel_not_found" }) })).toBe("channel_not_found");
  });

  it("is undefined for a plain Error — no `data` means Slack never answered", () => {
    expect(slackPlatformErrorCode({ value: new Error("ECONNRESET") })).toBe(undefined);
  });

  it("is undefined for a non-object throw", () => {
    expect(slackPlatformErrorCode({ value: "boom" })).toBe(undefined);
  });

  it("is undefined when `data.error` is empty", () => {
    expect(slackPlatformErrorCode({ value: { data: { error: "", ok: false } } })).toBe(undefined);
  });
});

describe("classifySendFailure", () => {
  it("is REJECTED when Slack itself answered `ok: false` — the measured channel_not_found case", () => {
    expect(classifySendFailure({ error: platformError({ error: "channel_not_found" }) })).toEqual({
      kind: "rejected",
      providerCode: "channel_not_found",
    });
  });

  it("is AMBIGUOUS for a transport failure — the request may have reached Slack", () => {
    expect(classifySendFailure({ error: new Error("ETIMEDOUT") })).toEqual({ kind: "ambiguous" });
  });

  it("is AMBIGUOUS for a non-Error throw", () => {
    expect(classifySendFailure({ error: undefined })).toEqual({ kind: "ambiguous" });
  });

  it("is RETRACTED when the composite send posted and then deleted the message", () => {
    const error = compositeError({ deletedMessage: true, posted: { channel: "C1", ts: "1700000000.000100" } });
    expect(classifySendFailure({ error })).toEqual({ kind: "retracted" });
  });

  it("is RETRACTED when the composite send failed before anything was posted", () => {
    expect(classifySendFailure({ error: compositeError({ deletedMessage: false }) })).toEqual({ kind: "retracted" });
  });

  it("is VISIBLE, carrying the ts, when the composite send posted and the retraction ALSO failed", () => {
    const error = compositeError({ deletedMessage: false, posted: { channel: "C1", ts: "1700000000.000100" } });
    expect(classifySendFailure({ error })).toEqual({ channel: "C1", kind: "visible", ts: "1700000000.000100" });
  });
});
