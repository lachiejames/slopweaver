import { describe, expect, it } from "vitest";

import type { GmailListSeam } from "../../../cli/commands/sessionStart/gmailRead.js";
import {
  INBOX_WINDOW_DAYS,
  mailQuery,
  readGmailThreads,
  SENT_WINDOW_DAYS,
  toMailMessage,
  truncationLimit,
} from "../../../cli/commands/sessionStart/gmailRead.js";
import { err, ok } from "../../../lib/result.js";
import { GmailErrors } from "../../../live/gmail/errors.js";
import type { GmailListingEntry } from "../../../live/gmail/read.js";

const NOW = "2026-08-31T00:00:00.000Z";

const entry = (over: Partial<GmailListingEntry> = {}): GmailListingEntry => ({
  from: "A Colleague <colleague@example.com>",
  hasAttachments: false,
  id: "message-one",
  labelIds: ["INBOX"],
  sentAtIso: "2026-08-30T00:00:00.000Z",
  snippet: "a reply",
  subject: "Re: a subject",
  threadId: "thread-one",
  unread: false,
  ...over,
});

/**
 * A seam answering each query from a fixed table, so a test states what the mailbox holds.
 *
 * @param inbox what the inbox query returns
 * @param sent what the sent query returns
 * @param inboxEstimate Gmail's claimed match count for the inbox query
 * @returns the fake seam, plus the queries it was actually asked
 */
function seamOf({
  inbox,
  sent,
  inboxEstimate = inbox.length,
}: {
  inbox: readonly GmailListingEntry[];
  sent: readonly GmailListingEntry[];
  inboxEstimate?: number;
}): { seam: GmailListSeam; asked: string[] } {
  const asked: string[] = [];
  const seam: GmailListSeam = {
    list: async ({ query }) => {
      asked.push(query);
      const isInbox = query.startsWith("in:inbox");
      const entries = isInbox ? inbox : sent;
      return ok({
        entries,
        resultSizeEstimate: isInbox ? inboxEstimate : entries.length,
      });
    },
  };
  return { asked, seam };
}

describe("mailQuery", () => {
  it("builds the inbox query Gmail's own search box takes", () => {
    expect(mailQuery({ days: 14, scope: "inbox" })).toBe("in:inbox newer_than:14d");
  });

  it("builds the sent query", () => {
    expect(mailQuery({ days: 180, scope: "sent" })).toBe("in:sent newer_than:180d");
  });
});

describe("the two windows", () => {
  it("reads the owner's own sent mail further back than the inbox, so an old thread's new reply is still found", () => {
    expect(SENT_WINDOW_DAYS).toBeGreaterThan(INBOX_WINDOW_DAYS);
  });
});

describe("toMailMessage", () => {
  it("keeps only the fields the ranking reads", () => {
    expect(toMailMessage({ entry: entry() })).toStrictEqual({
      from: "A Colleague <colleague@example.com>",
      labelIds: ["INBOX"],
      sentAtIso: "2026-08-30T00:00:00.000Z",
      snippet: "a reply",
      subject: "Re: a subject",
      threadId: "thread-one",
    });
  });
});

describe("truncationLimit", () => {
  it("says so when Gmail claims more matched than came back", () => {
    expect(truncationLimit({ estimate: 250, label: "inbox", read: 100 })).toContain("100 of about 250");
  });

  it("says nothing when the page was complete", () => {
    expect(truncationLimit({ estimate: 10, label: "inbox", read: 10 })).toBeUndefined();
  });

  it("says nothing when Gmail gave no estimate at all", () => {
    expect(truncationLimit({ estimate: undefined, label: "inbox", read: 10 })).toBeUndefined();
  });
});

describe("readGmailThreads", () => {
  it("asks the inbox and the sent side exactly once each", async () => {
    const { seam, asked } = seamOf({ inbox: [], sent: [] });
    await readGmailThreads({ home: undefined, nowIso: NOW, seam });
    expect(asked).toStrictEqual(["in:inbox newer_than:14d", "in:sent newer_than:180d"]);
  });

  it("rows a thread the owner wrote in that was answered after the owner", async () => {
    const { seam } = seamOf({
      inbox: [entry({ sentAtIso: "2026-08-30T00:00:00.000Z" })],
      sent: [entry({ id: "mine", sentAtIso: "2026-08-29T00:00:00.000Z" })],
    });
    const read = await readGmailThreads({ home: undefined, nowIso: NOW, seam });
    expect(read.inboxRead).toBe(1);
    expect(read.answeredAfterOwner).toBe(1);
    expect(read.inputs[0]!.item.who).toBe("A Colleague");
  });

  it("rows nothing from an inbox of notifications the owner never wrote back to", async () => {
    const { seam } = seamOf({
      inbox: [
        entry({ from: "Datadog HQ <no-reply@example.com>", threadId: "a" }),
        entry({ from: "Google <no-reply@example.com>", threadId: "b" }),
      ],
      sent: [],
    });
    const read = await readGmailThreads({ home: undefined, nowIso: NOW, seam });
    expect(read.inboxRead).toBe(2);
    expect(read.answeredAfterOwner).toBe(0);
    expect(read.inputs).toStrictEqual([]);
  });

  it("rows nothing for a thread the owner already answered, however recent the message looks", async () => {
    const { seam } = seamOf({
      inbox: [entry({ sentAtIso: "2026-08-24T05:24:40.000Z" })],
      sent: [entry({ id: "mine", sentAtIso: "2026-08-29T08:45:58.000Z" })],
    });
    const read = await readGmailThreads({ home: undefined, nowIso: NOW, seam });
    expect(read.answeredAfterOwner).toBe(0);
  });

  it("always states that a thread the owner was only copied on is not read", async () => {
    const { seam } = seamOf({ inbox: [], sent: [] });
    const read = await readGmailThreads({ home: undefined, nowIso: NOW, seam });
    expect(read.couldNotSee.some((line) => line.includes("only copied on"))).toBe(true);
  });

  it("states a truncated page rather than reporting a short list as a whole one", async () => {
    const { seam } = seamOf({ inbox: [entry()], inboxEstimate: 250, sent: [] });
    const read = await readGmailThreads({ home: undefined, nowIso: NOW, seam });
    expect(read.couldNotSee.some((line) => line.includes("1 of about 250"))).toBe(true);
  });

  it("carries the typed reason back when the inbox cannot be read", async () => {
    const seam: GmailListSeam = { list: async () => err(GmailErrors.notConnected()) };
    const read = await readGmailThreads({ home: undefined, nowIso: NOW, seam });
    expect(read.inputs).toStrictEqual([]);
    expect(read.refusal!.code).toBe(GmailErrors.notConnected().code);
    expect(read.couldNotSee[0]).toContain("your mail is not here");
  });

  it("carries the typed reason back when only the sent side fails", async () => {
    let calls = 0;
    const seam: GmailListSeam = {
      list: async () => {
        calls += 1;
        return calls === 1 ? ok({ entries: [entry()], resultSizeEstimate: 1 }) : err(GmailErrors.notConnected());
      },
    };
    const read = await readGmailThreads({ home: undefined, nowIso: NOW, seam });
    expect(read.inputs).toStrictEqual([]);
    expect(read.couldNotSee[0]).toContain("your own sent mail");
  });
});
