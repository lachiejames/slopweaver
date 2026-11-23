/**
 * `crawlChannels` — the workspace pass over every selected conversation, through a scripted `SlackApi`, a
 * deadline factory that hands each conversation a plain-object watchdog (expiring up front for the one the
 * test wants frozen), a stepped `nowIso`, and a recording commit seam. Pinned: one conversation's failure of
 * any kind (a thrown read, a stall, a failed commit) does not stop the next; what each outcome records and
 * withholds; that every conversation's deadline is released; that the read plan's clock is sampled once per
 * conversation; and that with no commit seam the items are retained.
 *
 * No clock and no timer: every deadline is a plain object and `nowIso` answers fixed instants in order.
 */
import { describe, expect, it } from "vitest";

import type {
  ChannelDeadlineFactory,
  ChannelProgressDeadline,
  ChannelProgressSnapshot,
} from "../../../../corpus/slack/channelDeadline.js";
import { channelStallLine } from "../../../../corpus/slack/channelDeadline.js";
import type {
  SlackApi,
  SlackChannelCommit,
  SlackChannelRef,
  SlackMessagesPage,
} from "../../../../corpus/slack/fetch.js";
import type { ThreadCursors } from "../../../../corpus/slack/threadCursors.js";
import { type ChannelCrawlRun, crawlChannels } from "../../../../corpus/slack/workspaceCrawl.js";
import { err, ok } from "../../../../lib/result.js";

const WORKSPACE = "https://acme.slack.com";
const MAPS = { channelNames: {}, userNames: {} };

/** The instants `nowIso` answers, one per conversation, and the Slack `oldest` each clamps a future floor to. */
const INSTANTS = [
  "2026-01-01T00:00:00.000Z",
  "2026-01-01T00:00:10.000Z",
  "2026-01-01T00:00:20.000Z",
  "2026-01-01T00:00:30.000Z",
];

/** Where the frozen conversation's watchdog says it stopped. */
const STALL: ChannelProgressSnapshot = {
  elapsedMs: 600_100,
  pages: 0,
  phase: "first-page",
  rows: 0,
  sinceProgressMs: 600_100,
  threads: 0,
  timeoutMs: 600_000,
};

/** A history request as the fake saw it. */
type HistoryRequest = Parameters<SlackApi["history"]>[0];

/**
 * A Slack seam whose `history` answers per channel: a page, a thrown error, or a call that never settles.
 * `replies` answers `replies` for any thread.
 */
function scriptedApi({
  pages,
  requests,
  replies = { messages: [] },
}: {
  pages: ReadonlyMap<string, SlackMessagesPage | Error | "hang">;
  requests: HistoryRequest[];
  replies?: SlackMessagesPage;
}): SlackApi {
  const refuse = async (): Promise<never> => {
    throw new Error("a channel crawl calls only conversations.history and conversations.replies");
  };
  return {
    filesInfo: refuse,
    grantedScopes: refuse,
    history: async (args) => {
      requests.push(args);
      const answer = pages.get(args.channel)!;
      if (answer === "hang") {
        return new Promise<SlackMessagesPage>(() => undefined);
      }
      if (answer instanceof Error) {
        throw answer;
      }
      return answer;
    },
    listChannels: refuse,
    listUsers: refuse,
    replies: async () => replies,
    workspaceUrl: refuse,
  };
}

/**
 * A deadline factory handing out one plain-object watchdog per conversation, in order. The conversation at
 * `stallAt` gets one whose expiry has already settled with {@link STALL}; every other one never expires.
 * Each `release` records its conversation's position.
 */
function scriptedDeadlines({ released, stallAt }: { released: number[]; stallAt?: number }): ChannelDeadlineFactory {
  let armed = 0;
  return (): ChannelProgressDeadline => {
    const position = armed;
    armed += 1;
    const expiry =
      position === stallAt ? Promise.resolve(STALL) : new Promise<ChannelProgressSnapshot>(() => undefined);
    return {
      abandoned: () => false,
      awaiting: () => undefined,
      expiry,
      progressed: () => undefined,
      release: () => {
        released.push(position);
      },
    };
  };
}

/** A `nowIso` answering {@link INSTANTS} in order and counting its calls. */
function steppedClock({ calls }: { calls: string[] }): () => string {
  return () => {
    const at = INSTANTS[calls.length]!;
    calls.push(at);
    return at;
  };
}

/** The run bundle every test shares, with the parts each test varies passed in. */
function crawlRun({
  api,
  channelDeadline,
  nowIso,
  onChannelCommit,
  threadCursors = {},
  total,
}: {
  api: SlackApi;
  channelDeadline: ChannelDeadlineFactory;
  nowIso: () => string;
  onChannelCommit?: SlackChannelCommit;
  threadCursors?: ThreadCursors;
  total: number;
}): ChannelCrawlRun {
  return {
    api,
    bounds: { latest: "4100000000", oldest: "4000000000" },
    channelDeadline,
    maps: MAPS,
    nowIso,
    threadCursors,
    total,
    workspaceUrl: WORKSPACE,
    ...(onChannelCommit !== undefined ? { onChannelCommit } : {}),
  };
}

