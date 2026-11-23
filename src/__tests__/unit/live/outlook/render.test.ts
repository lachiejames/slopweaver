/**
 * The Outlook verbs' read-side human output: pure text blocks, asserted line for line so a reworded marker or a
 * dropped notice is caught. The write-side blocks are in `renderWrites.test.ts`.
 */
import { describe, expect, it } from "vitest";
import type { OutlookAttachmentEntry, OutlookReadMessage } from "../../../../live/outlook/attachments.js";
import type { OutlookMessage, OutlookMessageSummary } from "../../../../live/outlook/messages.js";
import {
  renderOutlookCategoriesText,
  renderOutlookFoldersText,
  renderOutlookListingText,
  renderOutlookMessagesText,
} from "../../../../live/outlook/render.js";

/** A listing row with any field overridden. */
function summary({ id, over = {} }: { id: string; over?: Partial<OutlookMessageSummary> }): OutlookMessageSummary {
  return {
    categories: [],
    conversationId: "conv-1",
    folderId: "folder-inbox",
    from: { address: "sender@example.test", name: "Sender One" },
    hasAttachments: false,
    id,
    isRead: false,
    preview: "",
    receivedIso: "2026-10-01T09:00:00Z",
    subject: `Subject ${id}`,
    ...over,
  };
}

/** A full message with any field overridden. */
function full({ id, over = {} }: { id: string; over?: Partial<OutlookMessage> }): OutlookMessage {
  return {
    ...summary({ id }),
    bcc: [],
    body: `body of ${id}`,
    cc: [],
    isDraft: false,
    to: [{ address: "owner@example.test", name: null }],
    webLink: null,
    ...over,
  };
}

describe("renderOutlookListingText", () => {
  it("marks unread with * and read with a space, id on its own line", () => {
    const text = renderOutlookListingText({
      folder: "inbox",
      listing: {
        messages: [summary({ id: "m1" }), summary({ id: "m2", over: { hasAttachments: true, isRead: true } })],
        more: false,
        unreadFilteredLocally: false,
      },
    });

    expect(text.split("\n")).toEqual([
      "2 message(s) in inbox  (* = unread)",
      "* 2026-10-01T09:00:00Z  Sender One <sender@example.test>",
      "    Subject m1",
      "    id: m1",
      "  2026-10-01T09:00:00Z  Sender One <sender@example.test>",
      "    Subject m2  [attachments]",
      "    id: m2",
    ]);
  });

  it("names a missing sender, subject and date", () => {
    const text = renderOutlookListingText({
      folder: "inbox",
      listing: {
        messages: [summary({ id: "m1", over: { from: null, receivedIso: null, subject: null } })],
        more: false,
        unreadFilteredLocally: false,
      },
    });

    expect(text).toContain("* (no date)  (no sender)");
    expect(text).toContain("    (no subject)");
  });

  it("says when unread was filtered locally and when more matches exist", () => {
    const text = renderOutlookListingText({
      folder: "inbox",
      listing: { messages: [], more: true, unreadFilteredLocally: true },
    });

    expect(text.split("\n")).toEqual([
      "0 message(s) in inbox  (* = unread)",
      "unread was filtered over the fetched search results, so fewer than --limit may be shown",
      "more messages match — raise --limit or narrow --query",
    ]);
  });
});

/** A message as `outlook read` shows it, with no attachments unless given. */
function shown({
  message,
  attachments = [],
}: {
  message: OutlookMessage;
  attachments?: readonly OutlookAttachmentEntry[];
}): OutlookReadMessage {
  return { attachments, message };
}

