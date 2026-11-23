import { describe, expect, it } from "vitest";
import { GmailGuardErrors } from "../../../../live/gmail/guardedFetchErrors.js";

describe("GmailGuardErrors", () => {
  it("names the body a guard could not read as text", () => {
    expect(GmailGuardErrors.bodyNotUtf8()).toStrictEqual({
      code: "BODY_NOT_UTF8",
      message: "a request body that is not valid UTF-8, so what would be sent cannot be judged as text",
    });
    expect(GmailGuardErrors.bodyStreamed()).toStrictEqual({
      code: "BODY_STREAMED",
      message: "a streamed request body, which cannot be judged without consuming it",
    });
  });

  it("carries the status a refused draft re-read answered", () => {
    expect(GmailGuardErrors.draftReReadRefused({ status: 404 })).toStrictEqual({
      code: "DRAFT_REREAD_REFUSED",
      message: "the draft could not be re-read before sending: Gmail answered HTTP 404",
      status: 404,
    });
  });

  it("carries what the transport threw on a failed re-read, and says so when it threw no Error", () => {
    const cause = new Error("socket hang up");
    expect(GmailGuardErrors.draftReReadFailed({ cause })).toStrictEqual({
      cause,
      code: "DRAFT_REREAD_FAILED",
      message: "the draft could not be re-read before sending (socket hang up)",
    });
    expect(GmailGuardErrors.draftReReadFailed({ cause: "nope" })).toStrictEqual({
      cause: "nope",
      code: "DRAFT_REREAD_FAILED",
      message: "the draft could not be re-read before sending (an unknown transport failure)",
    });
  });

  it("names the reason a re-read or a send body could not be read", () => {
    expect(GmailGuardErrors.draftReReadMalformed({ reason: "message.raw is not a string" })).toStrictEqual({
      code: "DRAFT_REREAD_MALFORMED",
      message: "the draft re-read before sending could not be read: message.raw is not a string",
    });
    expect(GmailGuardErrors.draftWithoutRaw()).toStrictEqual({
      code: "DRAFT_WITHOUT_RAW",
      message: "the draft re-read before sending carried no message.raw",
    });
    expect(GmailGuardErrors.sendWithoutDraftId({ reason: "no id field" })).toStrictEqual({
      code: "SEND_WITHOUT_DRAFT_ID",
      message: "a send naming no draft id, so the draft cannot be re-read (no id field)",
    });
  });
});