describe("crawlChannels", () => {
  it("banks a committed channel, skips a throwing one, abandons a stalled one and retains a failed commit, in one pass", async () => {
    const c1: SlackChannelRef = { id: "C1", name: "general" };
    const c2: SlackChannelRef = { id: "C2", name: "locked" };
    const c3: SlackChannelRef = { id: "C3", name: "frozen" };
    const c4: SlackChannelRef = { id: "C4", name: "unlucky" };
    const c1Row = { text: "kept", ts: "1767225700.000100", user: "U1" };
    const c4Row = { text: "newer but unbanked", ts: "1767225800.000100", user: "U1" };
    const requests: HistoryRequest[] = [];
    const released: number[] = [];
    const clock: string[] = [];
    const commits: Parameters<SlackChannelCommit>[0][] = [];
    const onChannelCommit: SlackChannelCommit = (args) => {
      commits.push(args);
      return args.channel.id === "C4" ? err(["disk full"]) : ok({ written: 1 });
    };
    const api = scriptedApi({
      pages: new Map<string, SlackMessagesPage | Error | "hang">([
        ["C1", { messages: [c1Row] }],
        ["C2", new Error("not_in_channel")],
        ["C3", "hang"],
        ["C4", { messages: [c4Row] }],
      ]),
      requests,
    });

    const crawl = await crawlChannels({
      backfillNewChannels: false,
      channelCursors: new Map(),
      run: crawlRun({
        api,
        channelDeadline: scriptedDeadlines({ released, stallAt: 2 }),
        nowIso: steppedClock({ calls: clock }),
        onChannelCommit,
        total: 4,
      }),
      selected: [c1, c2, c3, c4],
    });

    expect(crawl.warnings).toEqual([
      "channel C2 skipped: not_in_channel",
      channelStallLine({ at: STALL, channelId: "C3" }),
      "channel C4 read but NOT committed: disk full",
    ]);
    expect(crawl.summaries).toEqual([
      { channelId: "C1", channelName: "general", itemCount: 1, maxTsIso: "2026-01-01T00:01:40.000Z" },
    ]);
    expect(crawl.maxTsIso).toBe("2026-01-01T00:01:40.000Z");
    expect(crawl.visited).toEqual(["C1"]);
    expect(crawl.fullHistory).toEqual([]);
    expect([...crawl.walkedMessages]).toEqual([["C1", 1]]);
    expect(crawl.abandoned).toEqual([c3]);
    expect(crawl.retained.map((items) => items.channelId)).toEqual(["C4"]);
    expect(crawl.retained[0]!.messages.map((message) => message.ts)).toEqual(["1767225800.000100"]);
    expect(crawl.cursors).toEqual({});
    expect(
      commits.map(({ channel, maxTsIso, oldest, walkedMessages }) => ({
        id: channel.id,
        maxTsIso,
        oldest,
        walkedMessages,
      })),
    ).toEqual([
      { id: "C1", maxTsIso: "2026-01-01T00:01:40.000Z", oldest: "1767225600", walkedMessages: 1 },
      { id: "C4", maxTsIso: "2026-01-01T00:03:20.000Z", oldest: "1767225630", walkedMessages: 1 },
    ]);
    expect(released).toEqual([0, 1, 2, 3]);
  });

  it("samples nowIso once per conversation, so each conversation's future floor clamps to its own instant", async () => {
    const requests: HistoryRequest[] = [];
    const clock: string[] = [];
    const api = scriptedApi({
      pages: new Map<string, SlackMessagesPage | Error | "hang">([
        ["C1", { messages: [] }],
        ["C2", new Error("not_in_channel")],
        ["C3", { messages: [] }],
      ]),
      requests,
    });

    await crawlChannels({
      backfillNewChannels: false,
      channelCursors: new Map(),
      run: crawlRun({
        api,
        channelDeadline: scriptedDeadlines({ released: [] }),
        nowIso: steppedClock({ calls: clock }),
        total: 3,
      }),
      selected: [{ id: "C1" }, { id: "C2" }, { id: "C3" }],
    });

    expect(clock).toEqual(INSTANTS.slice(0, 3));
    expect(requests.map(({ channel, oldest }) => ({ channel, oldest }))).toEqual([
      { channel: "C1", oldest: "1767225600" },
      { channel: "C2", oldest: "1767225610" },
      { channel: "C3", oldest: "1767225620" },
    ]);
  });

  it("retains a channel's items with no commit seam, records an epoch read as full history, and merges thread cursors over the seed", async () => {
    const parent = { reply_count: 1, text: "parent", ts: "1700000000.000100", user: "U1" };
    const reply = { text: "reply", ts: "1700000100.000200", user: "U2" };
    const requests: HistoryRequest[] = [];
    const seed: ThreadCursors = { "C9:1600000000.000100": { replyCount: 2, ts: "1600000100.000100" } };
    const api = scriptedApi({
      pages: new Map<string, SlackMessagesPage | Error | "hang">([["C1", { messages: [parent] }]]),
      replies: { messages: [parent, reply] },
      requests,
    });

    const crawl = await crawlChannels({
      backfillNewChannels: true,
      channelCursors: new Map(),
      run: crawlRun({
        api,
        channelDeadline: scriptedDeadlines({ released: [] }),
        nowIso: steppedClock({ calls: [] }),
        threadCursors: seed,
        total: 1,
      }),
      selected: [{ id: "C1", name: "general" }],
    });

    expect(requests.map(({ oldest }) => oldest)).toEqual(["0"]);
    expect(crawl.retained.map((items) => items.channelId)).toEqual(["C1"]);
    expect(crawl.retained[0]!.messages.map((message) => message.ts)).toEqual(["1700000000.000100"]);
    expect(crawl.retained[0]!.replies.map((item) => item.ts)).toEqual(["1700000100.000200"]);
    expect(crawl.summaries).toEqual([
      { channelId: "C1", channelName: "general", itemCount: 2, maxTsIso: "2023-11-14T22:15:00.000Z" },
    ]);
    expect(crawl.visited).toEqual(["C1"]);
    expect(crawl.fullHistory).toEqual(["C1"]);
    expect(crawl.cursors).toEqual({
      "C1:1700000000.000100": { ts: "1700000100.000200" },
      "C9:1600000000.000100": { replyCount: 2, ts: "1600000100.000100" },
    });
  });
});
