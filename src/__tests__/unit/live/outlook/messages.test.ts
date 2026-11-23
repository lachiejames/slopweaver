/**
 * Reading Outlook messages over the fake mailbox: address formatting, the field refusals, the plain and
 * search listings (including the local unread filter's honesty flag), and thread order.
 */
import { describe, expect, it } from "vitest";
import { unwrap, unwrapErr } from "../../../../lib/result.js";
import {
  formatOutlookAddress,
  listOutlookMessages,
  readOutlookMessage,
  readOutlookThread,
  threadOrder,
  toMessage,
  toSummary,
} from "../../../../live/outlook/messages.js";
import { fakeMailbox, fakeOutlookApi, wireMessage } from "../../../fakeOutlookMailbox.js";

describe("formatOutlookAddress", () => {
  it("writes Name <addr> when both halves are there", () => {
    expect(formatOutlookAddress({ address: { address: "a@example.test", name: "Alex Example" } })).toBe(
      "Alex Example <a@example.test>",
    );
  });

  it("writes the bare address when there is no name", () => {
    expect(formatOutlookAddress({ address: { address: "a@example.test", name: null } })).toBe("a@example.test");
  });

  it("marks a name with no address", () => {
    expect(formatOutlookAddress({ address: { address: null, name: "Alex Example" } })).toBe(
      "Alex Example (no address)",
    );
  });

  it("marks neither", () => {
    expect(formatOutlookAddress({ address: { address: null, name: null } })).toBe("(no address)");
  });
});

describe("toSummary and toMessage", () => {
  it("maps a full wire message to the door's shape", () => {
    const summary = unwrap(
      toSummary({ message: wireMessage({ id: "m1", over: { categories: ["Done"] } }), operation: "test.op" }),
    );

    expect(summary).toEqual({
      categories: ["Done"],
      conversationId: "conv-1",
      folderId: "folder-inbox",
      from: { address: "sender@example.test", name: "Sender One" },
      hasAttachments: false,
      id: "m1",
      isRead: false,
      preview: "synthetic preview of m1",
      receivedIso: "2026-10-01T09:00:00Z",
      subject: "Synthetic subject m1",
    });
  });

  it("reads an absent sender and subject as null rather than refusing", () => {
    const summary = unwrap(
      toSummary({ message: wireMessage({ id: "m1", over: { from: null, subject: null } }), operation: "test.op" }),
    );

    expect(summary.from).toBe(null);
    expect(summary.subject).toBe(null);
  });

  it("refuses a missing conversationId, naming the field and the operation", () => {
    const refused = toSummary({
      message: wireMessage({ id: "m1", over: { conversationId: undefined } }),
      operation: "test.op",
    });

    expect(refused.isErr()).toBe(true);
    const error = unwrapErr(refused);
    expect(error.code).toBe("RESPONSE_FIELD_MISSING");
    expect(error.message).toContain("conversationId");
    expect(error.message).toContain("test.op");
  });

  it("refuses a missing parentFolderId", () => {
    const refused = toSummary({
      message: wireMessage({ id: "m1", over: { parentFolderId: undefined } }),
      operation: "test.op",
    });

    expect(unwrapErr(refused).code).toBe("RESPONSE_FIELD_MISSING");
    expect(unwrapErr(refused).message).toContain("parentFolderId");
  });

  it("refuses a missing isRead", () => {
    const refused = toSummary({
      message: wireMessage({ id: "m1", over: { isRead: undefined } }),
      operation: "test.op",
    });

    expect(unwrapErr(refused).code).toBe("RESPONSE_FIELD_MISSING");
    expect(unwrapErr(refused).message).toContain("isRead");
  });

  it("maps a full message with its recipients, body and draft flag", () => {
    const message = unwrap(
      toMessage({
        message: wireMessage({
          id: "m1",
          over: {
            ccRecipients: [{ emailAddress: { address: "cc@example.test", name: "Carol" } }],
            toRecipients: [{ emailAddress: { address: "to@example.test" } }, { emailAddress: { address: null } }],
          },
        }),
        operation: "test.op",
      }),
    );

    expect(message.body).toBe("synthetic body of m1");
    expect(message.to).toEqual([
      { address: "to@example.test", name: null },
      { address: null, name: null },
    ]);
    expect(message.cc).toEqual([{ address: "cc@example.test", name: "Carol" }]);
    expect(message.bcc).toEqual([]);
    expect(message.isDraft).toBe(false);
    expect(message.webLink).toBe("https://outlook.example.test/m1");
  });

  it("refuses a message with no body", () => {
    const refused = toMessage({ message: wireMessage({ id: "m1", over: { body: undefined } }), operation: "test.op" });

    expect(unwrapErr(refused).code).toBe("RESPONSE_FIELD_MISSING");
    expect(unwrapErr(refused).message).toContain("body/recipients");
  });

  it("refuses a message with no isDraft", () => {
    const refused = toMessage({
      message: wireMessage({ id: "m1", over: { isDraft: undefined } }),
      operation: "test.op",
    });

    expect(unwrapErr(refused).code).toBe("RESPONSE_FIELD_MISSING");
    expect(unwrapErr(refused).message).toContain("isDraft");
  });

  it("passes a summary-level refusal straight through", () => {
    const refused = toMessage({
      message: wireMessage({ id: "m1", over: { conversationId: undefined } }),
      operation: "test.op",
    });

    expect(unwrapErr(refused).message).toContain("conversationId");
  });
});

