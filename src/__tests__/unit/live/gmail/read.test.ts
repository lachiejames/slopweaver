/**
 * Unit: the two Gmail read document builders, over a plain fake API seam (a function bag, not a mock).
 * The assertions are mostly about RESIDUE, because that is the property a mail read exists to keep honest.
 */
import { describe, expect, it } from "vitest";
import { err, ok, unwrap, unwrapErr } from "../../../../lib/result.js";
import type { GmailApi, GmailIdPage } from "../../../../live/gmail/api.js";
import { GmailErrors } from "../../../../live/gmail/errors.js";
import type { GmailLabel } from "../../../../live/gmail/labels.js";
import type { GmailMessage } from "../../../../live/gmail/parse.js";
import { readGmailLabels, readGmailListing, readGmailMessage } from "../../../../live/gmail/read.js";

const NOW = "2026-08-27T12:00:00.000Z";
const b64 = ({ text }: { text: string }): string => Buffer.from(text, "utf8").toString("base64url");

/** One synthetic message, addressable and with a plain-text body. */
function message({
  id,
  labels = ["INBOX"],
  attachment = false,
  extra = [],
  text = `body ${id}`,
  threadId = `t-${id}`,
}: {
  id: string;
  labels?: readonly string[];
  attachment?: boolean;
  extra?: readonly { name: string; value: string }[];
  text?: string;
  threadId?: string;
}): GmailMessage {
  return {
    id,
    internalDate: "1756300000000",
    labelIds: labels,
    payload: {
      headers: [
        { name: "From", value: `sender-${id}@example.test` },
        { name: "Subject", value: `subject ${id}` },
        ...extra,
      ],
      mimeType: "multipart/mixed",
      parts: [
        { body: { data: b64({ text }) }, mimeType: "text/plain" },
        ...(attachment
          ? [{ body: { attachmentId: `att-${id}`, size: 11 }, filename: "a.pdf", mimeType: "application/pdf" }]
          : []),
      ],
    },
    snippet: `snippet ${id}`,
    threadId,
  };
}

/**
 * A fake seam. Each call is a plain function returning a Result — no vi.fn anywhere.
 *
 * Every write seam — the three label mutations and the three outbound ones — answers with a failure the
 * read builders never trigger, which is the assertion
 * itself: a read that reached `modifyMessage` would fail loudly here rather than pass quietly.
 */
function fakeApi({
  page,
  messages,
  thread = [],
  threads,
  labels = [],
}: {
  page: GmailIdPage;
  messages: readonly GmailMessage[];
  thread?: readonly GmailMessage[];
  /** When given, `getThread` answers by id from here and fails any id it does not hold, as Gmail does. */
  threads?: Readonly<Record<string, readonly GmailMessage[]>>;
  labels?: readonly GmailLabel[];
}): GmailApi {
  const notForReads = async (): Promise<never> => {
    throw new Error("a read builder must never call a mutation seam");
  };
  return {
    getMessage: async ({ id }) => {
      const found = messages.find((candidate) => candidate.id === id);
      return found === undefined ? err(GmailErrors.apiFailed({ message: `no fixture for ${id}` })) : ok(found);
    },
    getProfile: async () => ok({ emailAddress: "me@example.test", historyId: "1", messagesTotal: 2 }),
    getThread: async ({ id }) => {
      if (threads === undefined) {
        return ok(thread);
      }
      const found = threads[id];
      return found === undefined
        ? err(GmailErrors.apiFailed({ message: "Requested entity was not found." }))
        : ok(found);
    },
    listHistory: async () => ok({ added: [], historyId: "1", nextPageToken: undefined }),
    listLabels: async () => ok(labels),
    listMessageIds: async () => ok(page),
    createDraft: notForReads,
    getAttachment: notForReads,
    getDraft: notForReads,
    sendDraft: notForReads,
    modifyMessage: notForReads,
    modifyThread: notForReads,
  };
}

