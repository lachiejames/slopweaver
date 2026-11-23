/**
 * The background poll of remembered threads — a plain fake for the Slack reply seam, no real network.
 * What it has to prove is the reason the phase exists: a reply arriving after its root left the history
 * window is still reachable, and a channel the bot was removed from never pins the watermark.
 */
import { describe, expect, it } from "vitest";

import type { SlackApi } from "../../../../corpus/slack/fetch.js";
import { runBackgroundChecks } from "../../../../live/listen/recoverBackground.js";
import type { RecoveryWindow } from "../../../../live/listen/recoverSchedule.js";

const WINDOW: RecoveryWindow = {
  latestExclusiveTs: "1789960000.000000",
  oldestExclusiveTs: "1789950000.000000",
  sinceIso: "2026-09-21T00:00:00.000Z",
  untilIso: "2026-09-21T02:30:00.000Z",
};

const ROOT_TS = "1789775392.910229";
const NO_CHANNELS = new Map();

/** A reply seam that serves one thread's rows and refuses everything else the way Slack's client does. */
function repliesServing({ messages }: { messages: readonly unknown[] }): Pick<SlackApi, "replies"> {
  return { replies: async () => ({ messages }) };
}

describe("runBackgroundChecks", () => {
  it("recovers a tag that arrived as a reply long after its root left the history window", async () => {
    const api = repliesServing({
      messages: [
        { text: "the root", thread_ts: ROOT_TS, ts: ROOT_TS, user: "U_ASKER" },
        { text: "<@U_BOT> three things", thread_ts: ROOT_TS, ts: "1789955000.000200", user: "U_ASKER" },
      ],
    });

    const result = await runBackgroundChecks({
      api,
      channelsById: NO_CHANNELS,
      checks: [{ channel: "C1", oldest: ROOT_TS, threadTs: ROOT_TS }],
      selfBotId: undefined,
      window: WINDOW,
    });

    expect(result.candidates.length).toBe(1);
    expect(result.candidates[0]!.messageTs).toBe("1789955000.000200");
    expect(result.failures).toEqual([]);
    expect(result.checkpointUpdates[`C1:${ROOT_TS}`]).toEqual({
      cursorTs: "1789955000.000200",
      lastCheckedAtIso: "2026-09-21T02:30:00.000Z",
    });
  });

  it("still advances the checkpoint's own checked-at when a poll finds no new reply", async () => {
    const api = repliesServing({ messages: [{ text: "the root", thread_ts: ROOT_TS, ts: ROOT_TS, user: "U_ASKER" }] });

    const result = await runBackgroundChecks({
      api,
      channelsById: NO_CHANNELS,
      checks: [{ channel: "C1", oldest: ROOT_TS, threadTs: ROOT_TS }],
      selfBotId: undefined,
      window: WINDOW,
    });

    expect(result.candidates).toEqual([]);
    expect(result.checkpointUpdates[`C1:${ROOT_TS}`]).toEqual({
      cursorTs: ROOT_TS,
      lastCheckedAtIso: "2026-09-21T02:30:00.000Z",
    });
  });

  it("excludes a channel the bot was removed from, rather than failing the sweep over its checkpoint", async () => {
    const api: Pick<SlackApi, "replies"> = {
      replies: async () => {
        throw new Error("not_in_channel");
      },
    };

    const result = await runBackgroundChecks({
      api,
      channelsById: NO_CHANNELS,
      checks: [{ channel: "C1", oldest: ROOT_TS, threadTs: ROOT_TS }],
      selfBotId: undefined,
      window: WINDOW,
    });

    expect(result.exclusions).toEqual([{ channel: "C1", reason: "not-a-member" }]);
    expect(result.failures).toEqual([]);
    expect(result.checkpointUpdates).toEqual({});
  });

  it("reports a deleted root as a gone thread, never a failure, and earns it no checkpoint", async () => {
    const api: Pick<SlackApi, "replies"> = {
      replies: async () => {
        throw new Error("An API error occurred: thread_not_found");
      },
    };

    const result = await runBackgroundChecks({
      api,
      channelsById: NO_CHANNELS,
      checks: [{ channel: "C1", oldest: ROOT_TS, threadTs: ROOT_TS }],
      selfBotId: undefined,
      window: WINDOW,
    });

    expect(result.goneThreads).toEqual([{ channel: "C1", threadTs: ROOT_TS }]);
    expect(result.failures).toEqual([]);
    expect(result.exclusions).toEqual([]);
    expect(result.checkpointUpdates).toEqual({});
  });

  it("records a retryable read as a thread-stage coverage failure", async () => {
    const api: Pick<SlackApi, "replies"> = {
      replies: async () => {
        throw new Error("ratelimited");
      },
    };

    const result = await runBackgroundChecks({
      api,
      channelsById: NO_CHANNELS,
      checks: [{ channel: "C1", oldest: ROOT_TS, threadTs: ROOT_TS }],
      selfBotId: undefined,
      window: WINDOW,
    });

    expect(result.exclusions).toEqual([]);
    expect(result.failures.length).toBe(1);
    expect(result.failures[0]!.stage).toBe("thread");
    expect(result.checkpointUpdates).toEqual({});
  });

  it("returns empty everything for an empty plan, making zero reply calls", async () => {
    let calls = 0;
    const api: Pick<SlackApi, "replies"> = {
      replies: async () => {
        calls += 1;
        return { messages: [] };
      },
    };

    const result = await runBackgroundChecks({
      api,
      channelsById: NO_CHANNELS,
      checks: [],
      selfBotId: undefined,
      window: WINDOW,
    });

    expect(calls).toBe(0);
    expect(result.candidates).toEqual([]);
    expect(result.checkpointUpdates).toEqual({});
  });
});