describe("listOutlookMessages", () => {
  it("lists a folder plainly, answering what the seam answered", async () => {
    const mailbox = fakeMailbox({
      messages: [
        wireMessage({ id: "old", over: { receivedDateTime: "2026-10-01T09:00:00Z" } }),
        wireMessage({ id: "new", over: { receivedDateTime: "2026-10-02T09:00:00Z" } }),
      ],
    });

    const listing = unwrap(
      await listOutlookMessages({
        api: fakeOutlookApi({ mailbox }),
        folderId: "inbox",
        limit: 10,
        query: undefined,
        unreadOnly: false,
      }),
    );

    expect(listing.messages.map((message) => message.id)).toEqual(["new", "old"]);
    expect(listing.unreadFilteredLocally).toBe(false);
    expect(listing.more).toBe(false);
  });

  it("asks the seam for unread messages and keeps the newest-first order it answers", async () => {
    const mailbox = fakeMailbox({
      messages: [
        wireMessage({ id: "read-newest", over: { isRead: true, receivedDateTime: "2026-10-04T09:00:00Z" } }),
        wireMessage({ id: "b", over: { isRead: false, receivedDateTime: "2026-10-02T09:00:00Z" } }),
        wireMessage({ id: "c", over: { isRead: false, receivedDateTime: "2026-10-03T09:00:00Z" } }),
      ],
    });

    const listing = unwrap(
      await listOutlookMessages({
        api: fakeOutlookApi({ mailbox }),
        folderId: "inbox",
        limit: 10,
        query: undefined,
        unreadOnly: true,
      }),
    );

    expect(listing.messages.map((message) => message.id)).toEqual(["c", "b"]);
    expect(listing.unreadFilteredLocally).toBe(false);
  });

  it("searches, filters unread locally, and says the result may have underfilled", async () => {
    const mailbox = fakeMailbox({
      messages: [
        wireMessage({ id: "read-hit", over: { isRead: true, subject: "Budget review" } }),
        wireMessage({ id: "unread-hit", over: { isRead: false, subject: "Budget forecast" } }),
        wireMessage({ id: "miss", over: { isRead: false, subject: "Lunch plans" } }),
      ],
    });

    const listing = unwrap(
      await listOutlookMessages({
        api: fakeOutlookApi({ mailbox }),
        folderId: "inbox",
        limit: 10,
        query: "Budget",
        unreadOnly: true,
      }),
    );

    expect(listing.messages.map((message) => message.id)).toEqual(["unread-hit"]);
    expect(listing.unreadFilteredLocally).toBe(true);
    expect(listing.more).toBe(false);
  });

  it("searches without an unread filter and does not flag local filtering", async () => {
    const mailbox = fakeMailbox({
      messages: [
        wireMessage({ id: "read-hit", over: { isRead: true, subject: "Budget review" } }),
        wireMessage({ id: "unread-hit", over: { isRead: false, subject: "Budget forecast" } }),
      ],
    });

    const listing = unwrap(
      await listOutlookMessages({
        api: fakeOutlookApi({ mailbox }),
        folderId: "inbox",
        limit: 10,
        query: "Budget",
        unreadOnly: false,
      }),
    );

    expect(listing.messages.map((message) => message.id)).toEqual(["read-hit", "unread-hit"]);
    expect(listing.unreadFilteredLocally).toBe(false);
  });

  it("truncates a search to the limit and reports more behind it", async () => {
    const mailbox = fakeMailbox({
      messages: [wireMessage({ id: "s1" }), wireMessage({ id: "s2" }), wireMessage({ id: "s3" })],
    });

    const listing = unwrap(
      await listOutlookMessages({
        api: fakeOutlookApi({ mailbox }),
        folderId: "inbox",
        limit: 2,
        query: "Synthetic",
        unreadOnly: false,
      }),
    );

    expect(listing.messages.map((message) => message.id)).toEqual(["s1", "s2"]);
    expect(listing.more).toBe(true);
  });

  it("refuses a listing row missing a selected field", async () => {
    const mailbox = fakeMailbox({ messages: [wireMessage({ id: "bad", over: { conversationId: undefined } })] });

    const refused = await listOutlookMessages({
      api: fakeOutlookApi({ mailbox }),
      folderId: "inbox",
      limit: 10,
      query: undefined,
      unreadOnly: false,
    });

    expect(refused.isErr()).toBe(true);
    expect(unwrapErr(refused).code).toBe("RESPONSE_FIELD_MISSING");
  });
});

