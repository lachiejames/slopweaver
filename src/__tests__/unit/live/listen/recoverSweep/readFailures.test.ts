/**
 * How the workspace scan scores a failed read: a transient history or thread failure keeps the sweep partial,
 * while a gone or unjoined channel is an exclusion that still lets it complete.
 */
import { describe, expect, it } from "vitest";

import type { SlackApi } from "../../../../../corpus/slack/fetch.js";
import { recoverWorkspace } from "../../../../../live/listen/recoverSweep.js";
import { classificationFor, tagRow, WINDOW } from "./fixtures.js";

describe("recoverWorkspace", () => {
  it("reports a history failure and contributes NO candidates from that channel", async () => {
    const api: Pick<SlackApi, "history" | "replies"> = {
      history: async () => {
        throw new Error("rate limited");
      },
      replies: async () => ({ messages: [] }),
    };

    const result = await recoverWorkspace({
      api,
      threadCheckpoints: {},
      channels: [{ id: "C1" }],
      classification: classificationFor(),
      selfBotId: undefined,
      window: WINDOW,
    });

    expect(result.complete).toBe(false);
    expect(result.completedChannels).toBe(0);
    expect(result.candidates).toEqual([]);
    expect(result.failures).toEqual([
      { channel: "C1", reason: "reading history for C1 failed: rate limited", stage: "history" },
    ]);
  });

  it("treats a channel_not_found history failure as permanently out of scope, never a coverage failure", async () => {
    const api: Pick<SlackApi, "history" | "replies"> = {
      history: async () => {
        throw new Error("An API error occurred: channel_not_found");
      },
      replies: async () => ({ messages: [] }),
    };

    const result = await recoverWorkspace({
      api,
      threadCheckpoints: {},
      channels: [{ id: "C_GONE", isIm: true }],
      classification: classificationFor(),
      selfBotId: undefined,
      window: WINDOW,
    });

    expect(result.complete).toBe(true);
    expect(result.candidates).toEqual([]);
    expect(result.failures).toEqual([]);
  });

  it("REPORTS the gone channel as an exclusion rather than swallowing it, and does not count it completed", async () => {
    const api: Pick<SlackApi, "history" | "replies"> = {
      history: async () => {
        throw new Error("An API error occurred: channel_not_found");
      },
      replies: async () => ({ messages: [] }),
    };

    const result = await recoverWorkspace({
      api,
      threadCheckpoints: {},
      channels: [{ id: "C_GONE", isIm: true }],
      classification: classificationFor(),
      selfBotId: undefined,
      window: WINDOW,
    });

    // Before this list existed the channel returned silently, so a conversation vanishing from the sweep
    // looked exactly like one that had nothing in it. It is also no longer counted as a COMPLETED channel:
    // it contributed nothing and was never read, and calling it complete inflates the "N of M" line.
    expect(result.excludedChannels).toEqual([{ channel: "C_GONE", reason: "gone" }]);
    expect(result.completedChannels).toBe(0);
  });

  it("treats not_in_channel as an EXCLUSION, so one unjoined channel cannot pin the watermark", async () => {
    const api: Pick<SlackApi, "history" | "replies"> = {
      history: async ({ channel }) => {
        if (channel === "C_UNJOINED") {
          throw new Error("An API error occurred: not_in_channel");
        }
        return { messages: [tagRow({ ts: "1786400000.000100" })] };
      },
      replies: async ({ ts }) => ({ messages: [{ ts, user: "U_ASKER" }] }),
    };

    const result = await recoverWorkspace({
      api,
      threadCheckpoints: {},
      channels: [{ id: "C1" }, { id: "C_UNJOINED" }],
      classification: classificationFor(),
      selfBotId: undefined,
      window: WINDOW,
    });

    // The measured defect this fixes: one channel answering not_in_channel made every scheduled sweep
    // `partial` for six days, and a partial sweep advances no watermark, so an outage could never be proved
    // clean. A bot that is not a member cannot read one message and will be told so identically forever —
    // that is out of scope, not an incomplete read.
    expect(result.complete).toBe(true);
    expect(result.excludedChannels).toEqual([{ channel: "C_UNJOINED", reason: "not-a-member" }]);
    expect(result.failures).toEqual([]);
    expect(result.candidates.length).toBe(1);
    expect(result.candidates[0]?.channel).toBe("C1");
  });

  it("still refuses completeness for a TRANSIENT failure alongside an excluded channel", async () => {
    const api: Pick<SlackApi, "history" | "replies"> = {
      history: async ({ channel }) => {
        if (channel === "C_UNJOINED") {
          throw new Error("An API error occurred: not_in_channel");
        }
        throw new Error("ratelimited");
      },
      replies: async () => ({ messages: [] }),
    };

    const result = await recoverWorkspace({
      api,
      threadCheckpoints: {},
      channels: [{ id: "C1" }, { id: "C_UNJOINED" }],
      classification: classificationFor(),
      selfBotId: undefined,
      window: WINDOW,
    });

    expect(result.complete).toBe(false);
    expect(result.excludedChannels).toEqual([{ channel: "C_UNJOINED", reason: "not-a-member" }]);
    expect(result.failures.length).toBe(1);
  });

  it("treats a THREAD-stage not_in_channel as an exclusion of the whole channel, and still completes", async () => {
    // The regression: history read fine (or was cached), the thread read answered
    // not_in_channel, and the earlier fix only knew about the history stage — seven hours pinned.
    let leftChannelReplies = 0;
    const api: Pick<SlackApi, "history" | "replies"> = {
      history: async ({ channel }) => ({
        messages:
          channel === "C2"
            ? [tagRow({ ts: "1786400000.000100" }), tagRow({ ts: "1786400000.000200" })]
            : [tagRow({ ts: "1786400000.000300" })],
      }),
      replies: async ({ channel, ts }) => {
        if (channel === "C2") {
          leftChannelReplies += 1;
          throw new Error("An API error occurred: not_in_channel");
        }
        return { messages: [{ ts, user: "U_ASKER" }] };
      },
    };

    const result = await recoverWorkspace({
      api,
      threadCheckpoints: {},
      channels: [{ id: "C2" }, { id: "C1" }],
      classification: classificationFor(),
      selfBotId: undefined,
      window: WINDOW,
    });

    expect(result.complete).toBe(true);
    expect(result.failures).toEqual([]);
    expect(result.excludedChannels).toEqual([{ channel: "C2", reason: "not-a-member" }]);
    // One answer is enough: the second tagged root in the excluded channel is never read.
    expect(leftChannelReplies).toBe(1);
    expect(result.completedChannels).toBe(1);
    expect(result.candidates.map((c) => c.channel)).toEqual(["C1"]);
    expect(Object.keys(result.threadCheckpoints)).toEqual(["C1:1786400000.000300"]);
  });

  it("still refuses completeness for a TRANSIENT thread failure beside a thread-stage exclusion", async () => {
    const api: Pick<SlackApi, "history" | "replies"> = {
      history: async () => ({ messages: [tagRow({ ts: "1786400000.000100" })] }),
      replies: async ({ channel }) => {
        if (channel === "C2") {
          throw new Error("An API error occurred: not_in_channel");
        }
        throw new Error("ratelimited");
      },
    };

    const result = await recoverWorkspace({
      api,
      threadCheckpoints: {},
      channels: [{ id: "C2" }, { id: "C1" }],
      classification: classificationFor(),
      selfBotId: undefined,
      window: WINDOW,
    });

    expect(result.complete).toBe(false);
    expect(result.excludedChannels).toEqual([{ channel: "C2", reason: "not-a-member" }]);
    expect(result.failures).toEqual([
      {
        channel: "C1",
        messageTs: "1786400000.000100",
        reason: "reading thread 1786400000.000100 failed: ratelimited",
        stage: "thread",
      },
    ]);
  });

  it("discards a channel's candidates entirely when one thread read fails, but keeps scanning other channels", async () => {
    const api: Pick<SlackApi, "history" | "replies"> = {
      history: async ({ channel }) => ({
        messages: channel === "C1" ? [tagRow({ ts: "1786400000.000100" })] : [tagRow({ ts: "1786400000.000300" })],
      }),
      replies: async ({ channel }) => {
        if (channel === "C1") {
          throw new Error("thread gone");
        }
        return { messages: [{ ts: "1786400000.000300", user: "U_ASKER" }] };
      },
    };

    const result = await recoverWorkspace({
      api,
      threadCheckpoints: {},
      channels: [{ id: "C1" }, { id: "C2" }],
      classification: classificationFor(),
      selfBotId: undefined,
      window: WINDOW,
    });

    expect(result.complete).toBe(false);
    expect(result.discoveredChannels).toBe(2);
    expect(result.completedChannels).toBe(1);
    expect(result.candidates.length).toBe(1);
    expect(result.candidates[0]?.channel).toBe("C2");
    expect(result.failures).toEqual([
      {
        channel: "C1",
        messageTs: "1786400000.000100",
        reason: "reading thread 1786400000.000100 failed: thread gone",
        stage: "thread",
      },
    ]);
  });

  it("refuses a channel with contradictory surface metadata, without touching Slack", async () => {
    let historyCalled = false;
    const api: Pick<SlackApi, "history" | "replies"> = {
      history: async () => {
        historyCalled = true;
        return { messages: [] };
      },
      replies: async () => ({ messages: [] }),
    };

    const result = await recoverWorkspace({
      api,
      threadCheckpoints: {},
      channels: [{ id: "C1", isIm: true, isMpim: true }],
      classification: classificationFor(),
      selfBotId: undefined,
      window: WINDOW,
    });

    expect(historyCalled).toBe(false);
    expect(result.complete).toBe(false);
    expect(result.failures[0]?.reason).toContain("contradictory metadata");
  });
});
