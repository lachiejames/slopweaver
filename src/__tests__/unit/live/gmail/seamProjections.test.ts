/**
 * Unit: each Gmail read response as the seam projects it, on plain response bodies. A field the SDK types
 * optional reads the same whether Gmail omitted the key or sent `null`, a present value comes back exactly as
 * sent, an absent count or estimate is never read as zero, and a field every successful answer carries is
 * refused as `RESPONSE_FIELD_MISSING` when it is absent.
 */
import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../../lib/result.js";
import { GmailErrors } from "../../../../live/gmail/errors.js";
import {
  fetchedThreadMessages,
  projectHistoryPage,
  projectIdPage,
  projectLabels,
  projectProfile,
} from "../../../../live/gmail/seamProjections.js";

describe("projectIdPage", () => {
  it("lifts ids, positional thread ids, the cursor and the estimate", () => {
    const data = {
      messages: [
        { id: "m1", threadId: "t1" },
        { id: "m2", threadId: "t2" },
      ],
      nextPageToken: "tok-2",
      resultSizeEstimate: 40,
    };
    expect(projectIdPage({ data })).toStrictEqual({
      ids: ["m1", "m2"],
      nextPageToken: "tok-2",
      resultSizeEstimate: 40,
      threadIds: ["t1", "t2"],
    });
  });

  it("reads a page with no matches, no cursor and no estimate as empty, last and unestimated", () => {
    const expected = { ids: [], nextPageToken: undefined, resultSizeEstimate: undefined, threadIds: [] };
    expect(projectIdPage({ data: {} })).toStrictEqual(expected);
    expect(projectIdPage({ data: { nextPageToken: null, resultSizeEstimate: null } })).toStrictEqual(expected);
  });

  it("keeps a reported estimate of 0 as 0", () => {
    expect(projectIdPage({ data: { resultSizeEstimate: 0 } }).resultSizeEstimate).toBe(0);
  });
});

const THREAD_MESSAGES_MISSING =
  "Gmail answered gmail.users.threads.get for thread t1 with no `messages`, which every successful answer " +
  "carries, so the response is malformed and nothing was read from it";

const LABELS_MISSING =
  "Gmail answered gmail.users.labels.list for this mailbox with no `labels`, which every successful answer " +
  "carries, so the response is malformed and nothing was read from it";

describe("fetchedThreadMessages", () => {
  it("returns the thread's own messages", () => {
    const messages = [{ id: "m1", threadId: "t1" }];
    expect(unwrap(fetchedThreadMessages({ data: { messages }, threadId: "t1" }))).toBe(messages);
  });

  it("returns an empty list Gmail actually sent as that empty list", () => {
    expect(unwrap(fetchedThreadMessages({ data: { messages: [] }, threadId: "t1" }))).toStrictEqual([]);
  });

  it("refuses a thread response with the `messages` key omitted, naming the thread and the field", () => {
    const error = unwrapErr(fetchedThreadMessages({ data: {}, threadId: "t1" }));
    expect(error.code).toBe("RESPONSE_FIELD_MISSING");
    expect(error.message).toBe(THREAD_MESSAGES_MISSING);
  });

  it("refuses a thread response whose `messages` arrived as something other than a list as MALFORMED", () => {
    // The wire body can carry any JSON whatever the SDK declares; the cast is what such a body looks like here.
    const data = { messages: {} } as unknown as Parameters<typeof fetchedThreadMessages>[0]["data"];
    expect(unwrapErr(fetchedThreadMessages({ data, threadId: "t1" }))).toStrictEqual(
      GmailErrors.responseFieldMalformed({
        expected: "a list",
        field: "messages",
        operation: "gmail.users.threads.get",
        subject: "thread t1",
      }),
    );
  });

  it("names the thread the read asked for in its refusal, not a fixed one", () => {
    const error = unwrapErr(fetchedThreadMessages({ data: {}, threadId: "t9" }));
    expect(error.code).toBe("RESPONSE_FIELD_MISSING");
    expect(error.message).toBe(THREAD_MESSAGES_MISSING.replace("thread t1", "thread t9"));
  });
});

