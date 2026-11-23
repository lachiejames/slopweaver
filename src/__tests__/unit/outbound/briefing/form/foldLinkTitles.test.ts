/** A link inside a fold carries its title beside its bare key. */
import { describe, expect, it } from "vitest";

import type { BriefingBlock, BriefingContent } from "../../../../../outbound/briefing/types.js";
import { withCard } from "./fixtures.js";
import { refusals } from "./harness.js";

describe("the briefing form's fold link titles", () => {
  /** The form with the card's `detail` replaced by a fold carrying exactly these blocks. */
  function withDetailBlocks({ blocks }: { blocks: readonly BriefingBlock[] }): unknown {
    return withCard({ over: { detail: { blocks, summary: "the evidence" } } });
  }

  it("refuses a fold link naming only its bare key", () => {
    const content: BriefingContent = [
      { kind: "text", text: "See " },
      { kind: "link", text: "#100", url: "https://example.com/pull/100" },
      { kind: "text", text: " for the reader." },
    ];
    const blocks: readonly BriefingBlock[] = [{ content, kind: "para" }];

    expect(refusals({ form: withDetailBlocks({ blocks }) })).toEqual([
      "reactNow.teamFacing.0.detail.blocks.0.content: a link inside the fold carries only its bare key as the label — a reader " +
        "has to open it to know what it names. Put the title beside the key in the link text.",
    ]);
  });

  it("admits a fold link whose text carries the title beside the key", () => {
    const content: BriefingContent = [
      { kind: "link", text: "#100 the render verb", url: "https://example.com/pull/100" },
    ];
    const blocks: readonly BriefingBlock[] = [{ content, kind: "para" }];

    expect(refusals({ form: withDetailBlocks({ blocks }) })).toEqual([]);
  });

  it("leaves a bare-key link outside a fold alone — a card's short cells are not where a citation lives", () => {
    const what: BriefingContent = [
      { kind: "text", text: "The draft is here. " },
      { kind: "link", text: "#100", url: "https://example.com/pull/100" },
      { kind: "text", text: " and it is green." },
    ];

    expect(refusals({ form: withCard({ over: { what } }) })).toEqual([]);
  });
});
