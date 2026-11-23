import { describe, expect, it } from "vitest";

import type { SlackApi, SlackChannelsPage, SlackMessagesPage } from "../../../../corpus/slack/fetch.js";
import type { SlackConversationLane } from "../../../../corpus/slack/lanes.js";
import { unwrap, unwrapErr } from "../../../../lib/result.js";
import { fetchCompleteSlackChannels } from "../../../../live/slack/channelPagination.js";
import {
  fetchCompleteSlackHistory,
  fetchCompleteSlackThread,
  fetchCompleteSlackThreadSince,
} from "../../../../live/slack/pagination.js";

const CHANNEL = "C123";
const THREAD = "1785114398.557099";
const OLDEST = "1785000000";
const LATEST = "1786000000";

/** A plain fake history seam that serves the given pages in order over a fixed window. */
function historyServing({ pages }: { pages: readonly SlackMessagesPage[] }): Pick<SlackApi, "history"> {
  let index = 0;
  return {
    history: async (args) => {
      const page = pages[index];
      index += 1;
      if (page === undefined) {
        throw new Error(`fake asked for page ${String(index)} but only ${String(pages.length)} were provided`);
      }
      // Prove the caller always asks for the exact window it was given, never a different one.
      expect(args.oldest).toBe(OLDEST);
      expect(args.latest).toBe(LATEST);
      return page;
    },
  };
}

/** A plain fake replies seam that serves the given pages in order. Not a mock — an injected function. */
function repliesServing({ pages }: { pages: readonly SlackMessagesPage[] }): Pick<SlackApi, "replies"> {
  let index = 0;
  return {
    replies: async (args) => {
      const page = pages[index];
      index += 1;
      if (page === undefined) {
        throw new Error(`fake asked for page ${String(index)} but only ${String(pages.length)} were provided`);
      }
      // Prove the caller always asks for the whole thread, never a window.
      expect(args.oldest).toBe("0");
      expect(args.ts).toBe(THREAD);
      return page;
    },
  };
}