describe("readGmailListing", () => {
  it("reads each id as metadata and reports the entries with their unread and attachment flags", async () => {
    const messages = [message({ attachment: true, id: "a", labels: ["INBOX", "UNREAD"] }), message({ id: "b" })];
    const result = unwrap(
      await readGmailListing({
        account: "me@example.test",
        api: fakeApi({
          messages,
          page: { ids: ["a", "b"], nextPageToken: undefined, resultSizeEstimate: 2, threadIds: ["t-a", "t-b"] },
        }),
        labelIds: [],
        limit: 25,
        nowIso: () => NOW,
        query: "is:unread",
      }),
    );
    expect(result.listing.entries.length).toBe(2);
    expect(result.listing.entries[0]!.id).toBe("a");
    expect(result.listing.entries[0]!.unread).toBe(true);
    expect(result.listing.entries[0]!.hasAttachments).toBe(true);
    expect(result.listing.entries[1]!.unread).toBe(false);
    expect(result.document.source).toBe("gmail");
    expect(result.document.readAtIso).toBe(NOW);
    expect(result.document.target.address).toBe("is:unread");
    expect(result.document.target.identity).toBe("me@example.test");
  });

  it("says another page exists when Gmail handed back a cursor", async () => {
    const result = unwrap(
      await readGmailListing({
        account: "me@example.test",
        api: fakeApi({
          messages: [message({ id: "a" })],
          page: { ids: ["a"], nextPageToken: "next", resultSizeEstimate: 900, threadIds: ["t-a"] },
        }),
        labelIds: [],
        limit: 1,
        nowIso: () => NOW,
        query: undefined,
      }),
    );
    expect(result.document.coverage.residue.some((line) => line.includes("one page of 1"))).toBe(true);
  });

  it("labels resultSizeEstimate as the provider's ESTIMATE, never as what was read", async () => {
    const result = unwrap(
      await readGmailListing({
        account: "me@example.test",
        api: fakeApi({
          messages: [message({ id: "a" })],
          page: { ids: ["a"], nextPageToken: undefined, resultSizeEstimate: 900, threadIds: ["t-a"] },
        }),
        labelIds: [],
        limit: 25,
        nowIso: () => NOW,
        query: undefined,
      }),
    );
    expect(result.document.coverage.residue.some((line) => line.includes("ESTIMATES 900"))).toBe(true);
  });

  it("always says a listing read no bodies, so a caller cannot present a snippet as the message", async () => {
    const result = unwrap(
      await readGmailListing({
        account: "me@example.test",
        api: fakeApi({
          messages: [],
          page: { ids: [], nextPageToken: undefined, resultSizeEstimate: 0, threadIds: [] },
        }),
        labelIds: [],
        limit: 25,
        nowIso: () => NOW,
        query: undefined,
      }),
    );
    expect(result.listing.entries).toStrictEqual([]);
    expect(result.document.coverage.residue.some((line) => line.includes("bodies and attachments are not read"))).toBe(
      true,
    );
  });

  it("names the labels it was restricted to in the target kind", async () => {
    const result = unwrap(
      await readGmailListing({
        account: "me@example.test",
        api: fakeApi({
          messages: [],
          page: { ids: [], nextPageToken: undefined, resultSizeEstimate: undefined, threadIds: [] },
        }),
        labelIds: ["INBOX", "STARRED"],
        limit: 25,
        nowIso: () => NOW,
        query: undefined,
      }),
    );
    expect(result.document.target.kind).toBe("search in INBOX,STARRED");
  });

  it("propagates the seam's typed failure rather than returning a half-read listing", async () => {
    const result = await readGmailListing({
      account: "me@example.test",
      api: fakeApi({
        messages: [],
        page: { ids: ["missing"], nextPageToken: undefined, resultSizeEstimate: 1, threadIds: ["t-m"] },
      }),
      labelIds: [],
      limit: 25,
      nowIso: () => NOW,
      query: undefined,
    });
    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result).code).toBe("API_FAILED");
  });
});

