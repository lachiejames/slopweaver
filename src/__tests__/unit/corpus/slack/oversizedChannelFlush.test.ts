/**
 * One conversation bigger than the heap must still reach bronze.
 *
 * `fetchChannel` used to accumulate a whole conversation and return only when it was exhausted, so the
 * per-conversation commit seam fired after that return and a conversation whose items exceed the heap could
 * NEVER commit — measured, two runs spent ~2.5 h inside one bot feed and neither finished it.
 * These tests pin the flush that bounds it, and — the half that matters more — pin that a flushed PREFIX is
 * rows in bronze and nothing else: it must not read as backfilled, because a silent partial claim is worse
 * than the loud OOM it replaces.
 */
import { describe, expect, it } from "vitest";
import { computeChannelWatermarks } from "../../../../corpus/slack/channelWatermark.js";
import {
  fetchSlackActivity,
  SLACK_CHANNEL_FLUSH_ITEMS,
  type SlackApi,
  type SlackChannelCommit,
  type SlackChannelPartialCommit,
} from "../../../../corpus/slack/fetch.js";
import { planChannelOldest } from "../../../../corpus/slack/reach.js";
import type { ExportWindow } from "../../../../corpus/types.js";
import { err, ok, unwrap } from "../../../../lib/result.js";

const window: ExportWindow = { since: "1970-01-01", until: "2026-08-24" };

/** The clock these plans are judged against — past the window end, so the clock cap changes nothing. */
const NOW = "2026-08-24T09:00:00.000Z";

/** Rows per history page — small enough that a flush needs many pages, so the trigger is really the loop. */
const PAGE = 1_000;

/** `conversations.history` is NEWEST-first, so page 0 carries the newest timestamp in the conversation. */
const tsAt = ({ index }: { index: number }): string => `${1_800_000_000 - index}.000100`;

/**
 * A one-conversation workspace whose history yields `total` rows in {@link PAGE}-row pages.
 *
 * `failAfterPages` makes the read throw once that many pages have been served — the mid-conversation kill
 * whose prefix must not be claimed as a backfill.
 */
function oversizedApi({ total, failAfterPages }: { total: number; failAfterPages?: number }): SlackApi {
  return {
    filesInfo: async ({ fileId }) => {
      throw new Error(`the crawl must not call files.info, but it did for ${fileId}`);
    },
    grantedScopes: async () => [],
    history: async ({ cursor }) => {
      const page = cursor === undefined ? 0 : Number(cursor);
      if (failAfterPages !== undefined && page >= failAfterPages) {
        throw new Error("connection reset mid-conversation");
      }
      const start = page * PAGE;
      const end = Math.min(start + PAGE, total);
      const messages = Array.from({ length: end - start }, (_unused, offset) => ({
        text: `row ${start + offset}`,
        ts: tsAt({ index: start + offset }),
        user: "U1",
      }));
      return end >= total ? { messages } : { messages, nextCursor: String(page + 1) };
    },
    listChannels: async () => ({ channels: [{ id: "C_BIG", is_member: true, name: "big" }] }),
    listUsers: async () => ({ members: [{ id: "U1", profile: {}, real_name: "Ada" }] }),
    replies: async ({ ts }) => ({ messages: [{ text: "parent", ts, user: "U1" }] }),
    workspaceUrl: async () => "https://acme.slack.com",
  };
}

/** What one crawl handed each seam, in the order it handed it over. */
interface Banked {
  readonly prefixes: number[];
  readonly finals: { messages: number; maxTsIso: string; oldest: string }[];
  readonly order: string[];
}

/** Crawl the oversized conversation, recording every prefix flush and every conversation commit. */
async function crawlOversized({
  total,
  failAfterPages,
  withPartialSeam = true,
}: {
  total: number;
  failAfterPages?: number;
  withPartialSeam?: boolean;
}): Promise<{ banked: Banked; activity: Awaited<ReturnType<typeof fetchSlackActivity>> }> {
  const banked: Banked = { finals: [], order: [], prefixes: [] };
  const onChannelPartialCommit: SlackChannelPartialCommit = ({ items }) => {
    banked.prefixes.push(items.messages.length + items.replies.length);
    banked.order.push("prefix");
    return ok({ written: items.messages.length });
  };
  const onChannelCommit: SlackChannelCommit = ({ items, maxTsIso, oldest }) => {
    banked.finals.push({ maxTsIso, messages: items.messages.length, oldest });
    banked.order.push("final");
    return ok({ written: items.messages.length });
  };
  const activity = await fetchSlackActivity({
    api: oversizedApi({ total, ...(failAfterPages !== undefined ? { failAfterPages } : {}) }),
    onChannelCommit,
    window,
    ...(withPartialSeam ? { onChannelPartialCommit } : {}),
  });
  return { activity, banked };
}