describe("fetchCompleteSlackThread", () => {
  it("returns every message across pages when the cursor is exhausted", async () => {
    // Shaped the way Slack ACTUALLY paginates: the thread parent is messages[0] of EVERY page. Verified
    // against a real 311-message thread. The earlier fixture omitted the repeat, which is precisely why a
    // bug that broke every >200-reply thread survived a green suite.
    const api = repliesServing({
      pages: [
        { messages: [{ ts: THREAD }, { ts: "1.000001" }], nextCursor: "c1" },
        { messages: [{ ts: THREAD }, { ts: "1.000002" }] },
      ],
    });

    const fetched = unwrap(await fetchCompleteSlackThread({ api, channel: CHANNEL, threadTs: THREAD }));

    // The fetcher is a faithful transport: it returns what Slack sent, repeats included. Deduping the
    // repeated parent is `projectSlackThread`'s job, and it is tested there.
    expect(fetched.rawMessages.length).toBe(4);
    expect(fetched.pageCount).toBe(2);
    expect(fetched.cursorExhausted).toBe(true);
  });

  it("keeps paging through a ZERO-ITEM page that still carries a cursor", async () => {
    // A zero-item page whose cursor moved is a real Slack shape, documented on the Conversations API. The
    // shared `collectCursorPages` used to stop here; both loops now follow the cursor, and this asserts it for
    // the complete-or-fail one, where a prefix would be answered as if it were the whole thread.
    const api = repliesServing({
      pages: [
        { messages: [{ ts: THREAD }], nextCursor: "c1" },
        { messages: [], nextCursor: "c2" },
        { messages: [{ ts: "1.000009" }] },
      ],
    });

    const fetched = unwrap(await fetchCompleteSlackThread({ api, channel: CHANNEL, threadTs: THREAD }));

    expect(fetched.rawMessages.length).toBe(2);
    expect(fetched.pageCount).toBe(3);
    expect(fetched.pageStarts).toEqual([0, 1, 1]);
  });

  it("refuses when Slack says has_more but supplies no cursor", async () => {
    const api = repliesServing({ pages: [{ hasMore: true, messages: [{ ts: THREAD }] }] });

    const result = await fetchCompleteSlackThread({ api, channel: CHANNEL, threadTs: THREAD });

    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result).message).toContain("has_more with no pagination cursor");
  });

  it("accepts has_more:false with no cursor as a complete thread", async () => {
    const api = repliesServing({ pages: [{ hasMore: false, messages: [{ ts: THREAD }] }] });

    const fetched = unwrap(await fetchCompleteSlackThread({ api, channel: CHANNEL, threadTs: THREAD }));

    expect(fetched.rawMessages.length).toBe(1);
  });

  it("refuses a repeated cursor instead of spinning", async () => {
    const api = repliesServing({
      pages: [
        { messages: [{ ts: THREAD }], nextCursor: "same" },
        { messages: [{ ts: "1.000001" }], nextCursor: "same" },
      ],
    });

    const result = await fetchCompleteSlackThread({ api, channel: CHANNEL, threadTs: THREAD });

    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result).message).toContain("repeated a pagination cursor");
  });

  it("returns NO messages when a later page throws — never a partial prefix", async () => {
    const api: Pick<SlackApi, "replies"> = {
      replies: async ({ cursor }) => {
        if (cursor === undefined) {
          return { messages: [{ ts: THREAD }], nextCursor: "c1" };
        }
        throw new Error("rate limited");
      },
    };

    const result = await fetchCompleteSlackThread({ api, channel: CHANNEL, threadTs: THREAD });

    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result).message).toContain("rate limited");
  });

  it("explains a stale link instead of surfacing Slack's raw error code", async () => {
    // The commonest real failure: a link to a message that has since been deleted. Verified against the
    // live API — an ordinary message with NO replies is a different case and reads fine, so this message
    // must not suggest "no replies" as the cause.
    const api: Pick<SlackApi, "replies"> = {
      replies: async () => {
        throw new Error("An API error occurred: thread_not_found");
      },
    };

    const result = await fetchCompleteSlackThread({ api, channel: CHANNEL, threadTs: THREAD });

    expect(result.isErr()).toBe(true);
    const message = unwrapErr(result).message;
    expect(message).toContain("no thread at");
    expect(message).toContain("deleted");
  });

  it("types not_in_channel on a THREAD read exactly as the history read does, so a sweep can exclude it", async () => {
    // The thread-stage half of the pinned-watermark defect: a remembered thread in a channel
    // the bot had been removed from decoded to the generic PAGE_FETCH_FAILED, which no caller could tell
    // apart from a rate limit.
    const api: Pick<SlackApi, "replies"> = {
      replies: async () => {
        throw new Error("An API error occurred: not_in_channel");
      },
    };

    const result = await fetchCompleteSlackThread({ api, channel: CHANNEL, threadTs: THREAD });

    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result).code).toBe("NOT_IN_CHANNEL");
    expect(unwrapErr(result).message).toContain(CHANNEL);
  });

  it("types channel_not_found on a THREAD read as CHANNEL_NOT_FOUND", async () => {
    const api: Pick<SlackApi, "replies"> = {
      replies: async () => {
        throw new Error("An API error occurred: channel_not_found");
      },
    };

    const result = await fetchCompleteSlackThreadSince({ api, channel: CHANNEL, oldest: "1.000000", threadTs: THREAD });

    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result).code).toBe("CHANNEL_NOT_FOUND");
    expect(unwrapErr(result).message).toContain("channel_not_found");
  });

  it("reports progress per page", async () => {
    const seen: { pageCount: number; messageCount: number }[] = [];
    const api = repliesServing({
      pages: [{ messages: [{ ts: THREAD }], nextCursor: "c1" }, { messages: [{ ts: "1.000001" }] }],
    });

    await fetchCompleteSlackThread({
      api,
      channel: CHANNEL,
      onPage: (p) => seen.push(p),
      threadTs: THREAD,
    });

    expect(seen).toEqual([
      { messageCount: 1, pageCount: 1 },
      { messageCount: 2, pageCount: 2 },
    ]);
  });
});

