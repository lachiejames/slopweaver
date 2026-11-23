/**
 * What a Slack conversation id alone says about where a post lands: a DM or member id is direct, everything else is
 * a channel, and a top-level channel post is one with no thread root.
 */
import { describe, expect, it } from "vitest";

import { isDirectConversationId, landsTopLevelInChannel } from "../../../../outbound/slack/conversationId.js";

describe("isDirectConversationId", () => {
  it("reads a D… DM and a U…/W… member id as direct", () => {
    expect(
      ["D0SYN123ABCD", "U0SYN123ABCD", "W0SYN123ABCD"].map((channel) => isDirectConversationId({ channel })),
    ).toEqual([true, true, true]);
  });

  it("reads a C… channel and a G… group, group DMs included, as not direct", () => {
    expect(["C0SYN123ABCD", "G0SYN123ABCD"].map((channel) => isDirectConversationId({ channel }))).toEqual([
      false,
      false,
    ]);
  });

  it("reads a lowercase or bare-prefix id as not direct, failing toward the channel rule", () => {
    expect(["d0123abcd", "D", ""].map((channel) => isDirectConversationId({ channel }))).toEqual([false, false, false]);
  });
});

describe("landsTopLevelInChannel", () => {
  it("is true for a channel post with no thread root", () => {
    expect(landsTopLevelInChannel({ channel: "C0SYN123ABCD", threadTs: undefined })).toBe(true);
  });

  it("is false for a thread reply in a channel", () => {
    expect(landsTopLevelInChannel({ channel: "C0SYN123ABCD", threadTs: "1760000000.000100" })).toBe(false);
  });

  it("is false for a top-level DM", () => {
    expect(landsTopLevelInChannel({ channel: "D0SYN123ABCD", threadTs: undefined })).toBe(false);
  });
});
