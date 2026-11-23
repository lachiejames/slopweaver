/**
 * The foreground history walk on its own — plain fakes for the Slack read seam, no real network. What it has
 * to prove is the per-channel accounting a deleted root must not disturb: a gone thread costs its channel
 * nothing, and a channel that ALSO failed a read keeps no gone verdict it could later be retired on.
 */
import { describe, expect, it } from "vitest";

import type { SlackApi } from "../../../../corpus/slack/fetch.js";
import { scanAllChannels } from "../../../../live/listen/recoverForeground.js";
import type { ClassificationContext } from "../../../../live/listen/recoverForegroundMessages.js";
import type { RecoveryWindow } from "../../../../live/listen/recoverSchedule.js";

const WINDOW: RecoveryWindow = {
  latestExclusiveTs: "1786622400.000000",
  oldestExclusiveTs: "1786320000.000000",
  sinceIso: "2026-08-10T00:00:00.000Z",
  untilIso: "2026-08-13T12:00:00.000Z",
};

const CLASSIFICATION: ClassificationContext = {
  allowedChannels: ["C1", "C2"],
  botUserId: "U_BOT",
  cardEventType: "slopweaver_card_v1",
  ignored: new Map(),
  ignoredConversations: new Map(),
  lifecycles: new Map(),
  since: "2020-01-01T00:00:00.000Z",
  terminalByAsk: new Map(),
};

const ROOT_TS = "1786400000.000100";
const TAG = { text: "<@U_BOT> hello", ts: ROOT_TS, user: "U_ASKER" };

/** A seam whose history shows `rows` and whose every thread read throws the next of `replyErrors`. */
function failingReplies({
  rows,
  replyErrors,
}: {
  rows: readonly unknown[];
  replyErrors: readonly string[];
}): Pick<SlackApi, "history" | "replies"> {
  let calls = 0;
  return {
    history: async () => ({ messages: rows }),
    replies: async () => {
      const message = replyErrors[calls]!;
      calls += 1;
      throw new Error(message);
    },
  };
}

describe("scanAllChannels", () => {
  it("reports a tag whose root was deleted before its thread read as gone, and still completes the channel", async () => {
    const api = failingReplies({ replyErrors: ["An API error occurred: thread_not_found"], rows: [TAG] });

    const scan = await scanAllChannels({
      api,
      channels: [{ id: "C1" }],
      classification: CLASSIFICATION,
      selfBotId: undefined,
      window: WINDOW,
    });

    expect(scan.goneThreads).toEqual([{ channel: "C1", threadTs: ROOT_TS }]);
    expect(scan.failures).toEqual([]);
    expect(scan.candidates).toEqual([]);
    expect(scan.completedChannels).toBe(1);
  });

  it("drops a gone verdict from a channel whose same root also failed a read, keeping the failure", async () => {
    const api = failingReplies({
      replyErrors: ["An API error occurred: thread_not_found", "ratelimited"],
      rows: [TAG, TAG],
    });

    const scan = await scanAllChannels({
      api,
      channels: [{ id: "C1" }],
      classification: CLASSIFICATION,
      selfBotId: undefined,
      window: WINDOW,
    });

    expect(scan.goneThreads).toEqual([]);
    expect(scan.failures.map((failure) => failure.stage)).toEqual(["thread"]);
    expect(scan.completedChannels).toBe(0);
  });

  it("reports progress once per channel, the last naming every channel", async () => {
    const api: Pick<SlackApi, "history" | "replies"> = {
      history: async () => ({ messages: [] }),
      replies: async () => ({ messages: [] }),
    };
    const seen: number[] = [];

    await scanAllChannels({
      api,
      channels: [{ id: "C1" }, { id: "C2" }],
      classification: CLASSIFICATION,
      onProgress: ({ channelsCompleted, channelsTotal }) => {
        seen.push(channelsCompleted * 10 + channelsTotal);
      },
      selfBotId: undefined,
      window: WINDOW,
    });

    expect(seen).toEqual([12, 22]);
  });
});