describe("fetchCompleteSlackThreadSince", () => {
  it("forwards the caller-supplied oldest cursor, never the whole-thread '0'", async () => {
    const seen: string[] = [];
    const api: Pick<SlackApi, "replies"> = {
      replies: async (args) => {
        seen.push(args.oldest);
        return { messages: [{ ts: "1.000002" }] };
      },
    };

    await fetchCompleteSlackThreadSince({ api, channel: CHANNEL, oldest: "1785000000.000100", threadTs: THREAD });

    expect(seen).toEqual(["1785000000.000100"]);
  });

  it("still walks to cursor exhaustion across multiple pages", async () => {
    const api = repliesServing({
      pages: [
        { messages: [{ ts: "1785000000.000200" }], nextCursor: "c1" },
        { messages: [{ ts: "1785000000.000300" }] },
      ],
    });

    const fetched = unwrap(
      await fetchCompleteSlackThreadSince({ api, channel: CHANNEL, oldest: "0", threadTs: THREAD }),
    );

    expect(fetched.rawMessages.length).toBe(2);
    expect(fetched.pageCount).toBe(2);
    expect(fetched.cursorExhausted).toBe(true);
  });

  it("refuses a repeated cursor instead of spinning, same as the whole-thread helper", async () => {
    const api: Pick<SlackApi, "replies"> = {
      replies: async () => ({ messages: [{ ts: "1785000000.000200" }], nextCursor: "same" }),
    };

    const result = await fetchCompleteSlackThreadSince({ api, channel: CHANNEL, oldest: "0", threadTs: THREAD });

    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result).message).toContain("repeated a pagination cursor");
  });

  it("refuses has_more with no cursor, same as the whole-thread helper", async () => {
    const api: Pick<SlackApi, "replies"> = {
      replies: async () => ({ hasMore: true, messages: [{ ts: "1785000000.000200" }] }),
    };

    const result = await fetchCompleteSlackThreadSince({ api, channel: CHANNEL, oldest: "0", threadTs: THREAD });

    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result).message).toContain("has_more with no pagination cursor");
  });

  it("leaves fetchCompleteSlackThread's own oldest: '0' contract unchanged", async () => {
    const seen: string[] = [];
    const api: Pick<SlackApi, "replies"> = {
      replies: async (args) => {
        seen.push(args.oldest);
        return { messages: [{ ts: THREAD }] };
      },
    };

    await fetchCompleteSlackThread({ api, channel: CHANNEL, threadTs: THREAD });

    expect(seen).toEqual(["0"]);
  });
});

