import type { KnownBlock } from "@slack/types";
import { describe, expect, it } from "vitest";

import {
  assertTypedRunsOnly,
  TypedRunsOnlyError,
  typedRunsOnlyViolations,
} from "../../../../outbound/slack/typedRunsOnly.js";

/** One `rich_text` block holding one section — the shape every composer here ultimately produces. */
function richText({ elements }: { elements: readonly unknown[] }): KnownBlock {
  // oxlint-disable-next-line no-unsafe-type-assertion
  return { elements: [{ elements, type: "rich_text_section" }], type: "rich_text" } as KnownBlock;
}

/** The message a refusal produced, or the empty string when the payload was allowed through. */
function refusalOf({ payload }: { payload: unknown }): string {
  try {
    assertTypedRunsOnly({ payload, surface: "chat.postMessage (card)" });
    return "";
  } catch (error) {
    return error instanceof TypedRunsOnlyError ? error.message : `unexpected: ${String(error)}`;
  }
}

describe("typedRunsOnlyViolations", () => {
  it("passes a payload whose link and mention are TYPED elements", () => {
    const payload = {
      attachments: [
        {
          blocks: [
            richText({
              elements: [
                { text: "shipped ", type: "text" },
                { text: "the PR", type: "link", url: "https://example.com/x" },
                { type: "user", user_id: "U08KJ" },
              ],
            }),
          ],
        },
      ],
    };

    expect(typedRunsOnlyViolations({ payload })).toEqual([]);
  });

  it("catches a bare URL a composer left in a text element (sighting 2's shape)", () => {
    const payload = { blocks: [richText({ elements: [{ text: "here it is https://example.com/x", type: "text" }] })] };

    expect(typedRunsOnlyViolations({ payload }).length).toBe(1);
    expect(typedRunsOnlyViolations({ payload })[0]!).toContain("https://example.com/x");
  });

  it("catches raw mention markup a composer left in a text element (sighting 1's shape)", () => {
    const payload = { blocks: [richText({ elements: [{ text: "<@U08KJ> shipped it", type: "text" }] })] };

    expect(typedRunsOnlyViolations({ payload })[0]!).toContain("<@U08KJ>");
  });

  it("reaches inside a table cell, which is a whole rich_text block of its own", () => {
    const payload = {
      blocks: [
        { rows: [[richText({ elements: [{ text: "see https://example.com/x", type: "text" }] })]], type: "table" },
      ],
    };

    expect(typedRunsOnlyViolations({ payload }).length).toBe(1);
  });

  it("leaves a CODE-styled element alone, matching what conversion already declined to touch", () => {
    const payload = {
      blocks: [richText({ elements: [{ style: { code: true }, text: "curl https://example.com/x", type: "text" }] })],
    };

    expect(typedRunsOnlyViolations({ payload })).toEqual([]);
  });

  it("leaves an mrkdwn element alone, because Slack PARSES mrkdwn and the link already works", () => {
    const payload = {
      blocks: [{ elements: [{ text: "<https://example.com/x|Configure>", type: "mrkdwn" }], type: "context" }],
    };

    expect(typedRunsOnlyViolations({ payload })).toEqual([]);
  });

  it("leaves a preformatted block alone — a code block is literal by request", () => {
    const payload = {
      blocks: [
        {
          elements: [
            { elements: [{ text: "curl https://example.com/x", type: "text" }], type: "rich_text_preformatted" },
          ],
          type: "rich_text",
        },
      ],
    };

    expect(typedRunsOnlyViolations({ payload })).toEqual([]);
  });

  it("ignores the plain-text fallback string, which is not a rich_text element at all", () => {
    expect(typedRunsOnlyViolations({ payload: { form: "plain", text: "read https://example.com/x" } })).toEqual([]);
  });

  it("reports EVERY violation, so one fix pass sees them all", () => {
    const payload = {
      blocks: [
        richText({ elements: [{ text: "https://example.com/1 and <@U08KJ>", type: "text" }] }),
        richText({ elements: [{ text: "also <#C0CHAN01>", type: "text" }] }),
      ],
    };

    expect(typedRunsOnlyViolations({ payload }).length).toBe(3);
  });
});

describe("assertTypedRunsOnly", () => {
  it("names the surface and the count, so a refusal points at the composer", () => {
    const message = refusalOf({
      payload: { blocks: [richText({ elements: [{ text: "here it is https://example.com/x", type: "text" }] })] },
    });

    expect(message).toContain("chat.postMessage (card): 1 outbound text run(s)");
  });

  it("says nothing at all about a payload whose runs are already typed", () => {
    expect(refusalOf({ payload: { blocks: [richText({ elements: [{ text: "all green", type: "text" }] })] } })).toBe(
      "",
    );
  });
});
