/**
 * The scheduled sweep's scan stage: live-incident detection sees the whole discovery before any channel is read, and
 * neither a discovery failure nor a throw inside detection reaches the sweep as anything but a reported refusal.
 */
import { describe, expect, it } from "vitest";

import { scanWorkspace } from "../../../../../cli/commands/listen/scheduledScan.js";
import type { SlackApi } from "../../../../../corpus/slack/fetch.js";
import type { ClassificationContext } from "../../../../../live/listen/recoverForegroundMessages.js";
import type { RecoveryWindow } from "../../../../../live/listen/recoverSchedule.js";

const CLASSIFICATION: ClassificationContext = {
  allowedChannels: ["C1"],
  botUserId: "U_BOT",
  cardEventType: "slopweaver_card",
  ignored: new Map(),
  ignoredConversations: new Map(),
  lifecycles: new Map(),
  since: "2026-08-13T11:55:00.000Z",
  terminalByAsk: new Map(),
};

const WINDOW: RecoveryWindow = {
  latestExclusiveTs: "1786622400.000000",
  oldestExclusiveTs: "1786622100.000000",
  sinceIso: "2026-08-13T11:55:00.000Z",
  untilIso: "2026-08-13T12:00:00.000Z",
};

/** A read seam whose discovery lists `C1` (member) and `C2` (not joined), recording every read in order. */
function recordingApi({ reads }: { reads: string[] }): Pick<SlackApi, "history" | "replies" | "listChannels"> {
  return {
    history: async ({ channel }) => {
      reads.push(`history ${channel}`);
      return { messages: [] };
    },
    listChannels: async ({ lane }) =>
      lane === "group-dms"
        ? { channels: [] }
        : {
            channels: [
              { id: "C1", is_member: true },
              { id: "C2", is_member: false },
            ],
          },
    replies: async () => ({ messages: [] }),
  };
}

describe("scanWorkspace", () => {
  it("hands detection every discovered channel, joined or not, before the first channel read", async () => {
    const reads: string[] = [];
    const scan = await scanWorkspace({
      api: recordingApi({ reads }),
      classification: CLASSIFICATION,
      incidents: async ({ channels }) => {
        reads.push(`detect ${channels.map((channel) => channel.id).join(",")}`);
        return { registered: [], skipped: [] };
      },
      nowMs: Date.parse("2026-08-13T12:00:00.000Z"),
      selfBotId: undefined,
      threadCheckpoints: {},
      window: WINDOW,
    });

    expect(reads).toEqual(["detect C1,C2", "history C1"]);
    expect(scan.incidents).toEqual({ registered: [], skipped: [] });
  });

  it("reports a throw inside detection as its refusal and still scans", async () => {
    const reads: string[] = [];
    const scan = await scanWorkspace({
      api: recordingApi({ reads }),
      classification: CLASSIFICATION,
      incidents: async () => {
        throw new Error("register crashed");
      },
      nowMs: Date.parse("2026-08-13T12:00:00.000Z"),
      selfBotId: undefined,
      threadCheckpoints: {},
      window: WINDOW,
    });

    expect(scan.incidents).toEqual({
      refused: "incident detection threw: register crashed",
      registered: [],
      skipped: [],
    });
    expect(reads).toEqual(["history C1"]);
    expect(scan.complete).toBe(true);
  });

  it("names the discovery failure as detection's refusal, never calling the seam", async () => {
    const reads: string[] = [];
    const scan = await scanWorkspace({
      api: {
        history: async () => ({ messages: [] }),
        listChannels: async () => {
          throw new Error("ratelimited");
        },
        replies: async () => ({ messages: [] }),
      },
      classification: CLASSIFICATION,
      incidents: async () => {
        reads.push("detect");
        return { registered: [], skipped: [] };
      },
      nowMs: Date.parse("2026-08-13T12:00:00.000Z"),
      selfBotId: undefined,
      threadCheckpoints: {},
      window: WINDOW,
    });

    expect(reads).toEqual([]);
    expect(scan.complete).toBe(false);
    expect(scan.incidents.refused).toContain("discovery failed: ");
    expect(scan.incidents.registered).toEqual([]);
  });
});
