/**
 * The oracle END TO END through `fetchSlackActivity` — the claim is about how much traffic the crawl makes,
 * and that is a property of the whole paging loop rather than of any pure function in it. Every test here
 * counts real calls against an injected seam (a plain fake, not a mock) and asserts the exact number.
 */
import { describe, expect, it } from "vitest";
import type { ChannelWatermarkEntry } from "../../../../corpus/slack/channelWatermark.js";
import { fetchSlackActivity, type SlackApi } from "../../../../corpus/slack/fetch.js";
import type { ThreadCursors } from "../../../../corpus/slack/threadCursors.js";
import { unwrap } from "../../../../lib/result.js";

const WINDOW = { since: "2023-11-01", until: "2023-12-01" };
/** Slack epoch seconds for the window's `since` day, its own floor. */
const WINDOW_OLDEST = "1698796800";

/** One `conversations.history` row for a thread ROOT, as Slack returns it. */
function rootRow({
  ts,
  latestReply,
  replyCount,
}: {
  ts: string;
  latestReply: string;
  replyCount: number;
}): Record<string, unknown> {
  return { latest_reply: latestReply, reply_count: replyCount, text: "parent", thread_ts: ts, ts, user: "U1" };
}

/** What each fake call recorded, so a test can assert the traffic rather than the outcome alone. */
interface Traffic {
  readonly history: { channel: string; oldest: string }[];
  readonly replies: { ts: string; oldest: string }[];
}

/**
 * A one-channel Slack seam whose history returns `rows` in a single page, honouring `oldest` the way the live
 * endpoint does. A thread the store knows but `rows` omits is the deleted-parent case: history cannot reach
 * it, and only the stored cursor can.
 */
function oneChannelApi({ rows, traffic }: { rows: readonly Record<string, unknown>[]; traffic: Traffic }): SlackApi {
  return {
    filesInfo: async () => {
      throw new Error("the crawl must not call files.info");
    },
    grantedScopes: async () => [],
    history: async ({ channel, oldest }) => {
      traffic.history.push({ channel, oldest });
      // The oracle lane asks from the epoch and gets the whole channel; the poll lane asks from the window
      // floor and Slack answers with only the rows at or after it, exactly as the live endpoint does.
      const floor = Number(oldest);
      return { messages: rows.filter((row) => Number(row["ts"]) >= floor) };
    },
    listChannels: async () => ({ channels: [{ id: "C_A", is_member: true, name: "alpha" }] }),
    listUsers: async () => ({ members: [] }),
    replies: async ({ ts, oldest }) => {
      traffic.replies.push({ oldest, ts });
      return {
        messages: [
          { text: "parent", ts, user: "U1" },
          { text: "a reply", ts: `${String(Number(ts.split(".")[0]) + 100)}.000200`, user: "U2" },
        ],
      };
    },
    workspaceUrl: async () => "https://acme.slack.com",
  };
}

const emptyTraffic = (): Traffic => ({ history: [], replies: [] });

/** A channel already crawled to the epoch, whose size is known — the state the oracle lane needs. */
const backfilled = ({ messages }: { messages: number }): ReadonlyMap<string, ChannelWatermarkEntry> =>
  new Map([["C_A", { cursor: "2023-11-15T00:00:00.000Z", fullHistory: true, messages }]]);

