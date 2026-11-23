/**
 * `draftSentContent.ts` — a `sent …` record proves the row's media and a card's or no-fold message's blocks, not its
 * words alone: text identity once spent an approved row whose attachment or card never reached Slack.
 */
import type { RichTextBlock } from "@slack/types";
import { describe, expect, it } from "vitest";

import { sentContentProven } from "../../../../outbound/slack/draftSentContent.js";
import type { SlackCardPayload, SlackNoFoldPayload } from "../../../../outbound/slack/types.js";
import { draftItem } from "../../supervisor/draftItemFixture.js";

const ROW = draftItem({ id: "sd-11112222", tsIso: "2026-10-08T00:10:00.000Z" });
const MEDIUM = { bytes: 2048, name: "graph.png", sha256: "a".repeat(64) };
const SECTION = { text: { text: "sounds good", type: "mrkdwn" }, type: "section" } as const;
const CARD: SlackCardPayload = {
  attachments: [{ blocks: [SECTION], color: "#2eb67d", fallback: "sounds good" }],
  metadata: {
    event_payload: { artifactFingerprint: "f1", artifactKind: "update", renderer: "slack-card-v1", schemaVersion: 1 },
    event_type: "slopweaver_card",
  },
  text: "",
  unfurl_links: false,
  unfurl_media: false,
};
const RICH: RichTextBlock = {
  elements: [{ elements: [{ text: "sounds good", type: "text" }], type: "rich_text_section" }],
  type: "rich_text",
};
const NO_FOLD: SlackNoFoldPayload = {
  blocks: [RICH],
  metadata: {
    event_payload: {
      artifactFingerprint: "f2",
      artifactKind: "no-fold",
      renderer: "slack-no-fold-v1",
      schemaVersion: 1,
    },
    event_type: "slopweaver_no_fold",
  },
  text: "sounds good",
  unfurl_links: false,
  unfurl_media: false,
};

describe("sentContentProven", () => {
  it("proves a drip with no media by its words alone", () => {
    expect(sentContentProven({ messages: [{ text: "sounds good" }], row: ROW })).toBe(true);
  });

  it("requires each medium as a distinct file of the same name and byte count", () => {
    const row = { ...ROW, draft: { ...ROW.draft, media: [MEDIUM, MEDIUM] } };
    const file = { name: "graph.png", size: 2048 };

    expect(sentContentProven({ messages: [{ files: [file, file] }], row })).toBe(true);
    expect(sentContentProven({ messages: [{ files: [file] }, { files: [file] }], row })).toBe(true);
    expect(sentContentProven({ messages: [{ files: [file] }], row })).toBe(false);
    expect(sentContentProven({ messages: [{ files: [file, { name: "graph.png", size: 9 }] }], row })).toBe(false);
    expect(sentContentProven({ messages: [{ text: "sounds good" }], row })).toBe(false);
  });

  it("requires a card's wrapper blocks in the one message, Slack's own added fields aside", () => {
    const row = { ...ROW, draft: { ...ROW.draft, payload: CARD } };
    const posted = { ...SECTION, block_id: "x1", text: { ...SECTION.text, verbatim: false } };
    const wrapper = ({ blocks }: { blocks: readonly unknown[] }) => ({
      attachments: [{ blocks, fallback: "sounds good" }],
    });

    expect(sentContentProven({ messages: [wrapper({ blocks: [posted] })], row })).toBe(true);
    expect(sentContentProven({ messages: [wrapper({ blocks: [] })], row })).toBe(false);
    expect(sentContentProven({ messages: [{ text: "sounds good" }], row })).toBe(false);
    expect(
      sentContentProven({
        messages: [wrapper({ blocks: [{ ...posted, text: { text: "other", type: "mrkdwn" } }] })],
        row,
      }),
    ).toBe(false);
    expect(sentContentProven({ messages: [wrapper({ blocks: [posted] }), wrapper({ blocks: [posted] })], row })).toBe(
      false,
    );
  });

  it("requires a no-fold message's top-level blocks", () => {
    const row = { ...ROW, draft: { ...ROW.draft, payload: NO_FOLD } };

    expect(sentContentProven({ messages: [{ blocks: [{ ...RICH, block_id: "b" }], text: "sounds good" }], row })).toBe(
      true,
    );
    expect(sentContentProven({ messages: [{ text: "sounds good" }], row })).toBe(false);
  });
});
