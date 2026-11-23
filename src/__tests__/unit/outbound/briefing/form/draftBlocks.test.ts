/** A draft block inside a fold, held to its surface's own cap. */
import { describe, expect, it } from "vitest";

import type { BriefingBlock } from "../../../../../outbound/briefing/types.js";
import { SLACK_MESSAGE_TEXT_MAX } from "../../../../../outbound/slack/dripRender.js";
import { text, withCard } from "./fixtures.js";
import { refusals } from "./harness.js";

describe("the briefing form's draft blocks", () => {
  /** The form with the card's `detail` replaced by a fold carrying exactly these blocks. */
  function withDetailBlocks({ blocks }: { blocks: readonly BriefingBlock[] }): unknown {
    return withCard({ over: { detail: { blocks, summary: "the draft" } } });
  }

  it("admits a well-shaped slack-as-me draft sitting after a paragraph in the same fold", () => {
    const blocks: readonly BriefingBlock[] = [
      { content: text({ value: "The draft, as it would post." }), kind: "para" },
      { kind: "draft", surface: "slack-as-me", text: "Shipping the render verb tonight." },
    ];

    expect(refusals({ form: withDetailBlocks({ blocks }) })).toEqual([]);
  });

  it("refuses a draft over its surface's own cap", () => {
    const blocks: readonly BriefingBlock[] = [
      { kind: "draft", surface: "slack-as-me", text: "a".repeat(SLACK_MESSAGE_TEXT_MAX + 1) },
    ];

    expect(refusals({ form: withDetailBlocks({ blocks }) })).toEqual([
      `reactNow.teamFacing.0.detail.blocks.0.text: Too big: expected string to have <=${String(SLACK_MESSAGE_TEXT_MAX)} characters`,
    ]);
  });

  it("refuses a surface this form does not yet know", () => {
    const blocks = [{ kind: "draft", surface: "notion-body", text: "a body" }] as unknown as readonly BriefingBlock[];

    expect(refusals({ form: withDetailBlocks({ blocks }) }).length).toBeGreaterThan(0);
  });
});
