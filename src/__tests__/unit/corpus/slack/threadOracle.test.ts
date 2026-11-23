import { describe, expect, it } from "vitest";
import {
  chooseThreadDetectionLane,
  countThreadsPerChannel,
  HISTORY_PAGE_LIMIT,
  storedThreadsOf,
  threadRootsInPage,
  threadsNeedingPoll,
} from "../../../../corpus/slack/threadOracle.js";

/** A thread root as `conversations.history` returns one. */
const root = ({
  ts,
  latestReply,
  replyCount,
}: {
  ts: string;
  latestReply: string;
  replyCount: number;
}): Record<string, unknown> => ({
  latest_reply: latestReply,
  reply_count: replyCount,
  reply_users_count: 1,
  text: "parent",
  thread_ts: ts,
  ts,
});

describe("threadRootsInPage", () => {
  it("reads the root's ts, latest_reply and reply_count", () => {
    const roots = threadRootsInPage({
      messages: [root({ latestReply: "1700000100.000200", replyCount: 4, ts: "1700000000.000100" })],
    });
    expect(roots).toEqual([{ latestReply: "1700000100.000200", replyCount: 4, threadTs: "1700000000.000100" }]);
  });

  it("keys on latest_reply, so a thread_broadcast row is NOT a root", () => {
    // The measured trap: a broadcast reply surfaces top-level carrying its PARENT's `thread_ts` and no
    // `latest_reply` of its own. Keying on `thread_ts` invented 7 phantom threads on one real 999-row page.
    const page = [
      root({ latestReply: "1700000100.000200", replyCount: 4, ts: "1700000000.000100" }),
      {
        subtype: "thread_broadcast",
        text: "also sending to channel",
        thread_ts: "1700000000.000100",
        ts: "1700000100.000200",
      },
    ];
    expect(threadRootsInPage({ messages: page }).map((r) => r.threadTs)).toEqual(["1700000000.000100"]);
  });

  it("drops a plain top-level message, a non-object row and a malformed latest_reply", () => {
    const page = [
      { text: "no replies here", ts: "1700000000.000300" },
      "not an object",
      { latest_reply: "not-a-ts", reply_count: 2, ts: "1700000000.000400" },
      { latest_reply: "1700000100.000200", reply_count: 1 },
    ];
    expect(threadRootsInPage({ messages: page })).toEqual([]);
  });

  it("reads a missing reply_count as zero rather than dropping the root", () => {
    const roots = threadRootsInPage({
      messages: [{ latest_reply: "1700000100.000200", ts: "1700000000.000100" }],
    });
    expect(roots).toEqual([{ latestReply: "1700000100.000200", replyCount: 0, threadTs: "1700000000.000100" }]);
  });

  it("finds nothing in an empty page", () => {
    expect(threadRootsInPage({ messages: [] })).toEqual([]);
  });
});

describe("threadsNeedingPoll", () => {
  const roots = [root({ latestReply: "1700000100.000200", replyCount: 4, ts: "1700000000.000100" })];
  const page = threadRootsInPage({ messages: roots });

  it("polls a thread with no stored cursor", () => {
    const plan = threadsNeedingPoll({ channel: "C_A", cursors: {}, roots: page });
    expect(plan.poll.map((r) => r.threadTs)).toEqual(["1700000000.000100"]);
    expect(plan.confirmed).toEqual([]);
  });

  it("polls a thread whose latest_reply is newer than the stored cursor", () => {
    const cursors = { "C_A:1700000000.000100": { replyCount: 3, ts: "1700000050.000000" } };
    expect(threadsNeedingPoll({ channel: "C_A", cursors, roots: page }).poll).toHaveLength(1);
  });

  it("polls a thread whose reply_count fell while latest_reply stood still — a DELETED reply", () => {
    const cursors = { "C_A:1700000000.000100": { replyCount: 5, ts: "1700000100.000200" } };
    const plan = threadsNeedingPoll({ channel: "C_A", cursors, roots: page });
    expect(plan.poll.map((r) => r.replyCount)).toEqual([4]);
    expect(plan.confirmed).toEqual([]);
  });

  it("confirms an unchanged thread and records the count it just observed", () => {
    const cursors = { "C_A:1700000000.000100": { replyCount: 4, ts: "1700000100.000200" } };
    const plan = threadsNeedingPoll({ channel: "C_A", cursors, roots: page });
    expect(plan.poll).toEqual([]);
    expect(plan.confirmed).toEqual([
      { cursor: { replyCount: 4, ts: "1700000100.000200" }, key: "C_A:1700000000.000100" },
    ]);
  });

  it("treats an ABSENT stored count as unknown, not as a mismatch — a migrated legacy entry is not re-polled", () => {
    const cursors = { "C_A:1700000000.000100": { ts: "1700000100.000200" } };
    const plan = threadsNeedingPoll({ channel: "C_A", cursors, roots: page });
    expect(plan.poll).toEqual([]);
    expect(plan.confirmed[0]!.cursor.replyCount).toBe(4); // and it arms the detector for next time
  });

  it("compares timestamps NUMERICALLY, so a seconds-digit roll does not read as unchanged", () => {
    // "999999999.000000" sorts ABOVE "1700000100.000200" as a string and below it as a number.
    const rolled = threadRootsInPage({
      messages: [root({ latestReply: "1700000100.000200", replyCount: 1, ts: "1700000000.000100" })],
    });
    const cursors = { "C_A:1700000000.000100": { replyCount: 1, ts: "999999999.000000" } };
    expect(threadsNeedingPoll({ channel: "C_A", cursors, roots: rolled }).poll).toHaveLength(1);
  });

  it("keys the store lookup by CHANNEL, so another channel's cursor cannot confirm this one", () => {
    const cursors = { "C_OTHER:1700000000.000100": { replyCount: 4, ts: "1700000100.000200" } };
    expect(threadsNeedingPoll({ channel: "C_A", cursors, roots: page }).poll).toHaveLength(1);
  });
});

