/**
 * A failed background poll of a remembered thread checkpoint: not_in_channel excludes the channel once and keeps
 * its checkpoints, while any other failure stays a failure and preserves the previous cursor.
 */
import { describe, expect, it } from "vitest";

import type { SlackApi } from "../../../../../corpus/slack/fetch.js";
import { recoverWorkspace } from "../../../../../live/listen/recoverSweep.js";
import { classificationFor, WINDOW } from "./fixtures.js";

describe("recoverWorkspace — background thread-checkpoint polling", () => {
  it("excludes a channel ONCE when its remembered checkpoints answer not_in_channel, keeps them, and completes", async () => {
    // The exact live shape measured: the checkpoint inventory still held threads in a channel the
    // bot had been removed from, every background poll of them answered not_in_channel, and seven
    // thread-stage failures on one channel made every sweep partial.
    const ROOT_A = "1786400000.000100";
    const ROOT_B = "1786400000.000110";
    const api: Pick<SlackApi, "history" | "replies"> = {
      history: async () => ({ messages: [] }),
      replies: async ({ channel }) => {
        if (channel === "C_LEFT") {
          throw new Error("An API error occurred: not_in_channel");
        }
        return { messages: [] };
      },
    };
    const checkpoints = {
      [`C_LEFT:${ROOT_A}`]: { cursorTs: "1786400000.000105" },
      [`C_LEFT:${ROOT_B}`]: { cursorTs: "1786400000.000115" },
    };

    const result = await recoverWorkspace({
      api,
      channels: [{ id: "C1" }],
      classification: classificationFor(),
      selfBotId: undefined,
      threadCheckpoints: checkpoints,
      window: WINDOW,
    });

    expect(result.threadCoverage.backgroundReads).toBe(2);
    expect(result.complete).toBe(true);
    expect(result.failures).toEqual([]);
    expect(result.excludedChannels).toEqual([{ channel: "C_LEFT", reason: "not-a-member" }]);
    expect(result.threadCheckpoints).toEqual(checkpoints);
  });

  it("keeps a TRANSIENT background failure as a failure, so the sweep stays partial", async () => {
    const ROOT = "1786400000.000100";
    const api: Pick<SlackApi, "history" | "replies"> = {
      history: async () => ({ messages: [] }),
      replies: async () => {
        throw new Error("ratelimited");
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

    expect(result.complete).toBe(false);
    expect(result.excludedChannels).toEqual([]);
    expect(result.failures).toEqual([
      { channel: "C1", messageTs: ROOT, reason: `reading thread ${ROOT} failed: ratelimited`, stage: "thread" },
    ]);
  });

  it("preserves the previous checkpoint and reports partial completeness when a background thread read fails", async () => {
    const ROOT = "1786400000.000100";
    const api: Pick<SlackApi, "history" | "replies"> = {
      history: async () => ({ messages: [] }),
      replies: async () => {
        throw new Error("thread gone");
      },
    };

    const result = await recoverWorkspace({
      api,
      channels: [{ id: "C1" }],
      classification: classificationFor(),
      selfBotId: undefined,
      threadCheckpoints: { [`C1:${ROOT}`]: { cursorTs: "1786400000.000200" } },
      window: WINDOW,
    });

    expect(result.complete).toBe(false);
    expect(result.threadCheckpoints[`C1:${ROOT}`]?.cursorTs).toBe("1786400000.000200");
    expect(result.failures).toEqual([
      {
        channel: "C1",
        messageTs: ROOT,
        reason: "reading thread 1786400000.000100 failed: thread gone",
        stage: "thread",
      },
    ]);
  });
});
