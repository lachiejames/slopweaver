/**
 * Unit: projecting Outlook messages into corpus records. Three claims carry the weight: the container is read
 * off the SENDER, never the folder; nothing the owner changes by filing reaches the record, so a move mints no
 * second version; and every lossy or declined step is counted into a warning rather than dropped silently.
 * Every value is synthetic.
 */
import { describe, expect, it } from "vitest";

import {
  outlookMailContainer,
  outlookMessageTsIso,
  projectOutlookMessage,
  projectOutlookMessages,
} from "../../../../corpus/outlook/project.js";
import type { CorpusRecord } from "../../../../corpus/types.js";
import { FAKE_OUTLOOK_ACCOUNT, wireMessage } from "../../../fakeOutlookMailbox.js";

/** The record a message projects to, failing loudly when it was declined. */
function recordOf({ message }: { message: ReturnType<typeof wireMessage> }): CorpusRecord {
  const projected = projectOutlookMessage({ account: FAKE_OUTLOOK_ACCOUNT, message });
  if (projected.kind !== "record") {
    throw new Error(`expected a record, got a decline: ${projected.reason}`);
  }
  return projected.record;
}

describe("outlookMailContainer", () => {
  it("reads mail/sent when the connected account sent it, whatever the address's case", () => {
    const message = wireMessage({
      id: "m-1",
      over: { from: { emailAddress: { address: "  OWNER@Example.Test ", name: "Owner" } } },
    });
    expect(outlookMailContainer({ account: FAKE_OUTLOOK_ACCOUNT, message })).toBe("mail/sent");
  });

  it("reads mail/received for anyone else's mail", () => {
    expect(outlookMailContainer({ account: FAKE_OUTLOOK_ACCOUNT, message: wireMessage({ id: "m-1" }) })).toBe(
      "mail/received",
    );
  });

  it("falls back to the sender when there is no from", () => {
    const message = wireMessage({
      id: "m-1",
      over: { from: null, sender: { emailAddress: { address: FAKE_OUTLOOK_ACCOUNT } } },
    });
    expect(outlookMailContainer({ account: FAKE_OUTLOOK_ACCOUNT, message })).toBe("mail/sent");
  });
});

describe("outlookMessageTsIso", () => {
  it("dates by the sent time first, as a canonical instant", () => {
    const message = wireMessage({ id: "m-1", over: { sentDateTime: "2026-09-30T08:00:00Z" } });
    expect(outlookMessageTsIso({ message })).toBe("2026-09-30T08:00:00.000Z");
  });

  it("falls to the received time when the sent time does not parse", () => {
    const message = wireMessage({ id: "m-1", over: { sentDateTime: "not a time" } });
    expect(outlookMessageTsIso({ message })).toBe("2026-10-01T09:00:00.000Z");
  });

  it("answers nothing when neither stamp parses", () => {
    const message = wireMessage({ id: "m-1", over: { receivedDateTime: null, sentDateTime: null } });
    expect(outlookMessageTsIso({ message })).toBeUndefined();
  });
});

describe("projectOutlookMessage", () => {
  it("projects a received message, private, keyed by its immutable id, with a name and never an address as author", () => {
    const record = recordOf({ message: wireMessage({ id: "m-1" }) });
    expect(record.source).toBe("outlook");
    expect(record.kind).toBe("message");
    expect(record.sourceId).toBe("m-1");
    expect(record.container).toBe("mail/received");
    expect(record.author).toBe("Sender One");
    expect(record.title).toBe("Synthetic subject m-1");
    expect(record.text).toBe("synthetic body of m-1");
    expect(record.url).toBe("https://outlook.example.test/m-1");
    expect(record.tsIso).toBe("2026-10-01T09:00:00.000Z");
    expect(record.visibility).toBe("private");
  });

  it("carries the sender and recipients as header lines, counted, and nothing the owner changes by filing", () => {
    const record = recordOf({
      message: wireMessage({ id: "m-1", over: { categories: ["Waiting on"], isRead: true } }),
    });
    expect(record.attrs).toStrictEqual({
      conversationId: "conv-1",
      from: "Sender One <sender@example.test>",
      hasAttachments: false,
      quotedCharsDropped: 0,
      recipientCount: 1,
      to: [FAKE_OUTLOOK_ACCOUNT],
    });
  });

  it("projects the same record whichever folder the message sits in, so a move mints no second version", () => {
    const inInbox = recordOf({ message: wireMessage({ id: "m-1", over: { parentFolderId: "folder-inbox" } }) });
    const inArchive = recordOf({ message: wireMessage({ id: "m-1", over: { parentFolderId: "folder-archive" } }) });
    expect(inArchive).toStrictEqual(inInbox);
  });

  it("stores no body for a message Graph answered as HTML, and says so", () => {
    const projected = projectOutlookMessage({
      account: FAKE_OUTLOOK_ACCOUNT,
      message: wireMessage({ id: "m-1", over: { body: { content: "<p>synthetic</p>", contentType: "html" } } }),
    });
    expect(projected).toMatchObject({ htmlBody: true, kind: "record", record: { text: "" } });
  });

  it("stores an empty url for a message with no web link, and says so", () => {
    const projected = projectOutlookMessage({
      account: FAKE_OUTLOOK_ACCOUNT,
      message: wireMessage({ id: "m-1", over: { webLink: null } }),
    });
    expect(projected).toMatchObject({ kind: "record", linkless: true, record: { url: "" } });
  });

  it("declines a draft and an undated message", () => {
    const draft = projectOutlookMessage({
      account: FAKE_OUTLOOK_ACCOUNT,
      message: wireMessage({ id: "m-1", over: { isDraft: true } }),
    });
    const undated = projectOutlookMessage({
      account: FAKE_OUTLOOK_ACCOUNT,
      message: wireMessage({ id: "m-2", over: { receivedDateTime: null } }),
    });
    expect([draft, undated]).toStrictEqual([
      { kind: "declined", reason: "draft" },
      { kind: "declined", reason: "undated" },
    ]);
  });
});

describe("projectOutlookMessages", () => {
  it("keeps every storable message and counts each decline and lossy step into one warning", () => {
    const projected = projectOutlookMessages({
      account: FAKE_OUTLOOK_ACCOUNT,
      messages: [
        wireMessage({ id: "kept" }),
        wireMessage({ id: "html", over: { body: { content: "<p>x</p>", contentType: "html" } } }),
        wireMessage({ id: "linkless", over: { webLink: null } }),
        wireMessage({ id: "draft", over: { isDraft: true } }),
        wireMessage({ id: "undated", over: { receivedDateTime: null } }),
      ],
    });
    expect(projected.records.map((record) => record.sourceId)).toEqual(["kept", "html", "linkless"]);
    expect(projected.warnings).toEqual([
      "1 Outlook message(s) carried no usable sent or received time and were not stored",
      "1 Outlook message(s) came back as HTML despite the text preference and were stored with no body",
      "1 Outlook message(s) carried no web link; re-read them by id with `slopweaver outlook read`",
      "1 Outlook draft(s) outside the Drafts folder were not stored",
    ]);
  });

  it("warns about nothing when every message stores cleanly", () => {
    const projected = projectOutlookMessages({ account: FAKE_OUTLOOK_ACCOUNT, messages: [wireMessage({ id: "a" })] });
    expect(projected.warnings).toEqual([]);
    expect(projected.records.length).toBe(1);
  });
});
