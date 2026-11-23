/*
 * Reach provenance: whether the token was a member of a channel, and whether it is archived, stamped on the channel
 * and on every record it holds, and claimed for no DM. It moved here when `project.test.ts` was split by behaviour.
 */
import { describe, expect, it } from "vitest";
import { channelReachAttrs, projectSlackRecords } from "../../../../../corpus/slack/project.js";

describe("channelReachAttrs", () => {
  it("stamps a member channel as such, with no archived flag", () => {
    expect(channelReachAttrs({ channel: { isMember: true } })).toEqual({ membership: "member" });
  });

  it("stamps a channel the token never joined, so a citation can say it was not in the room", () => {
    expect(channelReachAttrs({ channel: {} })).toEqual({ membership: "non-member" });
  });

  it("carries the archived flag alongside membership", () => {
    expect(channelReachAttrs({ channel: { isArchived: true, isMember: true } })).toEqual({
      archived: true,
      membership: "member",
    });
  });

  it("claims nothing for a DM or group DM, where conversations.list omits is_member entirely", () => {
    expect(channelReachAttrs({ channel: { isIm: true } })).toEqual({});
    expect(channelReachAttrs({ channel: { isMpim: true } })).toEqual({});
  });
});

describe("projectSlackRecords reach provenance", () => {
  const message = {
    channelId: "C1",
    files: [],
    permalink: "https://acme.slack.com/archives/C1/p1",
    reactions: [],
    text: "the deal closed",
    ts: "1700000000.000100",
    tsIso: "2023-11-14T22:13:20.000Z",
  };
  const named = { ...message, channelName: "sales" };

  it("marks every record from a non-member channel, keeping the channel attr it already had", () => {
    const records = projectSlackRecords({
      channels: [{ channelId: "C1", channelName: "sales", messages: [named], replies: [] }],
    });
    expect(records[0]!.attrs).toEqual({ channel: "#sales", membership: "non-member" });
  });

  it("marks a member channel's records as member, and an archived one as archived", () => {
    const records = projectSlackRecords({
      channels: [
        { channelId: "C1", channelName: "sales", isArchived: true, isMember: true, messages: [named], replies: [] },
      ],
    });
    expect(records[0]!.attrs).toEqual({ archived: true, channel: "#sales", membership: "member" });
  });

  it("leaves a DM's records unstamped rather than asserting a membership the payload never carried", () => {
    const records = projectSlackRecords({
      channels: [{ channelId: "D1", isIm: true, messages: [{ ...message, channelId: "D1" }], replies: [] }],
    });
    expect(records[0]!.attrs).toEqual({ channel: "D1" });
  });
});
