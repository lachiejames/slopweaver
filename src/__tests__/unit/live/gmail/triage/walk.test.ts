/*
 * `gmail triage`'s walk over the inbox. The seam is a plain object fake over an invented inbox, so the walk's cap, its
 * completeness claim and its refusal to skip a failed fetch are all testable without a Google account.
 */
import { describe, expect, it } from "vitest";

import { err, ok, unwrap, unwrapErr } from "../../../../../lib/result.js";
import type { GmailApi } from "../../../../../live/gmail/api.js";
import { GmailErrors } from "../../../../../live/gmail/errors.js";
import type { GmailMessage } from "../../../../../live/gmail/parse.js";
import { readGmailTriage } from "../../../../../live/gmail/triageRead.js";
import { EVERY_LANE_POLICY, message, READ_AT } from "./harness.js";

/**
 * A fake mailbox: `total` inbox messages from one sender, paged 100 at a time, each on its own thread; `sent` names
 * the thread ids the owner's SENT listing carries, and `threads` what a thread read answers. Every fetch and thread read is
 * recorded.
 */
function fakeInbox({
  total,
  failId,
  sent = [],
  threads = new Map(),
}: {
  total: number;
  failId?: string;
  sent?: readonly string[];
  threads?: ReadonlyMap<string, readonly GmailMessage[]>;
}): { api: GmailApi; fetched: string[]; threadsRead: string[]; searches: string[] } {
  const ids = Array.from({ length: total }, (_unused, index) => `id${String(index)}`);
  const fetched: string[] = [];
  const threadsRead: string[] = [];
  const searches: string[] = [];
  const api = {
    getMessage: async ({ id }: { id: string }) => {
      fetched.push(id);
      if (id === failId) {
        return err(GmailErrors.apiFailed({ message: "fetch refused" }));
      }
      return ok(message({ atIso: READ_AT, from: "a@example.test", id }));
    },
    getThread: async ({ id }: { id: string }) => {
      threadsRead.push(id);
      const thread = threads.get(id);
      if (thread === undefined) {
        return err(GmailErrors.apiFailed({ message: `no thread ${id}` }));
      }
      return ok(thread);
    },
    listMessageIds: async ({
      labelIds,
      pageToken,
      limit,
      query,
    }: {
      labelIds: readonly string[];
      pageToken?: string | undefined;
      limit: number;
      query: string | undefined;
    }) => {
      if (query !== undefined) {
        searches.push(`${labelIds.join(",")} ${query}`);
        return ok({ ids: [], nextPageToken: undefined, resultSizeEstimate: 0, threadIds: [] });
      }
      if (labelIds.includes("SENT")) {
        const sentIds = sent.map((_threadId, index) => `sent${String(index)}`);
        return ok({ ids: sentIds, nextPageToken: undefined, resultSizeEstimate: sent.length, threadIds: sent });
      }
      const start = pageToken === undefined ? 0 : Number(pageToken);
      const page = ids.slice(start, start + limit);
      const next = start + limit < ids.length ? String(start + limit) : undefined;
      return ok({ ids: page, nextPageToken: next, resultSizeEstimate: total, threadIds: page.map((id) => `t-${id}`) });
    },
  } as unknown as GmailApi;
  return { api, fetched, searches, threadsRead };
}

/** One message of a thread at an instant, the owner's own when `sent`. */
function threadMessage({ id, atIso, sent }: { id: string; atIso: string; sent: boolean }): GmailMessage {
  return { id, internalDate: String(Date.parse(atIso)), labelIds: sent ? ["SENT"] : ["INBOX"], threadId: "t" };
}

describe("readGmailTriage", () => {
  it("walks every page to the end and says the reading is complete", async () => {
    const { api, fetched, searches } = fakeInbox({ total: 150 });
    const document = unwrap(
      await readGmailTriage({
        account: "owner@example.test",
        api,
        policy: EVERY_LANE_POLICY,
        limit: 500,
        nowIso: () => READ_AT,
      }),
    );
    expect(document.complete).toBe(true);
    expect(document.messagesRead).toBe(150);
    expect(document.inboxEstimate).toBe(150);
    expect(fetched.length).toBe(150);
    expect(searches).toEqual(["INBOX filename:invite.ics"]);
  });

  it("stops at the cap and says more remain", async () => {
    const { api, fetched } = fakeInbox({ total: 150 });
    const document = unwrap(
      await readGmailTriage({
        account: "owner@example.test",
        api,
        policy: EVERY_LANE_POLICY,
        limit: 120,
        nowIso: () => READ_AT,
      }),
    );
    expect(document.complete).toBe(false);
    expect(fetched.length).toBe(120);
  });

  it("fails the whole reading on one failed fetch rather than carding an inbox as clearer than it is", async () => {
    const { api } = fakeInbox({ failId: "id3", total: 5 });
    const failed = unwrapErr(
      await readGmailTriage({
        account: "owner@example.test",
        api,
        policy: EVERY_LANE_POLICY,
        limit: 500,
        nowIso: () => READ_AT,
      }),
    );
    expect(failed.message).toBe("fetch refused");
  });

  it("reads only the inbox threads the owner's SENT listing names, and holds out the one whose newest message is the owner's", async () => {
    const threads = new Map([
      [
        "t-id0",
        [
          threadMessage({ atIso: "2026-09-29T09:00:00.000Z", id: "id0", sent: false }),
          threadMessage({ atIso: "2026-09-29T10:00:00.000Z", id: "owner-reply", sent: true }),
        ],
      ],
      [
        "t-id1",
        [
          threadMessage({ atIso: "2026-09-29T09:00:00.000Z", id: "owner-ask", sent: true }),
          threadMessage({ atIso: "2026-09-29T10:00:00.000Z", id: "id1", sent: false }),
        ],
      ],
    ]);
    const { api, threadsRead } = fakeInbox({ sent: ["t-id0", "t-id1", "t-elsewhere"], threads, total: 3 });
    const document = unwrap(
      await readGmailTriage({
        account: "owner@example.test",
        api,
        policy: EVERY_LANE_POLICY,
        limit: 500,
        nowIso: () => READ_AT,
      }),
    );
    expect(threadsRead).toEqual(["t-id0", "t-id1"]);
    expect(document.replied.map((thread) => [thread.threadId, thread.ids])).toEqual([["t-id0", ["id0"]]]);
    expect(document.groups.map((group) => group.entries.map((entry) => entry.id).toSorted())).toEqual([["id1", "id2"]]);
  });

  it("fails the whole reading when a thread read fails, rather than carding a thread the owner may have answered", async () => {
    const { api } = fakeInbox({ sent: ["t-id0"], total: 2 });
    const failed = unwrapErr(
      await readGmailTriage({
        account: "owner@example.test",
        api,
        policy: EVERY_LANE_POLICY,
        limit: 500,
        nowIso: () => READ_AT,
      }),
    );
    expect(failed.message).toBe("no thread t-id0");
  });
});