describe("projectLabels", () => {
  it("keeps labels with an id and a name, typed by Gmail's own kind", () => {
    const data = {
      labels: [
        { id: "INBOX", name: "INBOX", type: "system" },
        { id: "Label_7", name: "Waiting on", type: "user" },
        { id: "Label_8" },
        { name: "nameless" },
      ],
    };
    expect(unwrap(projectLabels({ data }))).toStrictEqual([
      { id: "INBOX", name: "INBOX", type: "system" },
      { id: "Label_7", name: "Waiting on", type: "user" },
    ]);
  });

  it("refuses a labels response with the `labels` key omitted", () => {
    const error = unwrapErr(projectLabels({ data: {} }));
    expect(error.code).toBe("RESPONSE_FIELD_MISSING");
    expect(error.message).toBe(LABELS_MISSING);
  });

  it("refuses a labels response whose `labels` arrived as something other than a list as MALFORMED", () => {
    const data = { labels: {} } as unknown as Parameters<typeof projectLabels>[0]["data"];
    expect(unwrapErr(projectLabels({ data }))).toStrictEqual(
      GmailErrors.responseFieldMalformed({
        expected: "a list",
        field: "labels",
        operation: "gmail.users.labels.list",
        subject: "this mailbox",
      }),
    );
  });

  it("reads a present but empty `labels` list as that empty vocabulary, not as a refusal", () => {
    const projected = projectLabels({ data: { labels: [] } });
    expect(projected.isOk()).toBe(true);
    expect(unwrap(projected)).toStrictEqual([]);
  });
});

describe("projectProfile", () => {
  it("carries the address, history id and message count as Gmail sent them", () => {
    const data = { emailAddress: "me@example.test", historyId: "900", messagesTotal: 0 };
    expect(projectProfile({ data })).toStrictEqual({
      emailAddress: "me@example.test",
      historyId: "900",
      messagesTotal: 0,
    });
  });

  it("carries each field Gmail omitted or sent as null as undefined, never as zero or blank", () => {
    const expected = { emailAddress: undefined, historyId: undefined, messagesTotal: undefined };
    expect(projectProfile({ data: {} })).toStrictEqual(expected);
    expect(projectProfile({ data: { emailAddress: null, historyId: null, messagesTotal: null } })).toStrictEqual(
      expected,
    );
  });
});

describe("projectHistoryPage", () => {
  it("lifts each added message once, in first-seen order, with the page's history id and cursor", () => {
    const data = {
      history: [
        { id: "h1", messagesAdded: [{ message: { id: "m1", threadId: "t1" } }] },
        { id: "h2" },
        { id: "h3", messagesAdded: [{ message: { id: "m2" } }, { message: { id: "m1", threadId: "t1" } }] },
        { id: "h4", messagesAdded: [{}, { message: { threadId: "t9" } }] },
      ],
      historyId: "950",
      nextPageToken: "tok-2",
    };
    expect(projectHistoryPage({ data })).toStrictEqual({
      added: [
        { id: "m1", threadId: "t1" },
        { id: "m2", threadId: undefined },
      ],
      historyId: "950",
      nextPageToken: "tok-2",
    });
  });

  it("reads a page with nothing changed and no history id as no addition, the last page, and no anchor", () => {
    const expected = { added: [], historyId: undefined, nextPageToken: undefined };
    expect(projectHistoryPage({ data: {} })).toStrictEqual(expected);
    expect(projectHistoryPage({ data: { historyId: null, nextPageToken: null } })).toStrictEqual(expected);
  });

  it("reads an added message's null thread id as undefined", () => {
    const data = { history: [{ messagesAdded: [{ message: { id: "m1", threadId: null } }] }], historyId: "1" };
    expect(projectHistoryPage({ data }).added).toStrictEqual([{ id: "m1", threadId: undefined }]);
  });
});
