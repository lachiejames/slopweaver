import { describe, expect, it } from "vitest";

import { botDmWitnessRefusal, isBotDm } from "../../../../outbound/slack/botDmWitness.js";

const BOT_DM = "D0SYN000001";
const OWNER = "U0SYN000001";
const ROOT_TS = "1789829999.819679";

describe("isBotDm", () => {
  it("names the owner's bot DM, whitespace trimmed on either side", () => {
    expect(isBotDm({ channel: ` ${BOT_DM} `, promptChannel: `${BOT_DM}\n` })).toBe(true);
  });

  it("names nothing when promptChannel is unset or blank, or the destination is blank", () => {
    expect(isBotDm({ channel: BOT_DM, promptChannel: undefined })).toBe(false);
    expect(isBotDm({ channel: BOT_DM, promptChannel: "  " })).toBe(false);
    expect(isBotDm({ channel: " ", promptChannel: " " })).toBe(false);
  });
});

describe("botDmWitnessRefusal", () => {
  it("refuses a reply as the owner under their own root in the owner's bot DM, naming the direct reply", () => {
    const lines = botDmWitnessRefusal({
      channel: BOT_DM,
      promptChannel: BOT_DM,
      rootUserId: OWNER,
      selfUserId: OWNER,
      threadTs: ROOT_TS,
    });
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain("a reply as the owner under their own message to the bot");
    expect(lines[1]).toBe(
      `Send it directly: slopweaver slack reply --as me --channel ${BOT_DM} --thread-ts ${ROOT_TS} --form -`,
    );
    expect(lines[2]).toContain("NO escape hatch");
  });

  it("refuses a top-level post as the owner there, naming the direct top-level post", () => {
    const lines = botDmWitnessRefusal({
      channel: ` ${BOT_DM}`,
      promptChannel: BOT_DM,
      rootUserId: undefined,
      selfUserId: undefined,
      threadTs: undefined,
    });
    expect(lines[1]).toBe(
      `Send it directly: slopweaver slack post --as me --channel ${BOT_DM} --shape top-level --form -`,
    );
  });

  it("parks a reply under the bot's own root in that DM", () => {
    expect(
      botDmWitnessRefusal({
        channel: BOT_DM,
        promptChannel: BOT_DM,
        rootUserId: "U0SYN000005",
        selfUserId: OWNER,
        threadTs: ROOT_TS,
      }),
    ).toEqual([]);
  });

  it("parks a reply whose root author or sender the reads did not say", () => {
    expect(
      botDmWitnessRefusal({
        channel: BOT_DM,
        promptChannel: BOT_DM,
        rootUserId: undefined,
        selfUserId: OWNER,
        threadTs: ROOT_TS,
      }),
    ).toEqual([]);
    expect(
      botDmWitnessRefusal({
        channel: BOT_DM,
        promptChannel: BOT_DM,
        rootUserId: undefined,
        selfUserId: undefined,
        threadTs: ROOT_TS,
      }),
    ).toEqual([]);
  });

  it("parks the owner's own thread in a DM with a person", () => {
    expect(
      botDmWitnessRefusal({
        channel: "D0SYN000005",
        promptChannel: BOT_DM,
        rootUserId: OWNER,
        selfUserId: OWNER,
        threadTs: ROOT_TS,
      }),
    ).toEqual([]);
  });

  it("parks a post aimed at the owner's own user id, which under their token is a self-DM, not the bot DM", () => {
    expect(
      botDmWitnessRefusal({
        channel: OWNER,
        promptChannel: BOT_DM,
        rootUserId: undefined,
        selfUserId: OWNER,
        threadTs: undefined,
      }),
    ).toEqual([]);
  });

  it("parks anything when promptChannel is unset", () => {
    expect(
      botDmWitnessRefusal({
        channel: BOT_DM,
        promptChannel: undefined,
        rootUserId: OWNER,
        selfUserId: OWNER,
        threadTs: undefined,
      }),
    ).toEqual([]);
  });
});
