/**
 * Unit: each Gmail field a successful response may leave out, read by its own function. Where the type admits
 * both spellings of "left out" — an omitted key and `null` — they read the same way, and a present value
 * comes back as the very value Gmail sent.
 */
import { describe, expect, it } from "vitest";
import {
  addedMessages,
  childParts,
  historyRecords,
  listedMessages,
  messageLabelIds,
  nextPageCursor,
  threadReadBack,
} from "../../../../live/gmail/omittedFields.js";

describe("addedMessages", () => {
  it("reads a record of another kind of change as adding no message", () => {
    expect(addedMessages({ record: { id: "h1" } })).toStrictEqual([]);
  });

  it("returns the record's own added list when it reports an addition", () => {
    const messagesAdded = [{ message: { id: "m1", threadId: "t1" } }];
    expect(addedMessages({ record: { id: "h1", messagesAdded } })).toBe(messagesAdded);
  });
});

describe("listedMessages", () => {
  it("reads a page with no `messages` key as no matches", () => {
    expect(listedMessages({ data: { resultSizeEstimate: 0 } })).toStrictEqual([]);
  });

  it("returns the page's own list when it carries one", () => {
    const messages = [{ id: "m1", threadId: "t1" }];
    expect(listedMessages({ data: { messages } })).toBe(messages);
  });
});

describe("historyRecords", () => {
  it("reads a page with no `history` key as nothing changed", () => {
    expect(historyRecords({ data: { historyId: "900" } })).toStrictEqual([]);
  });

  it("returns the page's own records when it carries them", () => {
    const history = [{ id: "h1" }];
    expect(historyRecords({ data: { history } })).toBe(history);
  });
});

describe("nextPageCursor", () => {
  it("reads an omitted or null cursor as the last page, never as an empty cursor", () => {
    expect(nextPageCursor({ page: {} })).toBe(undefined);
    expect(nextPageCursor({ page: { nextPageToken: null } })).toBe(undefined);
  });

  it("returns the cursor Gmail sent, an empty one included", () => {
    expect(nextPageCursor({ page: { nextPageToken: "tok-2" } })).toBe("tok-2");
    expect(nextPageCursor({ page: { nextPageToken: "" } })).toBe("");
  });
});

describe("threadReadBack", () => {
  it("reads a Thread with no `messages` key as nothing read back", () => {
    expect(threadReadBack({ data: { id: "t1" } })).toStrictEqual([]);
  });

  it("returns the thread's own messages when it carries them", () => {
    const messages = [{ id: "m1", labelIds: ["INBOX"] }];
    expect(threadReadBack({ data: { id: "t1", messages } })).toBe(messages);
  });
});

describe("messageLabelIds", () => {
  it("reads a message with no `labelIds`, or a null list, as carrying no label", () => {
    expect(messageLabelIds({ message: { id: "m1" } })).toStrictEqual([]);
    expect(messageLabelIds({ message: { id: "m1", labelIds: null } })).toStrictEqual([]);
  });

  it("returns the message's own label ids when it carries them", () => {
    const labelIds = ["INBOX", "UNREAD"];
    expect(messageLabelIds({ message: { id: "m1", labelIds } })).toBe(labelIds);
  });
});

describe("childParts", () => {
  it("reads a leaf part, with no `parts` key or a null one, as having no children", () => {
    expect(childParts({ part: { mimeType: "text/plain" } })).toStrictEqual([]);
    expect(childParts({ part: { mimeType: "text/plain", parts: null } })).toStrictEqual([]);
  });

  it("returns a multipart part's own children", () => {
    const parts = [{ mimeType: "text/plain" }, { mimeType: "text/html" }];
    expect(childParts({ part: { mimeType: "multipart/alternative", parts } })).toBe(parts);
  });
});