describe("readOutlookMessage", () => {
  it("reads one message in full", async () => {
    const mailbox = fakeMailbox({ messages: [wireMessage({ id: "m1" })] });

    const message = unwrap(await readOutlookMessage({ api: fakeOutlookApi({ mailbox }), id: "m1" }));

    expect(message.id).toBe("m1");
    expect(message.body).toBe("synthetic body of m1");
  });

  it("passes a failed read through", async () => {
    const refused = await readOutlookMessage({ api: fakeOutlookApi({ mailbox: fakeMailbox() }), id: "absent" });

    expect(unwrapErr(refused).code).toBe("API_FAILED");
    expect(unwrapErr(refused).message).toContain("absent");
  });
});

describe("readOutlookThread and threadOrder", () => {
  it("reads a conversation oldest first and leaves other conversations out", async () => {
    const mailbox = fakeMailbox({
      messages: [
        wireMessage({ id: "t3", over: { receivedDateTime: "2026-10-03T09:00:00Z" } }),
        wireMessage({ id: "t1", over: { receivedDateTime: "2026-10-01T09:00:00Z" } }),
        wireMessage({ id: "other", over: { conversationId: "conv-2" } }),
        wireMessage({ id: "t2", over: { receivedDateTime: "2026-10-02T09:00:00Z" } }),
      ],
    });

    const thread = unwrap(await readOutlookThread({ api: fakeOutlookApi({ mailbox }), conversationId: "conv-1" }));

    expect(thread.map((message) => message.id)).toEqual(["t1", "t2", "t3"]);
  });

  it("refuses a thread holding a message that lacks a field", async () => {
    const mailbox = fakeMailbox({ messages: [wireMessage({ id: "bad", over: { isDraft: undefined } })] });

    const refused = await readOutlookThread({ api: fakeOutlookApi({ mailbox }), conversationId: "conv-1" });

    expect(unwrapErr(refused).code).toBe("RESPONSE_FIELD_MISSING");
  });

  it("breaks a tie on received time by id, and sorts an undated draft first", () => {
    const build = ({ id, receivedDateTime }: { id: string; receivedDateTime: string | null }) =>
      unwrap(toMessage({ message: wireMessage({ id, over: { receivedDateTime } }), operation: "test.op" }));

    const ordered = threadOrder({
      messages: [
        build({ id: "b", receivedDateTime: "2026-10-01T09:00:00Z" }),
        build({ id: "z-draft", receivedDateTime: null }),
        build({ id: "a", receivedDateTime: "2026-10-01T09:00:00Z" }),
      ],
    });

    expect(ordered.map((message) => message.id)).toEqual(["z-draft", "a", "b"]);
  });
});
