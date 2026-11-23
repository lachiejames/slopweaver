/**
 * One Slack message as the voice says it, over messages built from raw rows by the real projection: mentions named,
 * escaped characters as a reader sees them, an author by name, and a line cut to a breath.
 */
import { describe, expect, it } from "vitest";

import { projectTopLevelMessages } from "../../../../live/slack/projection.js";
import { messageWords, oneLine, spokenAuthorName } from "../../../../live/slack/spokenWords.js";
import type { VisibleSlackMessage } from "../../../../live/slack/types.js";

const ROSA = "U0SYNROSA123";
const MAPS = { channelNames: {}, userNames: { [ROSA]: "Rosa Lindqvist" } };

/** One projected message from one raw row. */
function message({ row }: { row: Record<string, unknown> }): VisibleSlackMessage {
  return projectTopLevelMessages({ channel: "D0SYNDM12345", rawMessages: [row], workspace: "https://acme.slack.com" })
    .messages[0]!;
}

describe("projectTopLevelMessages", () => {
  it("counts a row it cannot read rather than dropping it silently", () => {
    const projected = projectTopLevelMessages({
      channel: "D0SYNDM12345",
      rawMessages: [{ text: "no ts" }, "not a row", { text: "hi", ts: "1791000000.000100", user: "U0SYNROSA123" }],
      workspace: "https://acme.slack.com",
    });
    expect(projected.messages.map((row) => row.text)).toEqual(["hi"]);
    expect(projected.unreadable).toBe(2);
  });
});

describe("messageWords", () => {
  it("names a mention and unescapes what Slack escaped", () => {
    const projected = message({
      row: { text: `<@${ROSA}> p95 is under &lt; 50s`, ts: "1791000000.000100", user: ROSA },
    });
    expect(messageWords({ maps: MAPS, message: projected })).toBe("@Rosa Lindqvist p95 is under < 50s");
  });
});

describe("spokenAuthorName", () => {
  it("says a member by name, a bot by its username, and an id nobody knows as someone", () => {
    expect(spokenAuthorName({ author: { userId: ROSA }, names: MAPS.userNames })).toBe("Rosa Lindqvist");
    expect(spokenAuthorName({ author: { botId: "B0BOT", username: "acme-bot" }, names: {} })).toBe("acme-bot");
    expect(spokenAuthorName({ author: { botId: "B0BOT" }, names: {} })).toBe("an app");
    expect(spokenAuthorName({ author: { userId: "U0SYNNOBODY1" }, names: {} })).toBe("someone");
  });
});

describe("oneLine", () => {
  it("collapses whitespace and cuts at the limit with an ellipsis", () => {
    expect(oneLine({ maxChars: 40, text: "short\n\n  enough" })).toBe("short enough");
    expect(oneLine({ maxChars: 10, text: "a line that runs past ten" })).toBe("a line tha …");
  });
});
