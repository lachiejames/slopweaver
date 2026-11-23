/**
 * The crawl's memory must grow with the WORKSPACE's shape, not with its content.
 *
 * MEASURED: an epoch-wide backfill climbed from 4.39 GB to 5.15 GB in its last 13 minutes and
 * died of `Ineffective mark-compacts near heap limit` at conversation 95 of 603 — because every conversation
 * the crawl had already COMMITTED to bronze was still being held in the run's accumulator. These tests assert
 * on the accumulator's SHAPE rather than on process RSS, which is not a unit-testable quantity: a banked
 * conversation must survive as a summary, and its items must be gone.
 */
import { describe, expect, it } from "vitest";
import { computeChannelWatermarks } from "../../../../corpus/slack/channelWatermark.js";
import { rankChannelsByActivity } from "../../../../corpus/slack/curatedFetch.js";
import {
  fetchSlackActivity,
  type SlackApi,
  type SlackChannelCommit,
  summariseSlackChannel,
} from "../../../../corpus/slack/fetch.js";
import type { ExportWindow } from "../../../../corpus/types.js";
import { err, ok, unwrap } from "../../../../lib/result.js";

const window: ExportWindow = { since: "1970-01-01", until: "2026-08-23" };

/** Raw `conversations.history` rows per channel — C_A is the busiest, C_C carries the only thread. */
const HISTORY: Readonly<Record<string, readonly unknown[]>> = {
  C_A: [
    { text: "a1", ts: "1700000000.000100", user: "U1" },
    { text: "a2", ts: "1700000060.000100", user: "U1" },
    { text: "a3", ts: "1700000120.000100", user: "U1" },
  ],
  C_B: [{ text: "b1", ts: "1700000300.000100", user: "U1" }],
  C_C: [{ reply_count: 1, text: "c1", ts: "1700000000.000900", user: "U1" }],
};

/** A three-conversation workspace: one private, one archived, one with a thread reply after its parent. */
function threeChannelApi(): SlackApi {
  return {
    filesInfo: async ({ fileId }) => {
      throw new Error(`the crawl must not call files.info, but it did for ${fileId}`);
    },
    grantedScopes: async () => [],
    history: async ({ channel }) => {
      const messages = HISTORY[channel];
      // Every channel `listChannels` names below is seeded, so an unseeded one is a broken fixture, never "empty".
      if (messages === undefined) {
        throw new Error(`no history is seeded for ${channel}`);
      }
      return { messages };
    },
    listChannels: async () => ({
      channels: [
        { id: "C_A", is_member: true, name: "alpha" },
        { id: "C_B", is_member: true, is_private: true, name: "beta" },
        { id: "C_C", is_archived: true, is_member: true, name: "gamma" },
      ],
    }),
    listUsers: async () => ({ members: [{ id: "U1", profile: {}, real_name: "Ada" }] }),
    replies: async ({ ts }) => ({
      messages: [
        { text: "c1", ts, user: "U1" },
        { text: "c-reply", thread_ts: ts, ts: "1700000400.000100", user: "U1" },
      ],
    }),
    workspaceUrl: async () => "https://acme.slack.com",
  };
}

/** Commit every conversation successfully — the shape a real unbounded `refresh` runs in. */
const commitEverything: SlackChannelCommit = ({ items }) => ok({ written: items.messages.length });

describe("summariseSlackChannel", () => {
  it("keeps the identity and privacy signals, and folds the items down to a count and one timestamp", () => {
    expect(
      summariseSlackChannel({
        items: {
          channelId: "C_A",
          channelName: "alpha",
          isArchived: true,
          messages: [
            { channelId: "C_A", files: [], permalink: "p", reactions: [], ts: "1", tsIso: "2026-05-01T00:00:00.000Z" },
            { channelId: "C_A", files: [], permalink: "p", reactions: [], ts: "2", tsIso: "2026-05-03T00:00:00.000Z" },
          ],
          replies: [
            {
              channelId: "C_A",
              files: [],
              permalink: "p",
              threadTs: "1",
              ts: "3",
              tsIso: "2026-05-02T00:00:00.000Z",
            },
          ],
        },
      }),
    ).toEqual({
      channelId: "C_A",
      channelName: "alpha",
      isArchived: true,
      itemCount: 3,
      maxTsIso: "2026-05-03T00:00:00.000Z",
    });
  });

  it("reports an empty conversation as zero items and no timestamp, never as absent", () => {
    expect(summariseSlackChannel({ items: { channelId: "C_Q", messages: [], replies: [] } })).toEqual({
      channelId: "C_Q",
      itemCount: 0,
      maxTsIso: "",
    });
  });
});

