/**
 * The all-visible workspace scan's candidates — what an unanswered tag yields, which messages earn a FOREGROUND
 * thread read and which never do, and the per-channel progress line.
 */
import { describe, expect, it } from "vitest";

import type { SlackApi } from "../../../../../corpus/slack/fetch.js";
import { type IgnoredAsk, ignoredAskKey } from "../../../../../live/ask/ignore.js";
import { recoverWorkspace } from "../../../../../live/listen/recoverSweep.js";
import { ASSISTANT_ANSWER_EVENT_TYPE_V2 } from "../../../../../outbound/assistant/answerMessage.js";
import { classificationFor, tagRow, WINDOW } from "./fixtures.js";

function historyServing({ messages }: { messages: readonly unknown[] }): Pick<SlackApi, "history" | "replies"> {
  return {
    history: async () => ({ messages }),
    replies: async ({ ts }) => ({ messages: [{ ts, user: "U_ASKER" }] }),
  };
}

describe("recoverWorkspace", () => {
  it("returns a candidate for an unanswered tag in a public channel", async () => {
    const api = historyServing({ messages: [tagRow({ ts: "1786400000.000100" })] });

    const result = await recoverWorkspace({
      api,
      threadCheckpoints: {},
      channels: [{ id: "C1" }],
      classification: classificationFor(),
      selfBotId: undefined,
      window: WINDOW,
    });

    expect(result.complete).toBe(true);
    expect(result.discoveredChannels).toBe(1);
    expect(result.completedChannels).toBe(1);
    expect(result.candidates.length).toBe(1);
    expect(result.candidates[0]?.channel).toBe("C1");
    expect(result.failures).toEqual([]);
  });

  it("carries thread answers found on the fully-read thread", async () => {
    const askIdentity = {
      channel: "C1",
      messageTs: "1786400000.000100",
      quality: "exact",
      threadTs: "1786400000.000100",
    };
    const api: Pick<SlackApi, "history" | "replies"> = {
      history: async () => ({ messages: [tagRow({ ts: "1786400000.000100" })] }),
      replies: async () => ({
        messages: [
          { ts: "1786400000.000100", user: "U_ASKER" },
          {
            metadata: {
              event_payload: { artifactFingerprint: "fp", askIdentity, renderer: "r" },
              event_type: ASSISTANT_ANSWER_EVENT_TYPE_V2,
            },
            ts: "1786400000.000200",
            user: "U_BOT",
          },
        ],
      }),
    };

    const result = await recoverWorkspace({
      api,
      threadCheckpoints: {},
      channels: [{ id: "C1" }],
      classification: classificationFor(),
      selfBotId: undefined,
      window: WINDOW,
    });

    expect(result.candidates[0]?.threadAnswers).toEqual([askIdentity]);
  });

  it("never pays a FOREGROUND thread read for an unthreaded message that never addresses the bot", async () => {
    const api: Pick<SlackApi, "history" | "replies"> = {
      history: async () => ({
        messages: [{ reply_count: 0, text: "no tag here at all", ts: "1786400000.000100", user: "U_ASKER" }],
      }),
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

    expect(result.threadCoverage.foregroundReads).toBe(0);
    expect(result.candidates.length).toBe(1);
    expect(result.candidates[0]?.threadAnswers).toEqual([]);
  });

  it("never pays a FOREGROUND thread read for a message in a channel outside the reply-eligible set", async () => {
    const api: Pick<SlackApi, "history" | "replies"> = {
      history: async () => ({ messages: [tagRow({ ts: "1786400000.000100" })] }),
      replies: async () => ({ messages: [] }),
    };

    const result = await recoverWorkspace({
      api,
      threadCheckpoints: {},
      channels: [{ id: "C_ELSEWHERE" }],
      classification: classificationFor(),
      selfBotId: undefined,
      window: WINDOW,
    });

    expect(result.threadCoverage.foregroundReads).toBe(0);
    expect(result.candidates.length).toBe(1);
    expect(result.candidates[0]?.threadAnswers).toEqual([]);
  });

  it("never pays a FOREGROUND thread read for an ignored candidate", async () => {
    const ignored: ReadonlyMap<string, IgnoredAsk> = new Map([
      [
        ignoredAskKey({ askIdentity: { channel: "C1", messageTs: "1786400000.000100" } }),
        {
          channel: "C1",
          ignoredAtIso: "2026-08-12T00:00:00.000Z",
          messageTs: "1786400000.000100",
          reason: "not worth answering",
          schemaVersion: 1,
        },
      ],
    ]);
    const api: Pick<SlackApi, "history" | "replies"> = {
      history: async () => ({ messages: [tagRow({ ts: "1786400000.000100" })] }),
      replies: async () => ({ messages: [] }),
    };

    const result = await recoverWorkspace({
      api,
      threadCheckpoints: {},
      channels: [{ id: "C1" }],
      classification: classificationFor({ ignored }),
      selfBotId: undefined,
      window: WINDOW,
    });

    expect(result.threadCoverage.foregroundReads).toBe(0);
    expect(result.candidates.length).toBe(1);
    expect(result.candidates[0]?.threadAnswers).toEqual([]);
  });

  it("reports progress once per channel", async () => {
    const seen: { channelsCompleted: number; channelsTotal: number; candidatesFound: number }[] = [];
    const api = historyServing({ messages: [] });

    await recoverWorkspace({
      api,
      threadCheckpoints: {},
      channels: [{ id: "C1" }, { id: "C2" }],
      classification: classificationFor(),
      selfBotId: undefined,
      onProgress: (p) => seen.push(p),
      window: WINDOW,
    });

    expect(seen).toEqual([
      { candidatesFound: 0, channelsCompleted: 1, channelsTotal: 2 },
      { candidatesFound: 0, channelsCompleted: 2, channelsTotal: 2 },
    ]);
  });
});
