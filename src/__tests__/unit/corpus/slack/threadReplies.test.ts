/**
 * `pollThread` — one thread's NEW replies since its stored cursor, through a scripted `SlackApi` whose
 * `replies` answers by cursor and records every request. Pinned: a page holding only the parent does not end
 * the walk, a reply AT the stored cursor is not re-ingested, the cursor advance carries the observed reply
 * count (zero included), a thrown page keeps what was already read and says so, and a repeated cursor stops
 * the walk with its warning.
 */
import { describe, expect, it } from "vitest";

import type { SlackApi, SlackMessagesPage } from "../../../../corpus/slack/fetch.js";
import type { ChannelContext } from "../../../../corpus/slack/shape.js";
import { pollThread } from "../../../../corpus/slack/threadReplies.js";

const CTX: ChannelContext = { channelId: "C1", channelName: "general", workspaceUrl: "https://acme.slack.com" };
const THREAD = "1700000000.000100";
const WINDOW_OLDEST = "1690000000";

const PARENT = { text: "parent", ts: THREAD, user: "U1" };
const REPLY_A = { text: "first reply", ts: "1700000100.000200", user: "U2" };
const REPLY_B = { text: "second reply", ts: "1700000200.000300", user: "U3" };

/** The shaped item for {@link REPLY_A}. */
const ITEM_A = {
  author: "U2",
  channelId: "C1",
  channelName: "general",
  files: [],
  permalink: "https://acme.slack.com/archives/C1/p1700000100000200",
  raw: REPLY_A,
  text: "first reply",
  threadTs: THREAD,
  ts: "1700000100.000200",
  tsIso: "2023-11-14T22:15:00.000Z",
};

/** The shaped item for {@link REPLY_B}. */
const ITEM_B = {
  author: "U3",
  channelId: "C1",
  channelName: "general",
  files: [],
  permalink: "https://acme.slack.com/archives/C1/p1700000200000300",
  raw: REPLY_B,
  text: "second reply",
  threadTs: THREAD,
  ts: "1700000200.000300",
  tsIso: "2023-11-14T22:16:40.000Z",
};

/** One `conversations.replies` request as the fake saw it. */
type RepliesRequest = Parameters<SlackApi["replies"]>[0];

/** The first page is the one requested with no cursor at all. */
const FIRST_PAGE = undefined;

/**
 * A Slack seam whose `replies` answers from `pages`, keyed by the requested cursor ({@link FIRST_PAGE} for the
 * first page), and throws for the cursor named in `throwOn`. Every other method refuses, since a thread poll
 * calls none.
 */
function scriptedApi({
  pages,
  requests,
  throwOn,
}: {
  pages: ReadonlyMap<string | undefined, SlackMessagesPage>;
  requests: RepliesRequest[];
  throwOn?: string;
}): SlackApi {
  const refuse = async (): Promise<never> => {
    throw new Error("a thread poll calls only conversations.replies");
  };
  return {
    filesInfo: refuse,
    grantedScopes: refuse,
    history: refuse,
    listChannels: refuse,
    listUsers: refuse,
    replies: async (args) => {
      requests.push(args);
      if (throwOn !== undefined && args.cursor === throwOn) {
        throw new Error("socket hang up");
      }
      return pages.get(args.cursor)!;
    },
    workspaceUrl: refuse,
  };
}

