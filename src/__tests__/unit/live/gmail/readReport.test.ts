import { describe, expect, it } from "vitest";

import type { ParsedGmailMessage } from "../../../../live/gmail/parse.js";
import { messageResidue, readThreadId } from "../../../../live/gmail/readReport.js";

const message = (over: Partial<ParsedGmailMessage> = {}): ParsedGmailMessage => ({
  attachments: [],
  body: "hello",
  bodyFormat: "text",
  cc: [],
  from: undefined,
  htmlLinks: [],
  id: "m-1",
  labelIds: [],
  sentAtIso: undefined,
  snippet: undefined,
  subject: undefined,
  threadId: "t-1",
  to: [],
  ...over,
});

describe("readThreadId", () => {
  it("reports the requested address when the read retained no message", () => {
    expect(readThreadId({ address: "t-asked", messages: [] })).toBe("t-asked");
  });

  it("reports the first retained message's own thread id, not the address asked for", () => {
    const messages = [message({ id: "m-9", threadId: "t-9" }), message({ id: "m-10", threadId: "t-10" })];
    expect(readThreadId({ address: "m-9", messages })).toBe("t-9");
  });
});

describe("messageResidue", () => {
  it("owes nothing for plain-text messages with no attachments", () => {
    expect(messageResidue({ messages: [message()] })).toEqual([]);
  });

  it("owes nothing for an empty read", () => {
    expect(messageResidue({ messages: [] })).toEqual([]);
  });

  it("names attachments, HTML-flattened bodies and empty bodies, each counted across the read", () => {
    const attachment = { filename: "a.pdf", mimeType: "application/pdf", sizeBytes: 3 };
    const messages = [
      message({ attachments: [attachment, attachment], bodyFormat: "html" }),
      message({ attachments: [attachment], bodyFormat: "none" }),
      message({ bodyFormat: "none" }),
    ];
    expect(messageResidue({ messages })).toEqual([
      "3 attachment(s) reported by name, media type and size only — no bytes were downloaded",
      "1 message(s) had no plain-text alternative, so their body was flattened from HTML",
      "2 message(s) carried no readable text body at all",
    ]);
  });
});
