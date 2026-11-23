/**
 * A deleted thread root in the workspace scan: thread_not_found retires a root, in the foreground or from a
 * remembered checkpoint, only when every read of its channel this sweep agrees it is gone.
 */
import { describe, expect, it } from "vitest";

import type { SlackApi } from "../../../../../corpus/slack/fetch.js";
import { recoverWorkspace } from "../../../../../live/listen/recoverSweep.js";
import { classificationFor, tagRow, WINDOW } from "./fixtures.js";

describe("recoverWorkspace", () => {
  it("drops a tag deleted between the history read and its thread read, and keeps the rest of the channel", async () => {
    const DELETED = "1786400000.000100";
    const KEPT = "1786400000.000200";
    const api: Pick<SlackApi, "history" | "replies"> = {
      // `reply_count` makes the deleted root a HINT as well, which is the second way the plan could reach it.
      history: async () => ({ messages: [{ ...tagRow({ ts: DELETED }), reply_count: 1 }, tagRow({ ts: KEPT })] }),
      replies: async ({ ts }) => {
        if (ts === DELETED) {
          throw new Error("An API error occurred: thread_not_found");
        }
        return { messages: [{ ts, user: "U_ASKER" }] };
      },
    };

    const result = await recoverWorkspace({
      api,
      threadCheckpoints: {},
      channels: [{ id: "C1" }],
      classification: classificationFor(),
      selfBotId: undefined,
      window: WINDOW,
    });

    expect(result.complete).toBe(true);
    expect(result.completedChannels).toBe(1);
    expect(result.failures).toEqual([]);
    expect(result.candidates.map((candidate) => candidate.messageTs)).toEqual([KEPT]);
    expect(result.goneThreads).toEqual([{ channel: "C1", threadTs: DELETED }]);
    expect(Object.keys(result.threadCheckpoints)).toEqual([`C1:${KEPT}`]);
    // Retired BEFORE planning, so the background phase never asks Slack about the deleted root a second time.
    expect(result.threadCoverage.backgroundReads).toBe(0);
  });

  it("retires nothing in a channel whose same root answered thread_not_found once and a rate limit once", async () => {
    // The counterexample: a channel with ANY thread failure contributes no inventory verdict at all.
    const ROOT = "1786400000.000100";
    let calls = 0;
    const api: Pick<SlackApi, "history" | "replies"> = {
      history: async () => ({ messages: [tagRow({ ts: ROOT }), tagRow({ ts: ROOT })] }),
      replies: async () => {
        calls += 1;
        throw new Error(calls === 1 ? "An API error occurred: thread_not_found" : "ratelimited");
      },
    };

    const result = await recoverWorkspace({
      api,
      threadCheckpoints: { [`C1:${ROOT}`]: { cursorTs: "1786400000.000105" } },
      channels: [{ id: "C1" }],
      classification: classificationFor(),
      selfBotId: undefined,
      window: WINDOW,
    });

    expect(result.complete).toBe(false);
    expect(result.goneThreads).toEqual([]);
    expect(Object.keys(result.threadCheckpoints)).toEqual([`C1:${ROOT}`]);
  });
});