describe("renderOutlookMessagesText", () => {
  it("renders one message as headers, each attachment by name and id, a blank line, then the body", () => {
    const text = renderOutlookMessagesText({
      messages: [
        shown({
          attachments: [
            {
              attachmentId: "att-1",
              contentType: "text/plain",
              kind: "fileAttachment",
              name: "notes.txt",
              sizeBytes: 22,
            },
            { attachmentId: "att-2", contentType: null, kind: "fileAttachment", name: null, sizeBytes: null },
            { attachmentId: "att-3", contentType: null, kind: "itemAttachment", name: "Fwd: plan", sizeBytes: 900 },
          ],
          message: full({
            id: "m1",
            over: { categories: ["Done"], cc: [{ address: "cc@example.test", name: null }], hasAttachments: true },
          }),
        }),
      ],
    });

    expect(text.split("\n")).toEqual([
      "from: Sender One <sender@example.test>",
      "to: owner@example.test",
      "cc: cc@example.test",
      "subject: Subject m1",
      "received: 2026-10-01T09:00:00Z",
      "id: m1",
      "categories: Done",
      "attachment: notes.txt (text/plain, 22 bytes, not downloaded)  id: att-1",
      "attachment (no name, save it by id): (unknown type, size unknown, not downloaded)  id: att-2",
      "attachment: Fwd: plan [itemAttachment] — not a file, so it cannot be saved  id: att-3",
      "save one: `slopweaver outlook attachment m1 --name <file>` (or --attachment-id <id>)",
      "",
      "body of m1",
    ]);
  });

  it("never prints a name carrying a line break, which could forge the nameless line", () => {
    const forged = "a.txt\nattachment (no name, save it by id):";
    const text = renderOutlookMessagesText({
      messages: [
        shown({
          attachments: [
            { attachmentId: "att-9", contentType: "text/plain", kind: "fileAttachment", name: forged, sizeBytes: 4 },
          ],
          message: full({ id: "m1" }),
        }),
      ],
    });

    expect(text).toContain(
      "attachment (name has control characters, save it by id): (text/plain, 4 bytes, not downloaded)  id: att-9",
    );
    expect(text).not.toContain(forged);
  });

  it.each([
    ["a right-to-left override", "report‮fdp.exe"],
    ["a zero-width space", "invoice​.pdf"],
    ["a line separator", "a.txt attachment (no name, save it by id):"],
  ])("never prints a name carrying %s, which could disguise what it is", (_label, name) => {
    const text = renderOutlookMessagesText({
      messages: [
        shown({
          attachments: [
            { attachmentId: "att-9", contentType: "text/plain", kind: "fileAttachment", name, sizeBytes: 4 },
          ],
          message: full({ id: "m1" }),
        }),
      ],
    });

    expect(text).toContain(
      "attachment (name has control characters, save it by id): (text/plain, 4 bytes, not downloaded)  id: att-9",
    );
    expect(text).not.toContain(name);
  });

  it("omits cc, categories and attachment lines when there are none", () => {
    const text = renderOutlookMessagesText({ messages: [shown({ message: full({ id: "m1" }) })] });

    expect(text).not.toContain("cc:");
    expect(text).not.toContain("categories:");
    expect(text).not.toContain("attachment");
  });

  it("numbers a conversation and separates its messages", () => {
    const text = renderOutlookMessagesText({
      messages: [shown({ message: full({ id: "m1" }) }), shown({ message: full({ id: "m2" }) })],
    });

    expect(text).toContain("--- 1 of 2 ---\nfrom:");
    expect(text).toContain("body of m1\n\n--- 2 of 2 ---");
  });
});

describe("renderOutlookFoldersText and renderOutlookCategoriesText", () => {
  it("writes each folder's path, counters and id, and says a truncated walk is a prefix", () => {
    const text = renderOutlookFoldersText({
      walk: {
        folders: [
          {
            childFolderCount: 1,
            displayName: "Inbox",
            id: "f1",
            parentFolderId: null,
            path: ["Inbox"],
            totalItemCount: 3,
            unreadItemCount: 2,
          },
          {
            childFolderCount: 0,
            displayName: "Receipts",
            id: "f2",
            parentFolderId: "f1",
            path: ["Inbox", "Receipts"],
            totalItemCount: 5,
            unreadItemCount: 0,
          },
        ],
        truncated: true,
      },
    });

    expect(text.split("\n")).toEqual([
      "Inbox  3 total, 2 unread  id: f1",
      "Inbox/Receipts  5 total, 0 unread  id: f2",
      "the folder walk stopped at its page ceiling — this list is a prefix of the hierarchy",
    ]);
  });

  it("lists categories with colour and id", () => {
    expect(
      renderOutlookCategoriesText({ categories: [{ color: "preset0", displayName: "Waiting on", id: "cat-1" }] }),
    ).toBe("Waiting on  (preset0)  id: cat-1");
  });

  it("says so when the mailbox defines no categories", () => {
    expect(renderOutlookCategoriesText({ categories: [] })).toBe("no categories defined in this mailbox");
  });
});