describe("readGmailMessage", () => {
  it("reads one message in full and warns that its thread may hold more", async () => {
    const result = unwrap(
      await readGmailMessage({
        account: "me@example.test",
        address: "a",
        api: fakeApi({
          messages: [message({ id: "a" })],
          page: { ids: [], nextPageToken: undefined, resultSizeEstimate: undefined, threadIds: [] },
        }),
        nowIso: () => NOW,
        thread: false,
      }),
    );
    expect(result.payload.messages.length).toBe(1);
    expect(result.payload.messages[0]!.body).toBe("body a");
    expect(result.document.target.kind).toBe("message");
    expect(result.document.coverage.residue.some((line) => line.includes("--thread"))).toBe(true);
  });

  it("lifts each message's own unsubscribe pair, and says none for a message carrying no List-Unsubscribe", async () => {
    const oneClick = [
      { name: "List-Unsubscribe", value: "<mailto:u@example.test>, <https://example.test/u?t=1>" },
      { name: "List-Unsubscribe-Post", value: "List-Unsubscribe=One-Click" },
    ];
    const result = unwrap(
      await readGmailMessage({
        account: "me@example.test",
        address: "t-a",
        api: fakeApi({
          messages: [],
          page: { ids: [], nextPageToken: undefined, resultSizeEstimate: undefined, threadIds: [] },
          thread: [message({ extra: oneClick, id: "a" }), message({ id: "b" })],
        }),
        nowIso: () => NOW,
        thread: true,
      }),
    );
    expect(result.payload.messages.map((read) => read.unsubscribe)).toEqual([
      {
        kind: "one-click",
        listUnsubscribe: "<mailto:u@example.test>, <https://example.test/u?t=1>",
        listUnsubscribePost: "List-Unsubscribe=One-Click",
      },
      { kind: "none", listUnsubscribe: undefined, listUnsubscribePost: undefined },
    ]);
  });

  it("reads a whole thread and does not suggest re-reading it as one", async () => {
    const result = unwrap(
      await readGmailMessage({
        account: "me@example.test",
        address: "t-a",
        api: fakeApi({
          messages: [],
          page: { ids: [], nextPageToken: undefined, resultSizeEstimate: undefined, threadIds: [] },
          thread: [message({ id: "a" }), message({ id: "b" })],
        }),
        nowIso: () => NOW,
        thread: true,
      }),
    );
    expect(result.payload.messages.length).toBe(2);
    expect(result.document.target.kind).toBe("thread");
    expect(result.document.coverage.residue.some((line) => line.includes("--thread"))).toBe(false);
  });

  it("reads the thread a MESSAGE id belongs to when Gmail answers that id as no thread", async () => {
    const reply = message({ id: "b", threadId: "a" });
    const result = unwrap(
      await readGmailMessage({
        account: "me@example.test",
        address: "b",
        api: fakeApi({
          messages: [reply],
          page: { ids: [], nextPageToken: undefined, resultSizeEstimate: undefined, threadIds: [] },
          threads: { a: [message({ id: "a", threadId: "a" }), reply] },
        }),
        nowIso: () => NOW,
        thread: true,
      }),
    );
    expect(result.payload.threadId).toBe("a");
    expect(result.payload.messages.map((read) => read.id)).toEqual(["a", "b"]);
    expect(result.payload.unreadMessages).toBe(0);
  });

  it("counts and names a thread message Gmail answered with no id, rather than dropping it silently", async () => {
    const result = unwrap(
      await readGmailMessage({
        account: "me@example.test",
        address: "a",
        api: fakeApi({
          messages: [],
          page: { ids: [], nextPageToken: undefined, resultSizeEstimate: undefined, threadIds: [] },
          thread: [message({ id: "a", threadId: "a" }), { ...message({ id: "b", threadId: "a" }), id: null }],
        }),
        nowIso: () => NOW,
        thread: true,
      }),
    );
    expect(result.payload.messages.map((read) => read.id)).toEqual(["a"]);
    expect(result.payload.unreadMessages).toBe(1);
    expect(result.document.coverage.residue).toContain(
      "1 message(s) Gmail answered carried no id or thread id and are not shown",
    );
  });

  it("reports the requested address as the thread when no message Gmail answered could be parsed", async () => {
    const result = unwrap(
      await readGmailMessage({
        account: "me@example.test",
        address: "t-asked",
        api: fakeApi({
          messages: [],
          page: { ids: [], nextPageToken: undefined, resultSizeEstimate: undefined, threadIds: [] },
          thread: [{ ...message({ id: "a", threadId: "t-other" }), id: null }],
        }),
        nowIso: () => NOW,
        thread: true,
      }),
    );
    expect(result.payload.messages).toStrictEqual([]);
    expect(result.payload.threadId).toBe("t-asked");
    expect(result.payload.unreadMessages).toBe(1);
  });

  it("fails a thread read whose response carried no `messages`, never reporting an empty thread", async () => {
    const malformed = GmailErrors.responseFieldMissing({
      field: "messages",
      operation: "gmail.users.threads.get",
      subject: "thread t-asked",
    });
    const api: GmailApi = {
      ...fakeApi({
        messages: [],
        page: { ids: [], nextPageToken: undefined, resultSizeEstimate: undefined, threadIds: [] },
      }),
      getThread: async () => err(malformed),
    };
    const error = unwrapErr(
      await readGmailMessage({ account: "me@example.test", address: "t-asked", api, nowIso: () => NOW, thread: true }),
    );
    expect(error.code).toBe("RESPONSE_FIELD_MISSING");
    expect(error.message).toBe(
      "Gmail answered gmail.users.threads.get for thread t-asked with no `messages`, which every successful " +
        "answer carries, so the response is malformed and nothing was read from it",
    );
  });

  it("reports a retained message's own parsed thread id, never the address it was asked for", async () => {
    const result = unwrap(
      await readGmailMessage({
        account: "me@example.test",
        address: "m-1",
        api: fakeApi({
          messages: [message({ id: "m-1", threadId: "t-9" })],
          page: { ids: [], nextPageToken: undefined, resultSizeEstimate: undefined, threadIds: [] },
        }),
        nowIso: () => NOW,
        thread: false,
      }),
    );
    expect(result.payload.threadId).toBe("t-9");
  });

  it("answers the thread read's own failure when no message carries the id either", async () => {
    const result = await readGmailMessage({
      account: "me@example.test",
      address: "gone",
      api: fakeApi({
        messages: [],
        page: { ids: [], nextPageToken: undefined, resultSizeEstimate: undefined, threadIds: [] },
        threads: {},
      }),
      nowIso: () => NOW,
      thread: true,
    });
    expect(unwrapErr(result).message).toBe("Requested entity was not found.");
  });

  it("carries what each sender authored above its quoted history, and what the history cost", async () => {
    const text = "Thanks, sounds good.\r\n\r\nOn Mon, 28 Sep 2026 at 3:55 PM Morgan wrote:\r\n> earlier words\r\n";
    const result = unwrap(
      await readGmailMessage({
        account: "me@example.test",
        address: "a",
        api: fakeApi({
          messages: [message({ id: "a", text })],
          page: { ids: [], nextPageToken: undefined, resultSizeEstimate: undefined, threadIds: [] },
        }),
        nowIso: () => NOW,
        thread: false,
      }),
    );
    const read = result.payload.messages[0]!;
    expect(read.authored).toBe("Thanks, sounds good.");
    // The parsed body drops the trailing CRLF, so the tail cut is that body's length less the authored 20.
    expect(read.quotedCharsDropped).toBe(read.body.length - 20);
    expect(read.quotedCharsDropped).toBe(65);
    expect(read.body).toContain("> earlier words");
  });

  it("reports attachments as metadata-only, naming that no bytes were downloaded", async () => {
    const result = unwrap(
      await readGmailMessage({
        account: "me@example.test",
        address: "a",
        api: fakeApi({
          messages: [message({ attachment: true, id: "a" })],
          page: { ids: [], nextPageToken: undefined, resultSizeEstimate: undefined, threadIds: [] },
        }),
        nowIso: () => NOW,
        thread: false,
      }),
    );
    expect(result.payload.messages[0]!.attachments).toStrictEqual([
      { filename: "a.pdf", mimeType: "application/pdf", sizeBytes: 11 },
    ]);
    expect(result.document.coverage.residue.some((line) => line.includes("no bytes were downloaded"))).toBe(true);
  });

  it("propagates the seam's typed failure", async () => {
    const result = await readGmailMessage({
      account: "me@example.test",
      address: "nope",
      api: fakeApi({
        messages: [],
        page: { ids: [], nextPageToken: undefined, resultSizeEstimate: undefined, threadIds: [] },
      }),
      nowIso: () => NOW,
      thread: false,
    });
    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result).code).toBe("API_FAILED");
  });
});