describe("recoverWorkspace — background thread-checkpoint polling", () => {
  it("retires a remembered checkpoint whose root was deleted, reports it, and completes", async () => {
    // The live shape: two reply-less root registrations in one incident channel whose roots
    // were then deleted — every poll answered thread_not_found and made the sweep partial with nothing found.
    const GONE_A = "1790136092.273509";
    const GONE_B = "1790142543.981229";
    const LIVE = "1786400000.000100";
    const api: Pick<SlackApi, "history" | "replies"> = {
      history: async () => ({ messages: [] }),
      replies: async ({ ts }) => {
        if (ts !== LIVE) {
          throw new Error("An API error occurred: thread_not_found");
        }
        return { messages: [] };
      },
    };

    const result = await recoverWorkspace({
      api,
      channels: [{ id: "C1" }],
      classification: classificationFor(),
      selfBotId: undefined,
      threadCheckpoints: {
        [`C1:${GONE_A}`]: { cursorTs: GONE_A },
        [`C1:${GONE_B}`]: { cursorTs: GONE_B },
        [`C1:${LIVE}`]: { cursorTs: "1786400000.000105" },
      },
      window: WINDOW,
    });

    expect(result.threadCoverage.backgroundReads).toBe(3);
    expect(result.complete).toBe(true);
    expect(result.failures).toEqual([]);
    expect(result.excludedChannels).toEqual([]);
    expect(result.goneThreads).toEqual([
      { channel: "C1", threadTs: GONE_A },
      { channel: "C1", threadTs: GONE_B },
    ]);
    expect(result.threadCheckpoints).toEqual({
      [`C1:${LIVE}`]: { cursorTs: "1786400000.000105", lastCheckedAtIso: WINDOW.untilIso },
    });
    expect(result.threadCoverage.known).toBe(1);
  });

  it("still refuses completeness for a TRANSIENT background failure beside a gone thread", async () => {
    const GONE = "1790136092.273509";
    const FLAKY = "1786400000.000100";
    const api: Pick<SlackApi, "history" | "replies"> = {
      history: async () => ({ messages: [] }),
      replies: async ({ ts }) => {
        if (ts === GONE) {
          throw new Error("An API error occurred: thread_not_found");
        }
        throw new Error("ratelimited");
      },
    };

    const result = await recoverWorkspace({
      api,
      channels: [{ id: "C1" }],
      classification: classificationFor(),
      selfBotId: undefined,
      threadCheckpoints: {
        [`C1:${GONE}`]: { cursorTs: GONE },
        [`C1:${FLAKY}`]: { cursorTs: "1786400000.000105" },
      },
      window: WINDOW,
    });

    expect(result.complete).toBe(false);
    expect(result.goneThreads).toEqual([{ channel: "C1", threadTs: GONE }]);
    expect(result.failures).toEqual([
      { channel: "C1", messageTs: FLAKY, reason: `reading thread ${FLAKY} failed: ratelimited`, stage: "thread" },
    ]);
    // Reported, but a partial sweep retires nothing: the next complete one will.
    expect(Object.keys(result.threadCheckpoints).toSorted()).toEqual([`C1:${FLAKY}`, `C1:${GONE}`]);
  });

  it("retires nothing when one root rate-limits in the foreground and answers thread_not_found in the background", async () => {
    // The fourth counterexample: two reads of the SAME root, two different answers, one sweep.
    const ROOT = "1786400000.000100";
    let calls = 0;
    const api: Pick<SlackApi, "history" | "replies"> = {
      history: async () => ({ messages: [tagRow({ ts: ROOT })] }),
      replies: async () => {
        calls += 1;
        throw new Error(calls === 1 ? "ratelimited" : "An API error occurred: thread_not_found");
      },
    };

    const result = await recoverWorkspace({
      api,
      channels: [{ id: "C1" }],
      classification: classificationFor(),
      selfBotId: undefined,
      threadCheckpoints: { [`C1:${ROOT}`]: { cursorTs: "1786400000.000105" } },
      window: WINDOW,
    });

    expect(calls).toBe(2);
    expect(result.complete).toBe(false);
    expect(Object.keys(result.threadCheckpoints)).toEqual([`C1:${ROOT}`]);
  });

  it("retires nothing in a channel excluded this sweep, even when the sweep reads complete", async () => {
    // The fifth counterexample: a foreground rate limit, then not_in_channel on the duplicate row (which
    // drops the failure already scored), then thread_not_found when the kept checkpoint is polled.
    const ROOT = "1786400000.000100";
    const answers = ["ratelimited", "An API error occurred: not_in_channel", "An API error occurred: thread_not_found"];
    let calls = 0;
    const api: Pick<SlackApi, "history" | "replies"> = {
      history: async () => ({ messages: [tagRow({ ts: ROOT }), tagRow({ ts: ROOT })] }),
      replies: async () => {
        calls += 1;
        throw new Error(answers[calls - 1]);
      },
    };

    const result = await recoverWorkspace({
      api,
      channels: [{ id: "C1" }],
      classification: classificationFor(),
      selfBotId: undefined,
      threadCheckpoints: { [`C1:${ROOT}`]: { cursorTs: "1786400000.000105" } },
      window: WINDOW,
    });

    expect(calls).toBe(3);
    expect(result.complete).toBe(true);
    expect(result.excludedChannels).toEqual([{ channel: "C1", reason: "not-a-member" }]);
    expect(result.goneThreads).toEqual([{ channel: "C1", threadTs: ROOT }]);
    expect(Object.keys(result.threadCheckpoints)).toEqual([`C1:${ROOT}`]);
  });
});
