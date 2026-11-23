/*
 * `draftListRow`: one `slack draft list` row carries the id, state, instant, channel and why, marks a why it
 * had to shorten, and says the raw channel id when the recording could not name the channel.
 */
import { describe, expect, it } from "vitest";

import { draftListRow } from "../../../../../../cli/commands/slack/draftReport.js";
import type { SlackDripMessagePayload } from "../../../../../../outbound/slack/types.js";
import { annotatedRecord } from "../../../../../annotatedShotFixture.js";
import { item, picture, SHOT_DIGEST } from "./harness.js";

/** A payload whose rich text shows the reader one link, so a first message in a channel has its link. */
const LINKED: SlackDripMessagePayload = {
  blocks: [
    {
      elements: [
        {
          elements: [
            { text: "Four groups, one question.", type: "text" },
            { text: "the control", type: "link", url: "https://app.vanta.com/controls/iso" },
          ],
          type: "rich_text_section",
        },
      ],
      type: "rich_text",
    },
  ],
  form: "rich",
  text: "Four groups, one question.",
  unfurl_links: true,
  unfurl_media: true,
};

describe("draftListRow", () => {
  it("carries the id, the state, the instant, the channel by name and what it is for", () => {
    const row = draftListRow({
      item: item({ over: { payload: LINKED } }),
      media: picture({ records: [annotatedRecord({ digest: SHOT_DIGEST })] }),
    });
    expect(row).toContain("sd-11111111");
    expect(row).toContain("held");
    expect(row).toContain("2026-09-23T00:00:00.000Z");
    expect(row).toContain("#iso-27001");
    expect(row).toContain("the entry-group question the four-group thread left");
  });

  it("marks a why it had to shorten, so a clipped column never reads as the whole line", () => {
    const media = picture({ records: [annotatedRecord({ digest: SHOT_DIGEST })] });
    expect(draftListRow({ item: item({ over: { payload: LINKED } }), media })).toContain("…");
    expect(
      draftListRow({ item: item({ over: { payload: LINKED, why: "the ISO group question" } }), media }),
    ).not.toContain("…");
  });

  it("falls back to the raw channel id, said as an id, when the recording could not name the channel", () => {
    const row = draftListRow({ item: item({ over: { channelName: undefined } }), media: [] });
    expect(row).toContain("C0ISO");
    expect(row).not.toContain("#");
  });
});
