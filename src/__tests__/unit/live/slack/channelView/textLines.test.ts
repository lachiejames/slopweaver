/*
 * The live channel window as terminal lines: the channel named first, each message under its author's name with
 * its files beneath it, and each reaction's emoji and count under the message. It was split out when the
 * channel-window suite became one file per behaviour.
 */
import { describe, expect, it } from "vitest";
import { unwrap } from "../../../../../lib/result.js";
import { channelViewDocument } from "../../../../../live/slack/channelView.js";
import { channelViewTextLines } from "../../../../../live/slack/channelViewText.js";
import { NO_LOOKUP, OBSERVED, PAGE, recordingFetch, WORKSPACE } from "./harness.js";

describe("channelViewTextLines", () => {
  it("names the channel, then each message with its author's name and its files beneath it", async () => {
    const document = unwrap(
      await channelViewDocument({
        channel: "C0CHAN",
        fetchPicture: recordingFetch({ asked: [] }),
        hasMore: true,
        lookupFile: NO_LOOKUP,
        name: "proj-monitoring",
        observedAtIso: OBSERVED,
        rows: [PAGE[0], { text: "a bot", ts: "1790000000.000100", username: "deploybot" }],
        workspace: WORKSPACE,
      }),
    );

    expect(channelViewTextLines({ document, names: new Map([["U0NEW", "Ana Newman"]]) })).toEqual([
      "#proj-monitoring (C0CHAN) read live at 2026-10-17T01:00:00.000Z — earlier messages not shown",
      "2026-09-21T14:13:20.000Z  deploybot: a bot", // `slopweaver slack when 1790000000.000100`
      "2026-09-21T14:28:20.000Z  Ana Newman: the spec <@U0SYNMENTION>", // `slopweaver slack when 1790000900.000900`
      "    [file F0PDF spec.pdf — not-a-picture]",
    ]);
  });

  it("carries each reaction's emoji and count, in Slack's order, and prints them under the message", async () => {
    const reacted = {
      reactions: [
        { count: 3, name: "eyes", users: ["U0A", "U0B", "U0C"] },
        { name: "white_check_mark", users: ["U0A"] },
      ],
      text: "shipped",
      ts: "1790000000.000100",
      user: "U0NEW",
    };
    const document = unwrap(
      await channelViewDocument({
        channel: "C0CHAN",
        fetchPicture: recordingFetch({ asked: [] }),
        hasMore: false,
        lookupFile: NO_LOOKUP,
        name: "proj-monitoring",
        observedAtIso: OBSERVED,
        rows: [reacted, { text: "quiet", ts: "1790000000.000000", user: "U0NEW" }],
        workspace: WORKSPACE,
      }),
    );

    expect(document.messages.map((message) => message.reactions)).toEqual([
      [],
      [
        { count: 3, name: "eyes" },
        { count: 1, name: "white_check_mark" },
      ],
    ]);
    expect(channelViewTextLines({ document, names: new Map() }).at(-1)).toBe("    [:eyes: 3  :white_check_mark: 1]");
  });
});
