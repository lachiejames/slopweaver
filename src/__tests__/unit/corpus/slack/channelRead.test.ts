/**
 * `fetchChannel` and `bindPartialCommit` — one conversation's read, through a scripted `SlackApi` and a
 * hand-built progress deadline whose `expiry` the test either never settles (a read that finishes) or settles
 * up front (a read that froze). Pinned: what a finished read returns, field for field; that `walkedMessages`
 * rides only on a walk that reached the end; the events the watchdog is fed in order; that a frozen read
 * answers the deadline's own snapshot; and that the bound flush seam forwards its conversation and maps.
 *
 * No clock and no timer: the deadline is a plain object, so nothing here waits on time passing.
 */
import { describe, expect, it } from "vitest";

import type { ChannelProgressDeadline, ChannelProgressSnapshot } from "../../../../corpus/slack/channelDeadline.js";
import { bindPartialCommit, fetchChannel, SLACK_CHANNEL_FLUSH_ITEMS } from "../../../../corpus/slack/channelRead.js";
import type {
  SlackApi,
  SlackChannelPartialCommit,
  SlackChannelRef,
  SlackMessagesPage,
} from "../../../../corpus/slack/fetch.js";
import type { SlackChannelItems } from "../../../../corpus/slack/project.js";
import type { ChannelReadPlan } from "../../../../corpus/slack/reach.js";
import type { ChannelContext } from "../../../../corpus/slack/shape.js";
import type { SlackNameMaps } from "../../../../corpus/slack/visibleProse.js";
import { ok, unwrap } from "../../../../lib/result.js";

const WORKSPACE = "https://acme.slack.com";
const CTX: ChannelContext = { channelId: "C1", channelName: "general", isPrivate: true, workspaceUrl: WORKSPACE };
const PLAN: ChannelReadPlan = {
  ingestOldest: "1690000000",
  lane: "poll-known-threads",
  pinnedWindow: true,
  walkOldest: "1690000000",
};
const LATEST = "1800000000";

const PARENT = { reply_count: 1, text: "parent", ts: "1700000000.000100", user: "U1" };
const QUIET = { text: "no thread", ts: "1699999000.000100", user: "U2" };
const REPLY = { text: "a reply", ts: "1700000100.000200", user: "U3" };

/** One event the conversation fed its watchdog, in order. */
type DeadlineEvent = { awaiting: string } | { progressed: string; rows: number };

/** A deadline whose expiry the test controls, recording every event it is fed. */
function scriptedDeadline({
  events,
  expiry,
}: {
  events: DeadlineEvent[];
  expiry: Promise<ChannelProgressSnapshot>;
}): ChannelProgressDeadline {
  return {
    abandoned: () => false,
    awaiting: ({ phase }) => {
      events.push({ awaiting: phase });
    },
    expiry,
    progressed: ({ of, rows }) => {
      events.push({ progressed: of, rows });
    },
    release: () => undefined,
  };
}

/** A deadline that never expires — the conversation always finishes first. */
const NEVER = new Promise<ChannelProgressSnapshot>(() => undefined);

/** A history request as the fake saw it. */
type HistoryRequest = Parameters<SlackApi["history"]>[0];
/** A replies request as the fake saw it. */
type RepliesRequest = Parameters<SlackApi["replies"]>[0];

/** A Slack seam answering ONE history page and one replies page, recording both kinds of request. */
function scriptedApi({
  history,
  replies,
  historyRequests,
  repliesRequests,
}: {
  history: () => Promise<SlackMessagesPage>;
  replies: SlackMessagesPage;
  historyRequests: HistoryRequest[];
  repliesRequests: RepliesRequest[];
}): SlackApi {
  const refuse = async (): Promise<never> => {
    throw new Error("a conversation read calls only conversations.history and conversations.replies");
  };
  return {
    filesInfo: refuse,
    grantedScopes: refuse,
    history: async (args) => {
      historyRequests.push(args);
      return history();
    },
    listChannels: refuse,
    listUsers: refuse,
    replies: async (args) => {
      repliesRequests.push(args);
      return replies;
    },
    workspaceUrl: refuse,
  };
}

describe("SLACK_CHANNEL_FLUSH_ITEMS", () => {
  it("is 25,000 held items", () => {
    expect(SLACK_CHANNEL_FLUSH_ITEMS).toBe(25_000);
  });
});