describe("fetchCompleteSlackHistory", () => {
  it("pages to cursor exhaustion and carries the interactive pacing choice on every call", async () => {
    const called: Parameters<SlackApi["history"]>[0][] = [];
    const api: Pick<SlackApi, "history"> = {
      history: async (args) => {
        called.push(args);
        return args.cursor === undefined
          ? { messages: [{ ts: "2.000002" }], nextCursor: "c1" }
          : { messages: [{ ts: "1.000001" }] };
      },
    };

    const fetched = unwrap(
      await fetchCompleteSlackHistory({
        api,
        channel: CHANNEL,
        latest: "9999999999",
        oldest: "0",
        paced: true,
      }),
    );

    expect(called).toEqual([
      { channel: CHANNEL, latest: "9999999999", oldest: "0", paced: true },
      { channel: CHANNEL, cursor: "c1", latest: "9999999999", oldest: "0", paced: true },
    ]);
    expect(fetched.rawMessages).toEqual([{ ts: "2.000002" }, { ts: "1.000001" }]);
    expect(fetched.pageCount).toBe(2);
  });

  it("follows the cursor past an UNDER-filled page and asks for `oldest` inclusively on every page", async () => {
    const called: Parameters<SlackApi["history"]>[0][] = [];
    const api: Pick<SlackApi, "history"> = {
      history: async (args) => {
        called.push(args);
        return args.cursor === undefined
          ? { hasMore: true, messages: [{ ts: "3.000003" }], nextCursor: "c1" }
          : { hasMore: false, messages: [{ ts: "1.000001" }] };
      },
    };

    const fetched = unwrap(
      await fetchCompleteSlackHistory({ api, channel: CHANNEL, inclusive: true, latest: "9", oldest: "1.000001" }),
    );

    expect(called).toEqual([
      { channel: CHANNEL, inclusive: true, latest: "9", oldest: "1.000001" },
      { channel: CHANNEL, cursor: "c1", inclusive: true, latest: "9", oldest: "1.000001" },
    ]);
    expect(fetched.rawMessages).toEqual([{ ts: "3.000003" }, { ts: "1.000001" }]);
  });

  it("refuses at a caller's TIGHTER page budget, so a window opened by data has a worst case", async () => {
    let calls = 0;
    const api: Pick<SlackApi, "history"> = {
      history: async () => {
        calls += 1;
        return { messages: [{ ts: `${String(calls)}.000001` }], nextCursor: `c${String(calls)}` };
      },
    };

    const refused = await fetchCompleteSlackHistory({
      api,
      channel: CHANNEL,
      latest: "9999999999",
      maxPages: 2,
      oldest: "0",
    });

    expect(refused.isErr()).toBe(true);
    expect(unwrapErr(refused).code).toBe("PAGE_CEILING_EXCEEDED");
    expect(unwrapErr(refused).message).toContain("2");
    expect(calls).toBe(2);
  });

  it("returns every message across pages when the cursor is exhausted", async () => {
    const api = historyServing({
      pages: [
        { messages: [{ ts: "1785000100.000001" }, { ts: "1785000200.000001" }], nextCursor: "c1" },
        { messages: [{ ts: "1785000300.000001" }] },
      ],
    });

    const fetched = unwrap(await fetchCompleteSlackHistory({ api, channel: CHANNEL, latest: LATEST, oldest: OLDEST }));

    expect(fetched.rawMessages.length).toBe(3);
    expect(fetched.pageCount).toBe(2);
    expect(fetched.cursorExhausted).toBe(true);
  });

  it("keeps paging through a ZERO-ITEM page that still carries a cursor", async () => {
    const api = historyServing({
      pages: [
        { messages: [{ ts: "1785000100.000001" }], nextCursor: "c1" },
        { messages: [], nextCursor: "c2" },
        { messages: [{ ts: "1785000200.000001" }] },
      ],
    });

    const fetched = unwrap(await fetchCompleteSlackHistory({ api, channel: CHANNEL, latest: LATEST, oldest: OLDEST }));

    expect(fetched.rawMessages.length).toBe(2);
    expect(fetched.pageCount).toBe(3);
  });

  it("refuses when Slack says has_more but supplies no cursor", async () => {
    const api = historyServing({ pages: [{ hasMore: true, messages: [{ ts: "1785000100.000001" }] }] });

    const result = await fetchCompleteSlackHistory({ api, channel: CHANNEL, latest: LATEST, oldest: OLDEST });

    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result).message).toContain("has_more with no pagination cursor");
  });

  it("accepts has_more:false with no cursor as a complete window", async () => {
    const api = historyServing({ pages: [{ hasMore: false, messages: [{ ts: "1785000100.000001" }] }] });

    const fetched = unwrap(await fetchCompleteSlackHistory({ api, channel: CHANNEL, latest: LATEST, oldest: OLDEST }));

    expect(fetched.rawMessages.length).toBe(1);
  });

  it("refuses a repeated cursor instead of spinning", async () => {
    const api = historyServing({
      pages: [
        { messages: [{ ts: "1785000100.000001" }], nextCursor: "same" },
        { messages: [{ ts: "1785000200.000001" }], nextCursor: "same" },
      ],
    });

    const result = await fetchCompleteSlackHistory({ api, channel: CHANNEL, latest: LATEST, oldest: OLDEST });

    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result).message).toContain("repeated a pagination cursor");
  });

  it("returns NO messages when a later page throws — never a partial prefix", async () => {
    const api: Pick<SlackApi, "history"> = {
      history: async ({ cursor }) => {
        if (cursor === undefined) {
          return { messages: [{ ts: "1785000100.000001" }], nextCursor: "c1" };
        }
        throw new Error("rate limited");
      },
    };

    const result = await fetchCompleteSlackHistory({ api, channel: CHANNEL, latest: LATEST, oldest: OLDEST });

    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result).message).toContain("rate limited");
  });

  it("names the channel in a thrown SDK error rather than surfacing it bare", async () => {
    const api: Pick<SlackApi, "history"> = {
      history: async () => {
        throw new Error("An API error occurred: channel_not_found");
      },
    };

    const result = await fetchCompleteSlackHistory({ api, channel: CHANNEL, latest: LATEST, oldest: OLDEST });

    expect(result.isErr()).toBe(true);
    const message = unwrapErr(result).message;
    expect(message).toContain(CHANNEL);
    expect(message).toContain("channel_not_found");
  });

  it("reports progress per page", async () => {
    const seen: { pageCount: number; messageCount: number }[] = [];
    const api = historyServing({
      pages: [
        { messages: [{ ts: "1785000100.000001" }], nextCursor: "c1" },
        { messages: [{ ts: "1785000200.000001" }] },
      ],
    });

    await fetchCompleteSlackHistory({
      api,
      channel: CHANNEL,
      latest: LATEST,
      oldest: OLDEST,
      onPage: (p) => seen.push(p),
    });

    expect(seen).toEqual([
      { messageCount: 1, pageCount: 1 },
      { messageCount: 2, pageCount: 2 },
    ]);
  });
});