describe("fetchSlackActivity retains nothing it has already banked", () => {
  it("holds no items for a committed conversation, while still describing every one of them", async () => {
    const activity = unwrap(
      await fetchSlackActivity({ api: threeChannelApi(), onChannelCommit: commitEverything, window }),
    );
    expect(activity.retainedChannels).toEqual([]);
    expect(activity.channelSummaries).toEqual([
      {
        channelId: "C_A",
        channelName: "alpha",
        isMember: true,
        itemCount: 3,
        maxTsIso: "2023-11-14T22:15:20.000Z",
      },
      {
        channelId: "C_B",
        channelName: "beta",
        isMember: true,
        isPrivate: true,
        itemCount: 1,
        maxTsIso: "2023-11-14T22:18:20.000Z",
      },
      {
        channelId: "C_C",
        channelName: "gamma",
        isArchived: true,
        isMember: true,
        itemCount: 2,
        maxTsIso: "2023-11-14T22:20:00.000Z",
      },
    ]);
    expect(activity.visitedChannels).toEqual(["C_A", "C_B", "C_C"]);
  });

  it("keeps every conversation's items when NO commit seam banked them — the write-once path is unchanged", async () => {
    const activity = unwrap(await fetchSlackActivity({ api: threeChannelApi(), window }));
    expect(activity.retainedChannels.map((channel) => channel.channelId)).toEqual(["C_A", "C_B", "C_C"]);
    expect(activity.retainedChannels.flatMap((channel) => channel.messages).map((message) => message.text)).toEqual([
      "a1",
      "a2",
      "a3",
      "b1",
      "c1",
    ]);
    expect(activity.channelSummaries.map((summary) => summary.itemCount)).toEqual([3, 1, 2]);
  });

  it("keeps the items of a conversation whose commit FAILED — the run has not banked it", async () => {
    const activity = unwrap(
      await fetchSlackActivity({
        api: threeChannelApi(),
        onChannelCommit: ({ items }) => (items.channelId === "C_B" ? err(["disk full"]) : ok({ written: 1 })),
        window,
      }),
    );
    expect(activity.retainedChannels.map((channel) => channel.channelId)).toEqual(["C_B"]);
    expect(activity.retainedChannels[0]!.messages.map((message) => message.text)).toEqual(["b1"]);
    // Not banked ⇒ not visited and not summarised, so the next run still offers it a full backfill.
    expect(activity.visitedChannels).toEqual(["C_A", "C_C"]);
    expect(activity.channelSummaries.map((summary) => summary.channelId)).toEqual(["C_A", "C_C"]);
  });

  it("reports the max timestamp the whole crawl saw, which is the pooled cursor's only remaining source", async () => {
    const activity = unwrap(
      await fetchSlackActivity({ api: threeChannelApi(), onChannelCommit: commitEverything, window }),
    );
    expect(activity.maxTsIso).toBe("2023-11-14T22:20:00.000Z");
  });

  it("reports no crawl timestamp at all when nothing was read, rather than a false floor", async () => {
    const activity = unwrap(
      await fetchSlackActivity({
        api: { ...threeChannelApi(), history: async () => ({ messages: [] }) },
        onChannelCommit: commitEverything,
        window,
      }),
    );
    expect(activity.maxTsIso).toBe("");
  });
});

describe("the summary carries everything the retainers still need", () => {
  it("ranks the curated lane's targets from summaries alone, busiest first", async () => {
    const activity = unwrap(
      await fetchSlackActivity({ api: threeChannelApi(), onChannelCommit: commitEverything, window }),
    );
    expect(rankChannelsByActivity({ channels: activity.channelSummaries })).toEqual([
      { id: "C_A", name: "alpha" },
      { id: "C_C", name: "gamma" },
      { id: "C_B", name: "beta" },
    ]);
  });

  it("advances every per-channel watermark from summaries alone", async () => {
    const activity = unwrap(
      await fetchSlackActivity({ api: threeChannelApi(), onChannelCommit: commitEverything, window }),
    );
    expect(
      computeChannelWatermarks({
        fallbackUntil: "2026-08-23",
        fullHistory: activity.fullHistoryChannels,
        // After every timestamp in this fixture, so the clock cap changes nothing here.
        nowIso: "2026-08-23T00:00:00.000Z",
        observed: activity.channelSummaries.map((summary) => ({
          channel: summary.channelId,
          tsIso: summary.maxTsIso,
        })),
        visited: activity.visitedChannels,
      }),
    ).toEqual([
      { channel: "C_A", cursor: "2023-11-14T22:15:20.000Z", fullHistory: true },
      { channel: "C_B", cursor: "2023-11-14T22:18:20.000Z", fullHistory: true },
      { channel: "C_C", cursor: "2023-11-14T22:20:00.000Z", fullHistory: true },
    ]);
  });
});