describe("the oracle lane, end to end", () => {
  // Three threads: one gained a reply, one lost one, one is untouched. All three parents are OLD — outside
  // the window entirely — which is exactly the case the pre-oracle bounded walk could never see.
  const rows = [
    rootRow({ latestReply: "1600000200.000000", replyCount: 5, ts: "1600000000.000100" }), // gained a reply
    rootRow({ latestReply: "1600001100.000000", replyCount: 2, ts: "1600001000.000100" }), // lost a reply
    rootRow({ latestReply: "1600002100.000000", replyCount: 4, ts: "1600002000.000100" }), // unchanged
  ];
  const cursors: ThreadCursors = {
    "C_A:1600000000.000100": { replyCount: 5, ts: "1600000100.000000" }, // behind latest_reply
    "C_A:1600001000.000100": { replyCount: 3, ts: "1600001100.000000" }, // count fell: a deletion
    "C_A:1600002000.000100": { replyCount: 4, ts: "1600002100.000000" }, // agrees on both
  };

  it("polls only the two threads that moved, out of three known", async () => {
    const traffic = emptyTraffic();
    unwrap(
      await fetchSlackActivity({
        api: oneChannelApi({ rows, traffic }),
        channelCursors: backfilled({ messages: 3 }),
        threadCursors: cursors,
        window: WINDOW,
      }),
    );
    expect(traffic.replies.map((call) => call.ts).toSorted()).toEqual(["1600000000.000100", "1600001000.000100"]);
  });

  it("walks history from the EPOCH so a parent outside the window still reports its own state", async () => {
    const traffic = emptyTraffic();
    unwrap(
      await fetchSlackActivity({
        api: oneChannelApi({ rows, traffic }),
        channelCursors: backfilled({ messages: 3 }),
        threadCursors: cursors,
        window: WINDOW,
      }),
    );
    expect(traffic.history).toEqual([{ channel: "C_A", oldest: "0" }]);
  });

  it("records the count it observed for the thread it did NOT poll", async () => {
    const result = unwrap(
      await fetchSlackActivity({
        api: oneChannelApi({ rows, traffic: emptyTraffic() }),
        channelCursors: backfilled({ messages: 3 }),
        threadCursors: cursors,
        window: WINDOW,
      }),
    );
    expect(result.threadCursors["C_A:1600002000.000100"]).toEqual({ replyCount: 4, ts: "1600002100.000000" });
  });

  it("ingests only rows at or after the channel's own floor, though the walk read the whole channel", async () => {
    // The parents are all from 2020; the ingest floor is the channel's stored cursor, mid-November. The walk
    // must see all three (it polls two of them) while bronze receives none of the three top-level rows.
    const result = unwrap(
      await fetchSlackActivity({
        api: oneChannelApi({ rows, traffic: emptyTraffic() }),
        channelCursors: backfilled({ messages: 3 }),
        threadCursors: cursors,
        window: WINDOW,
      }),
    );
    expect(result.retainedChannels[0]!.messages).toEqual([]);
    expect(result.retainedChannels[0]!.replies).toHaveLength(2); // both moved threads' replies DID land
  });

  it("records the channel's size only when the walk actually exhausted", async () => {
    const result = unwrap(
      await fetchSlackActivity({
        api: oneChannelApi({ rows, traffic: emptyTraffic() }),
        channelCursors: backfilled({ messages: 3 }),
        threadCursors: cursors,
        window: WINDOW,
      }),
    );
    expect(result.channelMessageCounts.get("C_A")).toBe(3);
  });

  it("does NOT claim a full backfill just because the walk started at the epoch", async () => {
    const result = unwrap(
      await fetchSlackActivity({
        api: oneChannelApi({ rows, traffic: emptyTraffic() }),
        channelCursors: backfilled({ messages: 3 }),
        threadCursors: cursors,
        window: WINDOW,
      }),
    );
    // The INGEST floor decides the completion marker, and it sat at the channel's stored cursor.
    expect(result.fullHistoryChannels).toEqual([]);
  });
});

describe("the fallback sweep", () => {
  it("still reaches a thread whose PARENT was deleted — the oracle's one blind spot", async () => {
    const traffic = emptyTraffic();
    // History holds ONE root. The store knows a second thread whose parent has left history entirely.
    const rows = [rootRow({ latestReply: "1600000100.000000", replyCount: 4, ts: "1600000000.000100" })];
    const cursors: ThreadCursors = {
      "C_A:1600000000.000100": { replyCount: 4, ts: "1600000100.000000" }, // unchanged, and visible
      "C_A:1500000000.000100": { replyCount: 2, ts: "1500000050.000000" }, // parent gone from history
    };
    unwrap(
      await fetchSlackActivity({
        api: oneChannelApi({ rows, traffic }),
        channelCursors: backfilled({ messages: 1 }),
        threadCursors: cursors,
        window: WINDOW,
      }),
    );
    expect(traffic.replies).toEqual([{ oldest: "1500000050.000000", ts: "1500000000.000100" }]);
  });

  it("sweeps a thread the oracle already confirmed exactly zero times", async () => {
    const traffic = emptyTraffic();
    const rows = [
      rootRow({ latestReply: "1600000100.000000", replyCount: 4, ts: "1600000000.000100" }),
      rootRow({ latestReply: "1600001100.000000", replyCount: 2, ts: "1600001000.000100" }),
    ];
    unwrap(
      await fetchSlackActivity({
        api: oneChannelApi({ rows, traffic }),
        channelCursors: backfilled({ messages: 2 }),
        threadCursors: {
          "C_A:1600000000.000100": { replyCount: 4, ts: "1600000100.000000" },
          "C_A:1600001000.000100": { replyCount: 2, ts: "1600001100.000000" },
        },
        window: WINDOW,
      }),
    );
    // Two known threads, one history page, ZERO thread calls — the whole point of the oracle, and proof the
    // sweep afterwards does not re-poll what the walk already accounted for.
    expect(traffic.history).toHaveLength(1);
    expect(traffic.replies).toEqual([]);
  });
});

