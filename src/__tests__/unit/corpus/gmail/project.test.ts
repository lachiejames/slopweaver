import { describe, expect, it } from "vitest";

import {
  gmailContainer,
  gmailPermalink,
  MAX_STORED_RECIPIENTS,
  projectGmailMessage,
  projectGmailMessages,
  senderName,
} from "../../../../corpus/gmail/project.js";
import { redactRecord } from "../../../../corpus/redactRecord.js";
import type { ParsedGmailMessage } from "../../../../live/gmail/parse.js";

const message = (over: Partial<ParsedGmailMessage> = {}): ParsedGmailMessage => ({
  attachments: [],
  body: "the body",
  bodyFormat: "text",
  htmlLinks: [],
  cc: [],
  from: "Jane Smith <jane@example.test>",
  id: "m1",
  labelIds: ["CATEGORY_PERSONAL"],
  sentAtIso: "2026-08-01T10:00:00.000Z",
  snippet: "the body",
  subject: "a subject",
  threadId: "t1",
  to: ["me@example.test"],
  ...over,
});

describe("senderName", () => {
  it("takes the display name from an angle-bracket header", () => {
    expect(senderName({ header: "Jane Smith <jane@example.test>" })).toBe("Jane Smith");
  });

  it("unquotes a quoted display name", () => {
    expect(senderName({ header: '"Smith, Jane" <jane@example.test>' })).toBe("Smith, Jane");
  });

  it("falls back to the local part when a header carries only an address", () => {
    expect(senderName({ header: "jane.smith@example.test" })).toBe("jane.smith");
  });

  it("falls back to the local part when the display name is empty", () => {
    expect(senderName({ header: "  <jane@example.test>" })).toBe("jane");
  });

  it("is undefined for an absent header", () => {
    expect(senderName({ header: undefined })).toBeUndefined();
  });

  it("takes the LAST angle pair, so a bracket inside a display name does not swallow the address", () => {
    expect(senderName({ header: '"Jane <the boss>" <jane@example.test>' })).toBe("Jane <the boss>");
  });

  it("treats a header that never closes its bracket as a bare address, and takes its local part", () => {
    expect(senderName({ header: "jane@example.test <not-closed" })).toBe("jane");
  });

  it("is undefined for a header with nothing in it", () => {
    expect(senderName({ header: "   " })).toBeUndefined();
  });
});

describe("gmailContainer", () => {
  it("buckets a delivery category", () => {
    expect(gmailContainer({ labelIds: ["IMPORTANT", "CATEGORY_UPDATES"] })).toBe("mail/updates");
  });

  it("lets SENT win over a delivery category", () => {
    expect(gmailContainer({ labelIds: ["SENT", "CATEGORY_PERSONAL"] })).toBe("mail/sent");
  });

  it("buckets a message with no category at all", () => {
    expect(gmailContainer({ labelIds: ["UNREAD"] })).toBe("mail/other");
  });

  it("buckets a message with no labels at all", () => {
    expect(gmailContainer({ labelIds: [] })).toBe("mail/other");
  });
});

describe("gmailPermalink", () => {
  it("addresses the all-mail view so an archived message still resolves", () => {
    expect(gmailPermalink({ id: "abc123" })).toBe("https://mail.google.com/mail/u/0/#all/abc123");
  });
});

describe("projectGmailMessage", () => {
  it("projects the message onto the corpus atom", () => {
    const record = projectGmailMessage({ message: message() })!;
    expect(record.source).toBe("gmail");
    expect(record.kind).toBe("message");
    expect(record.sourceId).toBe("m1");
    expect(record.tsIso).toBe("2026-08-01T10:00:00.000Z");
    expect(record.container).toBe("mail/personal");
    expect(record.title).toBe("a subject");
    expect(record.text).toBe("the body");
    expect(record.url).toBe("https://mail.google.com/mail/u/0/#all/m1");
  });

  it("stamps every mail record private, because a mailbox has no public lane", () => {
    expect(projectGmailMessage({ message: message() })!.visibility).toBe("private");
  });

  it("puts the sender's NAME on author and the full header on attrs, never the address on author", () => {
    const record = projectGmailMessage({ message: message() })!;
    expect(record.author).toBe("Jane Smith");
    expect(record.attrs!["from"]).toBe("Jane Smith <jane@example.test>");
  });

  it("survives the bronze write path with the address scrubbed and the name kept", () => {
    const written = redactRecord({ record: projectGmailMessage({ message: message() })! });
    expect(written.author).toBe("Jane Smith");
    expect(written.attrs!["from"]).toBe("Jane Smith <[email]>");
    expect(written.attrs!["to"]).toStrictEqual(["[email]"]);
  });

  it("drops the labels that change when the owner merely reads or files a message", () => {
    const record = projectGmailMessage({
      message: message({ labelIds: ["UNREAD", "INBOX", "STARRED", "IMPORTANT", "CATEGORY_UPDATES", "Label_9"] }),
    })!;
    expect(record.attrs!["labels"]).toStrictEqual(["CATEGORY_UPDATES", "Label_9"]);
  });

  it("omits labels entirely when only volatile ones were present", () => {
    const record = projectGmailMessage({ message: message({ labelIds: ["UNREAD", "INBOX"] }) })!;
    expect(record.attrs!["labels"]).toBeUndefined();
  });

  it("strips the quoted tail and records what that cost", () => {
    const record = projectGmailMessage({
      message: message({ body: "Yes.\n\n> the whole earlier thread" }),
    })!;
    expect(record.text).toBe("Yes.");
    expect(record.attrs!["quotedCharsDropped"]).toBe(28);
  });

  it("reports attachments by name, media type and size", () => {
    const record = projectGmailMessage({
      message: message({
        attachments: [{ filename: "spec.pdf", mimeType: "application/pdf", sizeBytes: 4096 }],
      }),
    })!;
    expect(record.attrs!["attachmentCount"]).toBe(1);
    expect(record.attrs!["attachments"]).toStrictEqual(["spec.pdf (application/pdf, 4096 bytes)"]);
  });

  it("always records the true recipient count, even when it stores every recipient", () => {
    const record = projectGmailMessage({ message: message({ cc: ["c@example.test"] }) })!;
    expect(record.attrs!["recipientCount"]).toBe(2);
  });

  it("bounds a distribution list to the stored maximum and keeps the true count beside it", () => {
    const many = Array.from({ length: 63 }, (_unused, index) => `person${String(index)}@example.test`);
    const record = projectGmailMessage({ message: message({ to: many }) })!;
    expect((record.attrs!["to"] as readonly string[]).length).toBe(MAX_STORED_RECIPIENTS);
    expect(record.attrs!["recipientCount"]).toBe(63);
  });

  it("carries no raw payload at all", () => {
    expect(projectGmailMessage({ message: message() })!.raw).toBeUndefined();
  });

  it("declines a message with no send time rather than dating it from the clock", () => {
    expect(projectGmailMessage({ message: message({ sentAtIso: undefined }) })).toBeUndefined();
  });
});

describe("projectGmailMessages", () => {
  it("names each undatable message in a warning instead of dropping it silently", () => {
    const projected = projectGmailMessages({
      messages: [message(), message({ id: "m2", sentAtIso: undefined })],
    });
    expect(projected.records.length).toBe(1);
    expect(projected.warnings).toStrictEqual(["message m2: no readable send time, so it was not projected"]);
  });
});