describe("chooseThreadDetectionLane", () => {
  it("walks the history when a channel has more threads than pages", () => {
    // The thread-densest measured channel: 5,973 messages (6 pages) against 4,438 threads.
    expect(
      chooseThreadDetectionLane({ knownMessages: 5_973, knownThreads: 4_438, pageLimit: HISTORY_PAGE_LIMIT }),
    ).toBe("history-oracle");
  });

  it("keeps per-thread polling on a firehose with few threads", () => {
    // The measured outlier: ≥1,000,000 top-level messages (1,002 pages) and 42 threads.
    expect(
      chooseThreadDetectionLane({ knownMessages: 1_000_000, knownThreads: 42, pageLimit: HISTORY_PAGE_LIMIT }),
    ).toBe("poll-known-threads");
  });

  it("keeps per-thread polling when the channel has no known threads at all", () => {
    expect(chooseThreadDetectionLane({ knownMessages: 10, knownThreads: 0, pageLimit: 999 })).toBe(
      "poll-known-threads",
    );
  });

  it("walks the history when the channel's size has never been recorded", () => {
    expect(chooseThreadDetectionLane({ knownMessages: undefined, knownThreads: 3, pageLimit: 999 })).toBe(
      "history-oracle",
    );
  });

  it("takes the poll lane at the exact tie, where the walk saves nothing", () => {
    // 1,998 messages is exactly 2 pages, against 2 threads.
    expect(chooseThreadDetectionLane({ knownMessages: 1_998, knownThreads: 2, pageLimit: 999 })).toBe(
      "poll-known-threads",
    );
    expect(chooseThreadDetectionLane({ knownMessages: 1_998, knownThreads: 3, pageLimit: 999 })).toBe("history-oracle");
  });

  it("counts an empty channel as zero pages", () => {
    expect(chooseThreadDetectionLane({ knownMessages: 0, knownThreads: 1, pageLimit: 999 })).toBe("history-oracle");
  });
});

describe("countThreadsPerChannel", () => {
  it("tallies stored keys by their channel prefix", () => {
    const counts = countThreadsPerChannel({
      cursors: {
        "C_A:1700000000.000100": { ts: "1.0" },
        "C_A:1700000000.000300": { ts: "2.0" },
        "C_B:1700000000.000500": { ts: "3.0" },
      },
    });
    expect(counts.get("C_A")).toBe(2);
    expect(counts.get("C_B")).toBe(1);
    expect(counts.size).toBe(2);
  });

  it("ignores a key with no channel prefix", () => {
    const counts = countThreadsPerChannel({
      cursors: { ":1700000000.000100": { ts: "1.0" }, malformed: { ts: "2.0" } },
    });
    expect(counts.size).toBe(0);
  });

  it("is empty for an empty store", () => {
    expect(countThreadsPerChannel({ cursors: {} }).size).toBe(0);
  });
});

describe("storedThreadsOf", () => {
  const counts = countThreadsPerChannel({
    cursors: {
      "C_A:1700000000.000100": { ts: "1.0" },
      "C_A:1700000000.000300": { ts: "2.0" },
    },
  });

  it("reads a channel's stored-thread count", () => {
    expect(storedThreadsOf({ channel: "C_A", counts })).toBe(2);
  });

  it("reads a channel no stored thread names as holding none", () => {
    expect(counts.has("C_B")).toBe(false);
    expect(storedThreadsOf({ channel: "C_B", counts })).toBe(0);
  });
});