describe("pollThread", () => {
  it("follows the cursor past a page holding only the parent, and advances the cursor to the newest reply", async () => {
    const requests: RepliesRequest[] = [];
    const api = scriptedApi({
      pages: new Map([
        [FIRST_PAGE, { messages: [PARENT], nextCursor: "page-2" }],
        ["page-2", { messages: [REPLY_A] }],
      ]),
      requests,
    });

    const poll = await pollThread({ api, ctx: CTX, stored: undefined, threadTs: THREAD, windowOldest: WINDOW_OLDEST });

    expect(requests).toEqual([
      { channel: "C1", oldest: WINDOW_OLDEST, pageSize: undefined, ts: THREAD },
      { channel: "C1", cursor: "page-2", oldest: WINDOW_OLDEST, pageSize: undefined, ts: THREAD },
    ]);
    expect(poll).toEqual({
      cursorUpdate: { cursor: { ts: "1700000100.000200" }, key: "C1:1700000000.000100" },
      replies: [ITEM_A],
      warnings: [],
    });
  });

  it("reads from the stored cursor, drops the reply AT it, keeps the newer one, and stores an observed count of 0", async () => {
    const requests: RepliesRequest[] = [];
    const api = scriptedApi({ pages: new Map([[FIRST_PAGE, { messages: [PARENT, REPLY_A, REPLY_B] }]]), requests });

    const poll = await pollThread({
      api,
      ctx: CTX,
      observedReplyCount: 0,
      stored: "1700000100.000200",
      threadTs: THREAD,
      windowOldest: WINDOW_OLDEST,
    });

    expect(requests).toEqual([{ channel: "C1", oldest: "1700000100.000200", pageSize: undefined, ts: THREAD }]);
    expect(poll).toEqual({
      cursorUpdate: { cursor: { replyCount: 0, ts: "1700000200.000300" }, key: "C1:1700000000.000100" },
      replies: [ITEM_B],
      warnings: [],
    });
  });

  it("re-states the stored cursor when nothing newer arrived, and carries no cursorUpdate key for a never-read empty thread", async () => {
    const quiet = await pollThread({
      api: scriptedApi({ pages: new Map([[FIRST_PAGE, { messages: [PARENT, REPLY_A] }]]), requests: [] }),
      ctx: CTX,
      stored: "1700000100.000200",
      threadTs: THREAD,
      windowOldest: WINDOW_OLDEST,
    });
    const empty = await pollThread({
      api: scriptedApi({ pages: new Map([[FIRST_PAGE, { messages: [PARENT] }]]), requests: [] }),
      ctx: CTX,
      stored: undefined,
      threadTs: THREAD,
      windowOldest: WINDOW_OLDEST,
    });

    expect(quiet).toEqual({
      cursorUpdate: { cursor: { ts: "1700000100.000200" }, key: "C1:1700000000.000100" },
      replies: [],
      warnings: [],
    });
    expect(empty).toStrictEqual({ replies: [], warnings: [] });
  });

  it("keeps the replies already read when a later page throws, and names the failure in a warning", async () => {
    const api = scriptedApi({
      pages: new Map([[FIRST_PAGE, { messages: [PARENT, REPLY_A], nextCursor: "page-2" }]]),
      requests: [],
      throwOn: "page-2",
    });

    const poll = await pollThread({ api, ctx: CTX, stored: undefined, threadTs: THREAD, windowOldest: WINDOW_OLDEST });

    expect(poll).toEqual({
      cursorUpdate: { cursor: { ts: "1700000100.000200" }, key: "C1:1700000000.000100" },
      replies: [ITEM_A],
      warnings: ["thread C1/1700000000.000100 replies failed: socket hang up"],
    });
  });

  it("stops after a page that repeats the cursor it was fetched with, warning that the walk may be incomplete", async () => {
    const requests: RepliesRequest[] = [];
    const api = scriptedApi({
      pages: new Map([
        [FIRST_PAGE, { messages: [PARENT], nextCursor: "loop" }],
        ["loop", { messages: [REPLY_A], nextCursor: "loop" }],
      ]),
      requests,
    });

    const poll = await pollThread({ api, ctx: CTX, stored: undefined, threadTs: THREAD, windowOldest: WINDOW_OLDEST });

    expect(requests.length).toBe(2);
    expect(poll.replies).toEqual([ITEM_A]);
    expect(poll.warnings).toEqual([
      "slack replies for C1/1700000000.000100 may be incomplete: the endpoint repeated pagination cursor loop instead of advancing",
    ]);
  });

  it("asks for at most maxItems and requests no further page once that many replies are held", async () => {
    const requests: RepliesRequest[] = [];
    const api = scriptedApi({
      pages: new Map([
        [FIRST_PAGE, { messages: [PARENT, REPLY_A], nextCursor: "page-2" }],
        ["page-2", { messages: [REPLY_B] }],
      ]),
      requests,
    });

    const poll = await pollThread({
      api,
      ctx: CTX,
      maxItems: 1,
      stored: undefined,
      threadTs: THREAD,
      windowOldest: WINDOW_OLDEST,
    });

    expect(requests).toEqual([{ channel: "C1", oldest: WINDOW_OLDEST, pageSize: 1, ts: THREAD }]);
    expect(poll.replies).toEqual([ITEM_A]);
    expect(poll.warnings).toEqual([]);
  });
});