describe("fetchChannel", () => {
  it("returns a finished read's items, thread cursor and walked count, feeding the watchdog in order", async () => {
    const events: DeadlineEvent[] = [];
    const historyRequests: HistoryRequest[] = [];
    const repliesRequests: RepliesRequest[] = [];
    const api = scriptedApi({
      history: async () => ({ messages: [PARENT, QUIET] }),
      historyRequests,
      replies: { messages: [PARENT, REPLY] },
      repliesRequests,
    });

    const read = await fetchChannel({
      api,
      ctx: CTX,
      deadline: scriptedDeadline({ events, expiry: NEVER }),
      latest: LATEST,
      plan: PLAN,
      threadCursors: {},
    });

    expect(read).toStrictEqual({
      cursorUpdates: { "C1:1700000000.000100": { ts: "1700000100.000200" } },
      flushed: { items: 0, maxTsIso: "", messages: 0 },
      items: {
        channelId: "C1",
        channelName: "general",
        isPrivate: true,
        messages: [
          {
            author: "U1",
            channelId: "C1",
            channelName: "general",
            files: [],
            permalink: `${WORKSPACE}/archives/C1/p1700000000000100`,
            raw: PARENT,
            reactions: [],
            text: "parent",
            ts: "1700000000.000100",
            tsIso: "2023-11-14T22:13:20.000Z",
          },
          {
            author: "U2",
            channelId: "C1",
            channelName: "general",
            files: [],
            permalink: `${WORKSPACE}/archives/C1/p1699999000000100`,
            raw: QUIET,
            reactions: [],
            text: "no thread",
            ts: "1699999000.000100",
            tsIso: "2023-11-14T21:56:40.000Z",
          },
        ],
        replies: [
          {
            author: "U3",
            channelId: "C1",
            channelName: "general",
            files: [],
            permalink: `${WORKSPACE}/archives/C1/p1700000100000200`,
            raw: REPLY,
            text: "a reply",
            threadTs: "1700000000.000100",
            ts: "1700000100.000200",
            tsIso: "2023-11-14T22:15:00.000Z",
          },
        ],
      },
      kind: "read",
      walkedMessages: 2,
      warnings: [],
    });
    expect(historyRequests).toEqual([{ channel: "C1", latest: LATEST, oldest: "1690000000", pageSize: undefined }]);
    expect(repliesRequests).toEqual([
      { channel: "C1", oldest: "1690000000", pageSize: undefined, ts: "1700000000.000100" },
    ]);
    expect(events).toEqual([
      { awaiting: "first-page" },
      { progressed: "page", rows: 0 },
      { awaiting: "page-threads" },
      { progressed: "thread", rows: 3 },
    ]);
  });

  it("carries no walkedMessages key when Slack reports hasMore with no cursor to follow", async () => {
    const api = scriptedApi({
      history: async () => ({ hasMore: true, messages: [QUIET] }),
      historyRequests: [],
      replies: { messages: [] },
      repliesRequests: [],
    });

    const read = await fetchChannel({
      api,
      ctx: CTX,
      deadline: scriptedDeadline({ events: [], expiry: NEVER }),
      latest: LATEST,
      plan: PLAN,
      threadCursors: {},
    });

    expect(Object.keys(read).toSorted()).toEqual(["cursorUpdates", "flushed", "items", "kind", "warnings"]);
  });

  it("answers the deadline's own snapshot as a stalled read when the expiry settles before history answers", async () => {
    const at: ChannelProgressSnapshot = {
      elapsedMs: 600_500,
      pages: 0,
      phase: "first-page",
      rows: 0,
      sinceProgressMs: 600_500,
      threads: 0,
      timeoutMs: 600_000,
    };
    const api = scriptedApi({
      history: () => new Promise<SlackMessagesPage>(() => undefined),
      historyRequests: [],
      replies: { messages: [] },
      repliesRequests: [],
    });

    const read = await fetchChannel({
      api,
      ctx: CTX,
      deadline: scriptedDeadline({ events: [], expiry: Promise.resolve(at) }),
      latest: LATEST,
      plan: PLAN,
      threadCursors: {},
    });

    expect(read).toStrictEqual({ at, kind: "stalled" });
  });
});

describe("bindPartialCommit", () => {
  const CHANNEL: SlackChannelRef = { id: "C1", name: "general" };
  const MAPS: SlackNameMaps = { channelNames: { C1: "general" }, userNames: { U1: "ada" } };

  it("answers undefined when the run has no partial-commit seam", () => {
    expect(bindPartialCommit({ channel: CHANNEL, maps: MAPS, seam: undefined })).toBe(undefined);
  });

  it("forwards its conversation and maps with each batch, and answers the seam's own result", () => {
    const calls: Parameters<SlackChannelPartialCommit>[0][] = [];
    const seam: SlackChannelPartialCommit = (args) => {
      calls.push(args);
      return ok({ written: 7 });
    };
    const items: SlackChannelItems = { channelId: "C1", messages: [], replies: [] };

    const bound = bindPartialCommit({ channel: CHANNEL, maps: MAPS, seam })!;
    const banked = bound({ items });

    expect(unwrap(banked)).toEqual({ written: 7 });
    expect(calls).toEqual([{ channel: CHANNEL, items, maps: MAPS }]);
  });
});