/**
 * A plain fake channel-discovery seam that serves the given pages in order, PER LANE. Not a mock — an
 * injected function. Discovery walks the channel lane and the group-DM lane separately (Slack returns no
 * group DM while `public_channel` is in the same `types` list), so a lane-blind fake would serve the same
 * pages twice and every count below would double. `groupDmPages` defaults to one empty exhausted page:
 * that call is really made, so it really is counted.
 */
function channelsServing({
  pages,
  groupDmPages = [{ channels: [] }],
}: {
  pages: readonly SlackChannelsPage[];
  groupDmPages?: readonly SlackChannelsPage[];
}): Pick<SlackApi, "listChannels"> {
  const served: Record<SlackConversationLane, number> = { "channels-and-dms": 0, "group-dms": 0 };
  return {
    listChannels: async ({ lane }) => {
      const lanePages = lane === "group-dms" ? groupDmPages : pages;
      const index = served[lane];
      served[lane] += 1;
      const page = lanePages[index];
      if (page === undefined) {
        throw new Error(
          `fake asked ${lane} for page ${String(index + 1)} but only ${String(lanePages.length)} were provided`,
        );
      }
      return page;
    },
  };
}

describe("fetchCompleteSlackChannels", () => {
  it("returns every channel across pages when the cursor is exhausted", async () => {
    const api = channelsServing({
      pages: [{ channels: [{ id: "C1" }, { id: "C2" }], nextCursor: "c1" }, { channels: [{ id: "C3" }] }],
    });

    const fetched = unwrap(await fetchCompleteSlackChannels({ api }));

    expect(fetched.channels.map((c) => c.id)).toEqual(["C1", "C2", "C3"]);
    expect(fetched.pageCount).toBe(3); // two channel pages + the group-DM lane's own exhausted page
    expect(fetched.cursorExhausted).toBe(true);
  });

  it("keeps paging through a ZERO-ITEM page that still carries a cursor", async () => {
    const api = channelsServing({
      pages: [
        { channels: [{ id: "C1" }], nextCursor: "c1" },
        { channels: [], nextCursor: "c2" },
        { channels: [{ id: "C2" }] },
      ],
    });

    const fetched = unwrap(await fetchCompleteSlackChannels({ api }));

    expect(fetched.channels.map((c) => c.id)).toEqual(["C1", "C2"]);
    expect(fetched.pageCount).toBe(4);
  });

  it("refuses a repeated cursor instead of spinning", async () => {
    const api = channelsServing({
      pages: [
        { channels: [{ id: "C1" }], nextCursor: "same" },
        { channels: [{ id: "C2" }], nextCursor: "same" },
      ],
    });

    const result = await fetchCompleteSlackChannels({ api });

    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result).message).toContain("repeated a slack channel discovery pagination cursor");
  });

  it("returns NO channels when a later page throws — never a partial prefix", async () => {
    const api: Pick<SlackApi, "listChannels"> = {
      listChannels: async ({ cursor }) => {
        if (cursor === undefined) {
          return { channels: [{ id: "C1" }], nextCursor: "c1" };
        }
        throw new Error("rate limited");
      },
    };

    const result = await fetchCompleteSlackChannels({ api });

    expect(result.isErr()).toBe(true);
    expect(unwrapErr(result).message).toContain("rate limited");
  });

  it("retains isIm/isMpim/isPrivate metadata through channelsFromPage", async () => {
    const api = channelsServing({ pages: [{ channels: [{ id: "D1", is_im: true }] }] });

    const fetched = unwrap(await fetchCompleteSlackChannels({ api }));

    expect(fetched.channels).toEqual([{ id: "D1", isIm: true }]);
  });

  it("reports progress per page", async () => {
    const seen: { pageCount: number; channelCount: number }[] = [];
    const api = channelsServing({
      pages: [{ channels: [{ id: "C1" }], nextCursor: "c1" }, { channels: [{ id: "C2" }] }],
    });

    await fetchCompleteSlackChannels({ api, onPage: (p) => seen.push(p) });

    expect(seen).toEqual([
      { channelCount: 1, pageCount: 1 },
      { channelCount: 2, pageCount: 2 },
      // the group-DM lane is a third page, reported with the running total across both lanes
      { channelCount: 2, pageCount: 3 },
    ]);
  });
});
