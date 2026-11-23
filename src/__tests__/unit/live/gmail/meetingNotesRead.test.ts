/**
 * Reading every Gemini meeting-notes mail one scope names, over a plain fake API seam (a function bag, not a mock).
 *
 * The property worth pinning is COMPLETENESS: a verb proving "every transcript so far" must follow every page,
 * and must say so when its bound stopped it with mail still matching rather than read one page as the whole set.
 */
import { describe, expect, it } from "vitest";

import { err, ok, unwrap, unwrapErr } from "../../../../lib/result.js";
import type { GmailApi, GmailIdPage } from "../../../../live/gmail/api.js";
import { GmailErrors } from "../../../../live/gmail/errors.js";
import { meetingNotesQuery, readMeetingNotesMail } from "../../../../live/gmail/meetingNotesRead.js";
import type { GmailMessage } from "../../../../live/gmail/parse.js";

/** One synthetic meeting-notes mail, addressable by id. */
const notesMail = ({ id }: { id: string }): GmailMessage => ({
  id,
  internalDate: "1759370000000",
  labelIds: ["INBOX"],
  payload: {
    headers: [
      { name: "From", value: "Gemini <gemini-notes@google.com>" },
      { name: "Subject", value: `Notes: 'Meeting ${id}' 2 Oct 2026` },
    ],
    mimeType: "text/plain",
  },
  threadId: `t-${id}`,
});

/**
 * A paging fake: `pages` answers in order, keyed by the cursor that asked for it, and `listed` records each
 * call's cursor and limit — the whole assertion surface for paging.
 */
function fakeApi({
  pages,
  messages,
  failList = false,
}: {
  pages: Readonly<Record<string, GmailIdPage>>;
  messages: readonly GmailMessage[];
  failList?: boolean;
}): { api: GmailApi; listed: { pageToken: string | undefined; limit: number; query: string | undefined }[] } {
  const listed: { pageToken: string | undefined; limit: number; query: string | undefined }[] = [];
  const notForReads = async (): Promise<never> => {
    throw new Error("a meeting-notes read must never call a mutation seam");
  };
  const api: GmailApi = {
    createDraft: notForReads,
    getAttachment: notForReads,
    getDraft: notForReads,
    getMessage: async ({ id }) => {
      const found = messages.find((candidate) => candidate.id === id);
      return found === undefined ? err(GmailErrors.apiFailed({ message: `no fixture for ${id}` })) : ok(found);
    },
    getProfile: async () => ok({ emailAddress: "me@example.test", historyId: "1", messagesTotal: 2 }),
    getThread: notForReads,
    listHistory: notForReads,
    listLabels: notForReads,
    listMessageIds: async ({ pageToken, limit, query }) => {
      listed.push({ limit, pageToken, query });
      if (failList) {
        return err(GmailErrors.apiFailed({ message: "quota exhausted" }));
      }
      if (pageToken === undefined) {
        return ok(pages["first"]!);
      }
      return ok(pages[pageToken]!);
    },
    modifyMessage: notForReads,
    modifyThread: notForReads,
    sendDraft: notForReads,
  };
  return { api, listed };
}

const page = ({ ids, next }: { ids: readonly string[]; next: string | undefined }): GmailIdPage => ({
  ids,
  nextPageToken: next,
  resultSizeEstimate: ids.length,
  threadIds: ids.map((id) => `t-${id}`),
});

describe("meetingNotesQuery", () => {
  it("names both Gemini senders, scoped to the inbox or the whole mailbox", () => {
    expect(meetingNotesQuery({ scope: "inbox" })).toBe(
      "in:inbox {from:gemini-notes@google.com from:meetings-noreply@google.com}",
    );
    expect(meetingNotesQuery({ scope: "anywhere" })).toBe(
      "in:anywhere {from:gemini-notes@google.com from:meetings-noreply@google.com}",
    );
  });
});

