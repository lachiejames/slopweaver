/*
 * The configured prompt channel exempts a PR-led opening only once a bot-token `conversations.info` read names the owner as
 * the DM's other member — the fleet-found bug where a colleague's DM configured there was exempt.
 */
import { describe, expect, it } from "vitest";

import {
  type PromptChannelInfo,
  readVerifiedOwnDm,
  verifiedOwnDmFromBotInfo,
} from "../../../../../cli/commands/slack/verifiedOwnDm.js";

const PROMPT = "D0PROMPT";
const OWNER = "U0OWNER";
const BOT_TOKEN = "xoxb-bot";

/** A read that records every token and channel it was asked with, answering `info`. */
function recordingRead({ info }: { info: PromptChannelInfo }): {
  asked: { channel: string; token: string }[];
  read: (args: { channel: string; token: string }) => Promise<PromptChannelInfo>;
} {
  const asked: { channel: string; token: string }[] = [];
  return {
    asked,
    read: async (args) => {
      asked.push(args);
      return info;
    },
  };
}

describe("readVerifiedOwnDm", () => {
  it("proves the prompt channel the owner's when the bot-token read names the owner its other member", async () => {
    const { asked, read } = recordingRead({ info: { surface: "direct-message", user: OWNER } });

    const verified = await readVerifiedOwnDm({
      botToken: BOT_TOKEN,
      channel: PROMPT,
      conversationInfo: read,
      ownerUserId: OWNER,
      promptChannel: PROMPT,
    });

    expect(verified).toBe(PROMPT);
    expect(asked).toEqual([{ channel: PROMPT, token: BOT_TOKEN }]);
  });

  it.each([
    { info: { surface: "direct-message", user: "U0SYNCOLLEAGUE" }, name: "a colleague is the other member" },
    { info: { surface: "direct-message" }, name: "the read names no other member" },
    { info: { surface: undefined, user: OWNER }, name: "the surface is unknown" },
    { info: { surface: "public-channel", user: OWNER }, name: "it is a public channel" },
    { info: { surface: "private-channel", user: OWNER }, name: "it is a private channel" },
  ] satisfies { info: PromptChannelInfo; name: string }[])("proves nothing when $name", async ({ info }) => {
    const { asked, read } = recordingRead({ info });

    const verified = await readVerifiedOwnDm({
      botToken: BOT_TOKEN,
      channel: PROMPT,
      conversationInfo: read,
      ownerUserId: OWNER,
      promptChannel: PROMPT,
    });

    expect(verified).toBeUndefined();
    expect(asked).toEqual([{ channel: PROMPT, token: BOT_TOKEN }]);
  });

  it.each([
    { channel: "D0OTHER", name: "a DM other than the prompt channel", promptChannel: PROMPT },
    { channel: "C0TEAM", name: "a channel configured as the prompt channel", promptChannel: "C0TEAM" },
    { channel: PROMPT, name: "an install with no ownerUserId", ownerUserId: null },
    { channel: PROMPT, name: "an empty ownerUserId", ownerUserId: "" },
    { botToken: undefined, channel: PROMPT, name: "no bot token" },
    { botToken: "xoxp-user", channel: PROMPT, name: "a user token where the bot one belongs" },
  ])("proves nothing and reads nothing for $name", async (row) => {
    const { asked, read } = recordingRead({ info: { surface: "direct-message", user: OWNER } });
    const { botToken, ownerUserId, promptChannel } = {
      botToken: BOT_TOKEN,
      ownerUserId: OWNER,
      promptChannel: PROMPT,
      ...row,
    };

    const verified = await readVerifiedOwnDm({
      botToken,
      channel: row.channel,
      conversationInfo: read,
      ownerUserId,
      promptChannel,
    });

    expect(verified).toBeUndefined();
    expect(asked).toEqual([]);
  });

  it("proves nothing when the read throws", async () => {
    const verified = await readVerifiedOwnDm({
      botToken: BOT_TOKEN,
      channel: PROMPT,
      conversationInfo: async () => {
        throw new Error("ratelimited");
      },
      ownerUserId: OWNER,
      promptChannel: PROMPT,
    });

    expect(verified).toBeUndefined();
  });
});

describe("verifiedOwnDmFromBotInfo", () => {
  const OWNERS_DM = { surface: "direct-message", user: OWNER } satisfies PromptChannelInfo;

  it("answers the channel for the owner's own DM", () => {
    expect(
      verifiedOwnDmFromBotInfo({ channel: PROMPT, info: OWNERS_DM, ownerUserId: OWNER, promptChannel: PROMPT }),
    ).toBe(PROMPT);
  });

  it("answers nothing for a padded prompt channel, compared untrimmed", () => {
    expect(
      verifiedOwnDmFromBotInfo({ channel: PROMPT, info: OWNERS_DM, ownerUserId: OWNER, promptChannel: ` ${PROMPT} ` }),
    ).toBeUndefined();
  });

  it("answers nothing when no prompt channel is configured", () => {
    expect(
      verifiedOwnDmFromBotInfo({ channel: PROMPT, info: OWNERS_DM, ownerUserId: OWNER, promptChannel: undefined }),
    ).toBeUndefined();
  });
});