describe("the poll lane", () => {
  const rows = [rootRow({ latestReply: "1700000100.000200", replyCount: 1, ts: "1700000000.000100" })];

  it("keeps the bounded walk and polls every parent, on a channel with more pages than threads", async () => {
    const traffic = emptyTraffic();
    unwrap(
      await fetchSlackActivity({
        api: oneChannelApi({ rows, traffic }),
        // 1,000,000 messages is 1,002 pages against one known thread: walking it would be absurd.
        channelCursors: backfilled({ messages: 1_000_000 }),
        threadCursors: { "C_A:1700000000.000100": { replyCount: 1, ts: "1700000100.000200" } },
        window: WINDOW,
      }),
    );
    expect(traffic.history[0]!.oldest).not.toBe("0");
    // The parent IS polled despite the oracle proving it unchanged — that is the pre-oracle behaviour, kept.
    expect(traffic.replies.map((call) => call.ts)).toEqual(["1700000000.000100"]);
  });

  it("takes the poll lane when the channel has no known threads at all", async () => {
    const traffic = emptyTraffic();
    unwrap(
      await fetchSlackActivity({
        api: oneChannelApi({ rows, traffic }),
        channelCursors: backfilled({ messages: 1 }),
        threadCursors: {},
        window: WINDOW,
      }),
    );
    expect(traffic.history[0]!.oldest).not.toBe("0");
  });
});

describe("an explicit window", () => {
  // `--since` pins the window; `backfillNewChannels: false` is how the CLI says so. The lane decision runs
  // here exactly as it does unpinned, because a WALK writes nothing — the ingest floor is what the request
  // governs, and it is asserted unchanged below.
  const pinned = { backfillNewChannels: false } as const;
  // Three old parents, one of which gained a reply. The other two agree with the store on both fields.
  const rows = [
    rootRow({ latestReply: "1600000200.000000", replyCount: 5, ts: "1600000000.000100" }), // gained a reply
    rootRow({ latestReply: "1600001100.000000", replyCount: 2, ts: "1600001000.000100" }),
    rootRow({ latestReply: "1600002100.000000", replyCount: 4, ts: "1600002000.000100" }),
  ];
  const cursors: ThreadCursors = {
    "C_A:1600000000.000100": { replyCount: 5, ts: "1600000100.000000" },
    "C_A:1600001000.000100": { replyCount: 2, ts: "1600001100.000000" },
    "C_A:1600002000.000100": { replyCount: 4, ts: "1600002100.000000" },
  };

  it("takes the oracle lane and walks from the epoch, so three known threads cost ONE replies call", async () => {
    const traffic = emptyTraffic();
    unwrap(
      await fetchSlackActivity({
        ...pinned,
        api: oneChannelApi({ rows, traffic }),
        channelCursors: backfilled({ messages: 3 }),
        threadCursors: cursors,
        window: WINDOW,
      }),
    );
    expect(traffic.history).toEqual([{ channel: "C_A", oldest: "0" }]);
    // The whole defect, inverted: pinned to the poll lane this was three calls, one per stored cursor.
    expect(traffic.replies.map((call) => call.ts)).toEqual(["1600000000.000100"]);
  });

  it("leaves the INGEST floor on the window, so the widened walk changes no bronze row", async () => {
    const result = unwrap(
      await fetchSlackActivity({
        ...pinned,
        api: oneChannelApi({ rows, traffic: emptyTraffic() }),
        channelCursors: backfilled({ messages: 3 }),
        threadCursors: cursors,
        window: WINDOW,
      }),
    );
    // All three parents are from 2020, far below the 2023 floor the request pinned.
    expect(result.retainedChannels[0]!.messages).toEqual([]);
  });

  it("does not claim a full backfill from a walk the request never asked for", async () => {
    const result = unwrap(
      await fetchSlackActivity({
        ...pinned,
        api: oneChannelApi({ rows, traffic: emptyTraffic() }),
        channelCursors: backfilled({ messages: 3 }),
        threadCursors: cursors,
        window: WINDOW,
      }),
    );
    expect(result.fullHistoryChannels).toEqual([]);
  });

  it("records the channel's true size, which only a walk that exhausted can know", async () => {
    const result = unwrap(
      await fetchSlackActivity({
        ...pinned,
        api: oneChannelApi({ rows, traffic: emptyTraffic() }),
        channelCursors: backfilled({ messages: 3 }),
        threadCursors: cursors,
        window: WINDOW,
      }),
    );
    expect(result.channelMessageCounts.get("C_A")).toBe(3);
  });

  it("keeps the poll lane on a firehose, where pages outnumber threads", async () => {
    const traffic = emptyTraffic();
    unwrap(
      await fetchSlackActivity({
        ...pinned,
        api: oneChannelApi({ rows, traffic }),
        channelCursors: backfilled({ messages: 1_000_000 }),
        threadCursors: cursors,
        window: WINDOW,
      }),
    );
    // The poll lane's walk floor IS the ingest floor, which under an explicit window is the floor the
    // REQUEST named — a stored cursor may not silently narrow one (`../reach.ts#resumeExplicitWindow`).
    expect(traffic.history[0]!.oldest).toBe(WINDOW_OLDEST);
  });

  it("keeps the poll lane for a cursor-isolated run, whose thread store is empty", async () => {
    const traffic = emptyTraffic();
    unwrap(
      await fetchSlackActivity({
        ...pinned,
        api: oneChannelApi({ rows, traffic }),
        channelCursors: new Map(),
        threadCursors: {},
        window: WINDOW,
      }),
    );
    expect(traffic.history).toEqual([{ channel: "C_A", oldest: WINDOW_OLDEST }]);
    expect(traffic.replies).toEqual([]);
  });
});

