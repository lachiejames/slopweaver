/*
 * Which Slack records read private: a private channel, a DM or an mpim stamps every record it holds, and a message
 * the owner's own bot posted resolves back to the owner. It moved here when `project.test.ts` was split by behaviour.
 */
import { describe, expect, it } from "vitest";
import {
  projectSlackRecords,
  type SlackChannelItems,
  slackChannelVisibility,
} from "../../../../../corpus/slack/project.js";
import { channel } from "./harness.js";

describe("slackChannelVisibility", () => {
  it("marks a public channel public", () => {
    expect(slackChannelVisibility({ channel: {} })).toBe("public");
  });

  it("marks a private channel, a DM, or an mpim private", () => {
    expect(slackChannelVisibility({ channel: { isPrivate: true } })).toBe("private");
    expect(slackChannelVisibility({ channel: { isIm: true } })).toBe("private");
    expect(slackChannelVisibility({ channel: { isMpim: true } })).toBe("private");
  });
});

describe("projectSlackRecords — visibility + me-to-me (PR4.5)", () => {
  it("stamps EVERY record of a public channel as public (no visibility field)", () => {
    const records = projectSlackRecords({ channels: [channel] });
    expect(records.length).toBeGreaterThan(0);
    expect(records.every((r) => r.visibility === undefined)).toBe(true);
  });

  it("stamps EVERY record of a private channel (message + reply + file) private", () => {
    const records = projectSlackRecords({ channels: [{ ...channel, isPrivate: true }] });
    expect(records.length).toBeGreaterThan(0);
    expect(records.every((r) => r.visibility === "private")).toBe(true);
  });

  it("stamps a DM channel's records private", () => {
    const records = projectSlackRecords({ channels: [{ ...channel, isIm: true }] });
    expect(records.every((r) => r.visibility === "private")).toBe(true);
  });

  it("resolves a message posted by the owner's own bot back to the owner (me-to-me)", () => {
    const botChannel: SlackChannelItems = {
      channelId: "C_PUBLIC_ALPHA",
      messages: [
        {
          author: "U_OWNER_BOT",
          channelId: "C_PUBLIC_ALPHA",
          files: [],
          permalink: "https://example.invalid/archives/C_PUBLIC_ALPHA/p1700000000000900",
          raw: { app_id: "A_OWNER_APP", text: "on it", user: "U_OWNER_BOT" },
          reactions: [],
          text: "on it",
          ts: "1700000000.000900",
          tsIso: "2023-11-14T22:13:20.000Z",
        },
      ],
      replies: [],
    };
    const records = projectSlackRecords({
      channels: [botChannel],
      ownerBot: { appIds: ["A_OWNER_APP"], botIds: [], botUserIds: ["U_OWNER_BOT"], ownerSlackUserId: "U_OWNER" },
    });
    expect(records.find((r) => r.kind === "message")!.author).toBe("U_OWNER");
  });

  it("leaves a non-owner author unchanged when an owner bot is configured", () => {
    const records = projectSlackRecords({
      channels: [channel],
      ownerBot: { appIds: [], botIds: [], botUserIds: ["U_OWNER_BOT"], ownerSlackUserId: "U_OWNER" },
    });
    expect(records.find((r) => r.kind === "message")!.author).toBe("U1");
  });
});
