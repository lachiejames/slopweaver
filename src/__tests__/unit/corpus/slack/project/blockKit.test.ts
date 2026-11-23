/*
 * Block Kit prose recovered from a message's raw payload: it lands after the reaction and attachment summaries,
 * stands in for the empty-message placeholder, and never adds refs. It moved here when `project.test.ts` was split by
 * behaviour.
 */
import { describe, expect, it } from "vitest";
import { projectSlackRecords, type SlackChannelItems } from "../../../../../corpus/slack/project.js";
import { maps } from "./harness.js";

describe("recovered Block Kit prose in the projected text", () => {
  const withBlocks: SlackChannelItems = {
    channelId: "C_PUBLIC_ALPHA",
    channelName: "alpha",
    messages: [
      {
        channelId: "C_PUBLIC_ALPHA",
        channelName: "alpha",
        files: [{ id: "F9", name: "notes.pdf" }],
        permalink: "https://example.invalid/archives/C_PUBLIC_ALPHA/p1700000000000900",
        raw: {
          blocks: [{ text: { text: "the card body a person reads", type: "mrkdwn" }, type: "section" }],
        },
        reactions: [":tada: x2"],
        text: "shipping it",
        ts: "1700000000.000900",
        tsIso: "2026-07-02T00:00:00.000Z",
      },
    ],
    replies: [],
  };

  it("appends recovered prose AFTER the reaction and attachment summaries", () => {
    const record = projectSlackRecords({ channels: [withBlocks], maps }).find((r) => r.kind === "message")!;
    expect(record.text).toBe(
      ["shipping it", "Reactions: :tada: x2", "Attachments: notes.pdf", "the card body a person reads"].join("\n\n"),
    );
  });

  // `text` is OMITTED rather than set to `undefined`: `exactOptionalPropertyTypes` rejects the explicit
  // undefined, and an app message with no top-level text is exactly the case this recovery exists for.
  const { text: _omitted, ...textless } = withBlocks.messages[0]!;

  it("replaces the empty-message placeholder with the recovered prose", () => {
    const noText: SlackChannelItems = {
      ...withBlocks,
      messages: [{ ...textless, files: [], reactions: [] }],
    };
    const record = projectSlackRecords({ channels: [noText], maps }).find((r) => r.kind === "message")!;
    expect(record.text).toBe("the card body a person reads");
  });

  it("still uses the placeholder when there is genuinely nothing to recover", () => {
    const empty: SlackChannelItems = {
      ...withBlocks,
      messages: [{ ...textless, files: [], raw: { blocks: [] }, reactions: [] }],
    };
    const record = projectSlackRecords({ channels: [empty], maps }).find((r) => r.kind === "message")!;
    expect(record.text).toBe("(empty message in #alpha)");
  });

  it("leaves refs scoped to the top-level text, not the recovered card content", () => {
    const withRef: SlackChannelItems = {
      ...withBlocks,
      messages: [
        {
          ...withBlocks.messages[0]!,
          raw: { blocks: [{ text: { text: "see PR #999 in the card", type: "mrkdwn" }, type: "section" }] },
          text: "shipping #123",
        },
      ],
    };
    const record = projectSlackRecords({ channels: [withRef], maps }).find((r) => r.kind === "message")!;
    expect(record.refs).toStrictEqual(["#123"]);
  });
});