describe("readMeetingNotesMail", () => {
  it("follows every page and reads each mail in full, reporting the read complete", async () => {
    const fake = fakeApi({
      messages: [notesMail({ id: "a" }), notesMail({ id: "b" }), notesMail({ id: "c" })],
      pages: { first: page({ ids: ["a", "b"], next: "p2" }), p2: page({ ids: ["c"], next: undefined }) },
    });

    const read = unwrap(await readMeetingNotesMail({ api: fake.api, limit: 100, scope: "inbox" }));

    expect(read.messages.map((message) => message.id)).toEqual(["a", "b", "c"]);
    expect([read.complete, read.unparsed]).toEqual([true, []]);
    expect(fake.listed.map((call) => call.pageToken)).toEqual([undefined, "p2"]);
    expect(read.query).toBe(meetingNotesQuery({ scope: "inbox" }));
  });

  it("reads an id listed twice, within a page or across pages, once", async () => {
    const fake = fakeApi({
      messages: [notesMail({ id: "a" }), notesMail({ id: "b" })],
      pages: { first: page({ ids: ["a", "a", "b"], next: "p2" }), p2: page({ ids: ["b"], next: undefined }) },
    });

    const read = unwrap(await readMeetingNotesMail({ api: fake.api, limit: 100, scope: "inbox" }));

    expect(read.messages.map((message) => message.id)).toEqual(["a", "b"]);
  });

  it("asks each page for only what is left of the bound", async () => {
    const fake = fakeApi({
      messages: [notesMail({ id: "a" }), notesMail({ id: "b" }), notesMail({ id: "c" })],
      pages: { first: page({ ids: ["a", "b"], next: "p2" }), p2: page({ ids: ["c"], next: undefined }) },
    });

    unwrap(await readMeetingNotesMail({ api: fake.api, limit: 3, scope: "anywhere" }));

    expect(fake.listed.map((call) => call.limit)).toEqual([3, 1]);
  });

  it("reports a bound reached with mail still matching as INCOMPLETE, and reads no further page", async () => {
    const fake = fakeApi({
      messages: [notesMail({ id: "a" }), notesMail({ id: "b" })],
      pages: { first: page({ ids: ["a", "b"], next: "p2" }), p2: page({ ids: ["c"], next: undefined }) },
    });

    const read = unwrap(await readMeetingNotesMail({ api: fake.api, limit: 2, scope: "inbox" }));

    expect(read.complete).toBe(false);
    expect(read.messages.map((message) => message.id)).toEqual(["a", "b"]);
    expect(fake.listed.length).toBe(1);
  });

  it("keeps the listed id of a message with no thread id as unparsed, rather than dropping it silently", async () => {
    const { threadId: _threadId, ...broken } = notesMail({ id: "b" });
    const fake = fakeApi({
      messages: [notesMail({ id: "a" }), broken],
      pages: { first: page({ ids: ["a", "b"], next: undefined }) },
    });

    const read = unwrap(await readMeetingNotesMail({ api: fake.api, limit: 100, scope: "inbox" }));

    expect([read.messages.length, read.unparsed]).toEqual([1, ["b"]]);
  });

  it("keeps a listed id Gmail answered under another id as unparsed, so it never borrows that mail's proof", async () => {
    const fake = fakeApi({ messages: [], pages: { first: page({ ids: ["a", "b"], next: undefined }) } });
    const api: GmailApi = {
      ...fake.api,
      getMessage: async ({ id }) => ok(notesMail({ id: id === "a" ? "b" : id })),
    };

    const read = unwrap(await readMeetingNotesMail({ api, limit: 100, scope: "inbox" }));

    expect([read.messages.map((message) => message.id), read.unparsed]).toEqual([["b"], ["a"]]);
  });

  it("fails on a list failure, and on a message it cannot fetch, rather than returning a partial read", async () => {
    const listFailed = unwrapErr(
      await readMeetingNotesMail({
        api: fakeApi({ failList: true, messages: [], pages: {} }).api,
        limit: 100,
        scope: "inbox",
      }),
    );
    const fetchFailed = unwrapErr(
      await readMeetingNotesMail({
        api: fakeApi({ messages: [], pages: { first: page({ ids: ["gone"], next: undefined }) } }).api,
        limit: 100,
        scope: "inbox",
      }),
    );

    expect([listFailed.message, fetchFailed.message]).toEqual([
      GmailErrors.apiFailed({ message: "quota exhausted" }).message,
      GmailErrors.apiFailed({ message: "no fixture for gone" }).message,
    ]);
  });
});