describe("flushWithinChannel", () => {
  it("puts a conversation's earlier pages in bronze BEFORE the conversation finishes", async () => {
    const total = 2 * SLACK_CHANNEL_FLUSH_ITEMS + PAGE;
    const { banked } = await crawlOversized({ total });
    expect(banked.prefixes).toEqual([SLACK_CHANNEL_FLUSH_ITEMS, SLACK_CHANNEL_FLUSH_ITEMS]);
    expect(banked.order).toEqual(["prefix", "prefix", "final"]);
  });

  it("RELEASES what it banked, so the conversation's held items stay bounded by the batch", async () => {
    const total = 2 * SLACK_CHANNEL_FLUSH_ITEMS + PAGE;
    const { banked } = await crawlOversized({ total });
    // The tail is everything after the last flush: one page here, never the whole conversation.
    expect(banked.finals).toHaveLength(1);
    expect(banked.finals[0]!.messages).toBe(PAGE);
  });

  it("hands the completion commit the whole conversation's newest timestamp, not the tail's", async () => {
    const total = SLACK_CHANNEL_FLUSH_ITEMS + PAGE;
    const { banked } = await crawlOversized({ total });
    // History is newest-first, so the NEWEST row was in the first flushed page — the tail holds the oldest.
    // A cursor taken from the tail would sit below everything already banked.
    expect(banked.finals[0]!.maxTsIso).toBe("2027-01-15T08:00:00.000Z");
    expect(banked.finals[0]!.oldest).toBe("0");
  });

  it("counts the flushed prefix in the conversation's summary, which the curated lane ranks on", async () => {
    const total = SLACK_CHANNEL_FLUSH_ITEMS + PAGE;
    const { activity } = await crawlOversized({ total });
    const summaries = unwrap(activity).channelSummaries;
    expect(summaries).toHaveLength(1);
    expect(summaries[0]!.itemCount).toBe(total);
    expect(summaries[0]!.channelId).toBe("C_BIG");
  });

  it("stops flushing after a batch that would not write, keeping its items for the end commit", async () => {
    const total = 3 * SLACK_CHANNEL_FLUSH_ITEMS;
    const offered: number[] = [];
    const onChannelPartialCommit: SlackChannelPartialCommit = ({ items }) => {
      offered.push(items.messages.length);
      return err(["disk full"]);
    };
    const finals: number[] = [];
    const onChannelCommit: SlackChannelCommit = ({ items }) => {
      finals.push(items.messages.length);
      return ok({ written: 0 });
    };
    const activity = unwrap(
      await fetchSlackActivity({
        api: oversizedApi({ total }),
        onChannelCommit,
        onChannelPartialCommit,
        window,
      }),
    );
    // Offered ONCE, never re-offered at every later page boundary — a failed batch is not retried.
    expect(offered).toEqual([SLACK_CHANNEL_FLUSH_ITEMS]);
    // And nothing was dropped: the whole conversation still reaches the end commit, exactly as before.
    expect(finals).toEqual([total]);
    expect(activity.warnings.filter((line) => line.includes("prefix NOT flushed"))).toHaveLength(1);
  });

  it("still reads the whole conversation when no partial seam is wired (a bounded run)", async () => {
    const total = SLACK_CHANNEL_FLUSH_ITEMS + PAGE;
    const { banked } = await crawlOversized({ total, withPartialSeam: false });
    expect(banked.prefixes).toEqual([]);
    expect(banked.finals[0]!.messages).toBe(total);
  });
});

describe("a flushed prefix is rows in bronze and NOTHING else", () => {
  it("does not mark the conversation visited or fully backfilled when it dies mid-flush", async () => {
    const total = 4 * SLACK_CHANNEL_FLUSH_ITEMS;
    const { activity, banked } = await crawlOversized({
      failAfterPages: SLACK_CHANNEL_FLUSH_ITEMS / PAGE + 1,
      total,
    });
    // The prefix DID reach bronze — that is the whole point — and the conversation still did not finish.
    expect(banked.prefixes).toEqual([SLACK_CHANNEL_FLUSH_ITEMS]);
    expect(banked.finals).toEqual([]);
    const value = unwrap(activity);
    expect(value.visitedChannels).toEqual([]);
    expect(value.fullHistoryChannels).toEqual([]);
    expect(value.warnings.filter((line) => line.includes("C_BIG"))).toHaveLength(1);
  });

  it("leaves an ORDINARY refresh re-reading the remainder, which the --all path would have hidden", async () => {
    const total = 4 * SLACK_CHANNEL_FLUSH_ITEMS;
    const { activity } = await crawlOversized({ failAfterPages: SLACK_CHANNEL_FLUSH_ITEMS / PAGE + 1, total });
    const value = unwrap(activity);
    const advances = computeChannelWatermarks({
      fallbackUntil: window.until,
      fullHistory: value.fullHistoryChannels,
      nowIso: NOW,
      observed: value.channelSummaries.map((summary) => ({ channel: summary.channelId, tsIso: summary.maxTsIso })),
      visited: value.visitedChannels,
    });
    // No advance at all, so the store keeps no entry — and `planChannelOldest`'s incremental branch, which
    // returns a stored cursor OUTRIGHT without consulting `fullHistory`, has nothing to skip forward to.
    expect(advances).toEqual([]);
    expect(planChannelOldest({ backfillNew: true, nowIso: NOW, stored: undefined, windowOldest: "1700000000" })).toBe(
      "0",
    );
  });
});