describe("a thread root the walk surfaced but the store has never seen", () => {
  // Two known threads that have not moved — enough for the oracle lane, which needs more threads than
  // history pages — plus a 2020 parent with no stored cursor at all. Reading that third one WHOLE is right
  // when nobody pinned a window and wrong when somebody did.
  const rows = [
    rootRow({ latestReply: "1600000100.000000", replyCount: 4, ts: "1600000000.000100" }),
    rootRow({ latestReply: "1600001100.000000", replyCount: 2, ts: "1600001000.000100" }),
    rootRow({ latestReply: "1600003100.000000", replyCount: 7, ts: "1600003000.000100" }), // never seen
  ];
  const cursors: ThreadCursors = {
    "C_A:1600000000.000100": { replyCount: 4, ts: "1600000100.000000" },
    "C_A:1600001000.000100": { replyCount: 2, ts: "1600001100.000000" },
  };
  const unseen = "C_A:1600003000.000100";

  it("is read from the FLOOR when its parent is inside the window, pinned or not", async () => {
    // A thread CREATED during the requested window — what a catch-up run is chiefly for. A reply is always
    // newer than its parent, so reading from the floor fetches the whole thread and the cursor is honest.
    // Deferring this one on cursor-absence alone would land the parent in bronze and drop every reply.
    const traffic = emptyTraffic();
    const inWindow = "1700100000.000100";
    const result = unwrap(
      await fetchSlackActivity({
        api: oneChannelApi({
          rows: [...rows, rootRow({ latestReply: "1700100200.000000", replyCount: 3, ts: inWindow })],
          traffic,
        }),
        backfillNewChannels: false,
        channelCursors: backfilled({ messages: 3 }),
        threadCursors: cursors,
        window: WINDOW,
      }),
    );
    expect(traffic.replies).toEqual([{ oldest: WINDOW_OLDEST, ts: inWindow }]);
    expect(result.threadCursors[`C_A:${inWindow}`]).toEqual({ replyCount: 3, ts: "1700100100.000200" });
  });

  it("is DEFERRED under a pinned window — no call, and no cursor claiming coverage", async () => {
    const traffic = emptyTraffic();
    const result = unwrap(
      await fetchSlackActivity({
        api: oneChannelApi({ rows, traffic }),
        backfillNewChannels: false,
        channelCursors: backfilled({ messages: 3 }),
        threadCursors: cursors,
        window: WINDOW,
      }),
    );
    expect(traffic.replies).toEqual([]);
    expect(Object.keys(result.threadCursors)).not.toContain(unseen);
  });

  it("is read WHOLE under `--all`, whose pinned window has the epoch as its own floor", async () => {
    const traffic = emptyTraffic();
    const result = unwrap(
      await fetchSlackActivity({
        api: oneChannelApi({ rows, traffic }),
        // `--all` withholds the epoch backfill yet asks for everything: nothing sits below its floor, so
        // deferring here would make an explicit whole-history request return no replies for an unseen thread.
        backfillNewChannels: false,
        channelCursors: new Map(),
        threadCursors: cursors,
        window: { since: "1970-01-01", until: "2023-12-01" },
      }),
    );
    expect(traffic.replies).toEqual([{ oldest: "0", ts: "1600003000.000100" }]);
    expect(result.threadCursors[unseen]).toEqual({ replyCount: 7, ts: "1600003100.000200" });
  });

  it("is read WHOLE when no window is pinned, which is what makes the deferral a deferral", async () => {
    const traffic = emptyTraffic();
    const result = unwrap(
      await fetchSlackActivity({
        api: oneChannelApi({ rows, traffic }),
        channelCursors: backfilled({ messages: 3 }),
        threadCursors: cursors,
        window: WINDOW,
      }),
    );
    expect(traffic.replies).toEqual([{ oldest: "0", ts: "1600003000.000100" }]);
    expect(result.threadCursors[unseen]).toEqual({ replyCount: 7, ts: "1600003100.000200" });
  });
});