describe("readGmailLabels", () => {
  const page: GmailIdPage = { ids: [], nextPageToken: undefined, resultSizeEstimate: undefined, threadIds: [] };

  it("reports the whole vocabulary with each label's id, name and kind", async () => {
    const labels: readonly GmailLabel[] = [
      { id: "INBOX", name: "INBOX", type: "system" },
      { id: "Label_7", name: "Waiting on", type: "user" },
    ];
    const result = unwrap(
      await readGmailLabels({
        account: "owner@example.test",
        api: fakeApi({ labels, messages: [], page }),
        nowIso: () => "2026-08-28T00:00:00.000Z",
      }),
    );
    expect(result.vocabulary.labels).toStrictEqual(labels);
    expect(result.document.target.kind).toBe("labels");
    expect(result.document.coverage.detail).toBe("2 label(s) — the mailbox's complete vocabulary");
  });

  it("says in residue that message counts were not read", async () => {
    const result = unwrap(
      await readGmailLabels({
        account: "owner@example.test",
        api: fakeApi({ messages: [], page }),
        nowIso: () => "2026-08-28T00:00:00.000Z",
      }),
    );
    expect(result.document.coverage.residue[0]).toContain("not read here");
  });

  it("reports an empty vocabulary rather than failing", async () => {
    const result = unwrap(
      await readGmailLabels({
        account: "owner@example.test",
        api: fakeApi({ labels: [], messages: [], page }),
        nowIso: () => "2026-08-28T00:00:00.000Z",
      }),
    );
    expect(result.vocabulary.labels).toStrictEqual([]);
    expect(result.document.coverage.detail).toBe("0 label(s) — the mailbox's complete vocabulary");
  });
});
