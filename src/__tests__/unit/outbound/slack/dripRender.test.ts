import { describe, expect, it } from "vitest";

import type { DripArtifact, OneCardArtifact, PlainArtifact } from "../../../../outbound/artifact/types.js";
import { renderDrip } from "../../../../outbound/slack/dripRender.js";
import type { ResolvedMentions } from "../../../../outbound/slack/render.js";
import { isParagraphDense } from "../../../../outbound/voice/paragraphSpacing.js";

const NO_MENTIONS: ResolvedMentions = { groups: new Map(), people: new Map() };
const MENTIONS: ResolvedMentions = { groups: new Map(), people: new Map([["ada", "U0ADA"]]) };

/** A drip of `n` one-run messages, so a test can talk about ordering without restating the shape. */
function drip({ texts }: { texts: readonly string[] }): DripArtifact {
  return { kind: "drip", messages: texts.map((text) => ({ runs: [{ text, type: "text" as const }] })) };
}

/** A one-card post of `n` one-run lines, the same way. */
function card({ texts }: { texts: readonly string[] }): OneCardArtifact {
  return { kind: "one-card", lines: texts.map((text) => ({ runs: [{ text, type: "text" as const }] })) };
}

describe("renderDrip", () => {
  it("renders one payload per message, in artifact order, with the exact text", () => {
    const payloads = renderDrip({ artifact: drip({ texts: ["First.", "Second.", "Third."] }), mentions: NO_MENTIONS });

    expect(payloads.length).toBe(3);
    expect(payloads).toEqual([
      {
        blocks: [
          {
            elements: [{ elements: [{ text: "First.", type: "text" }], type: "rich_text_section" }],
            type: "rich_text",
          },
        ],
        form: "rich",
        text: "First.",
        unfurl_links: true,
        unfurl_media: true,
      },
      {
        blocks: [
          {
            elements: [{ elements: [{ text: "Second.", type: "text" }], type: "rich_text_section" }],
            type: "rich_text",
          },
        ],
        form: "rich",
        text: "Second.",
        unfurl_links: true,
        unfurl_media: true,
      },
      {
        blocks: [
          {
            elements: [{ elements: [{ text: "Third.", type: "text" }], type: "rich_text_section" }],
            type: "rich_text",
          },
        ],
        form: "rich",
        text: "Third.",
        unfurl_links: true,
        unfurl_media: true,
      },
    ]);
  });

  it("emits NO card chrome — no attachment, no wrapper, exactly one block per message", () => {
    const payloads = renderDrip({ artifact: drip({ texts: ["a", "b"] }), mentions: NO_MENTIONS });

    // The type has no `attachments` key at all; this asserts the VALUE agrees, so a future widening of
    // the type cannot quietly start emitting a card over a human's name.
    expect(payloads.map((payload) => Object.keys(payload).toSorted())).toEqual([
      ["blocks", "form", "text", "unfurl_links", "unfurl_media"],
      ["blocks", "form", "text", "unfurl_links", "unfurl_media"],
    ]);
    expect(payloads.every((payload) => payload.form === "rich" && payload.blocks.length === 1)).toBe(true);
  });

  it("resolves a mention structurally, and mirrors it into the notification fallback", () => {
    const artifact: DripArtifact = {
      kind: "drip",
      messages: [
        {
          runs: [
            { text: "nice one ", type: "text" },
            { person: "ada", type: "mention" },
          ],
        },
      ],
    };

    const payloads = renderDrip({ artifact, mentions: MENTIONS });

    expect(payloads[0]).toEqual({
      blocks: [
        {
          elements: [
            {
              elements: [
                { text: "nice one ", type: "text" },
                { type: "user", user_id: "U0ADA" },
              ],
              type: "rich_text_section",
            },
          ],
          type: "rich_text",
        },
      ],
      form: "rich",
      text: "nice one <@U0ADA>",
      unfurl_links: true,
      unfurl_media: true,
    });
  });

  it("keeps a link's URL out of the visible run and puts both into the fallback", () => {
    const artifact: DripArtifact = {
      kind: "drip",
      messages: [{ runs: [{ label: "the PR", type: "link", url: "https://example.com/pr/1" }] }],
    };

    const payloads = renderDrip({ artifact, mentions: NO_MENTIONS });

    expect(payloads[0]!.text).toBe("<https://example.com/pr/1|the PR>");
  });

  it("preserves an EM-DASH untouched — this lane bans no character", () => {
    const payloads = renderDrip({ artifact: drip({ texts: ["shipped — finally"] }), mentions: NO_MENTIONS });

    expect(payloads[0]!.text).toBe("shipped — finally");
  });

  it("escapes mrkdwn control characters in the FALLBACK only, never in the rendered run", () => {
    const payloads = renderDrip({ artifact: drip({ texts: ["a < b & c > d"] }), mentions: NO_MENTIONS });
    const payload = payloads[0]!;

    expect(payload.text).toBe("a &lt; b &amp; c &gt; d");
    expect(payload.form === "rich" ? payload.blocks[0].elements[0] : undefined).toEqual({
      elements: [{ text: "a < b & c > d", type: "text" }],
      type: "rich_text_section",
    });
  });

  it("carries a bold flag structurally rather than as asterisks", () => {
    const artifact: DripArtifact = {
      kind: "drip",
      messages: [{ runs: [{ bold: true, text: "shipped", type: "text" }] }],
    };

    const payloads = renderDrip({ artifact, mentions: NO_MENTIONS });
    const payload = payloads[0]!;

    expect(payload.form === "rich" ? payload.blocks[0].elements[0] : undefined).toEqual({
      elements: [{ style: { bold: true }, text: "shipped", type: "text" }],
      type: "rich_text_section",
    });
  });

  it("is deterministic — the same artifact renders byte-identically, which the resume depends on", () => {
    const artifact = drip({ texts: ["one", "two"] });

    expect(JSON.stringify(renderDrip({ artifact, mentions: NO_MENTIONS }))).toBe(
      JSON.stringify(renderDrip({ artifact, mentions: NO_MENTIONS })),
    );
  });
});

describe("renderDrip — the plain-body escape hatch", () => {
  it("produces EXACTLY one message whose text is the input byte-for-byte", () => {
    const artifact: PlainArtifact = { kind: "plain", text: "hey — *this* stays exactly as I typed it\nline two" };

    const payloads = renderDrip({ artifact, mentions: NO_MENTIONS });

    expect(payloads).toEqual([
      {
        form: "plain",
        text: "hey — *this* stays exactly as I typed it\nline two",
        unfurl_links: true,
        unfurl_media: true,
      },
    ]);
  });

  it("sends no blocks at all, so Slack parses the bytes exactly as it parses a typed message", () => {
    const payloads = renderDrip({ artifact: { kind: "plain", text: "<@U0ADA> ping" }, mentions: NO_MENTIONS });

    expect(Object.keys(payloads[0]!).toSorted()).toEqual(["form", "text", "unfurl_links", "unfurl_media"]);
    expect(payloads[0]!.text).toBe("<@U0ADA> ping");
  });
});

describe("renderDrip — the one-card post", () => {
  it("renders ONE payload however many lines it carries, because the card is one message", () => {
    const payloads = renderDrip({ artifact: card({ texts: ["a", "b", "c"] }), mentions: NO_MENTIONS });

    expect(payloads.length).toBe(1);
  });

  it("stays ONE `rich_text` block, so the five-block fold cannot fire on it", () => {
    const payload = renderDrip({ artifact: card({ texts: ["a", "b", "c"] }), mentions: NO_MENTIONS })[0]!;

    expect(payload.form).toBe("rich");
    expect(payload.form === "rich" ? payload.blocks.length : 0).toBe(1);
  });

  it("puts a BLANK-LINE break between lines and never after the last one", () => {
    const payload = renderDrip({ artifact: card({ texts: ["first", "last"] }), mentions: NO_MENTIONS })[0]!;

    expect(payload).toEqual({
      blocks: [
        {
          elements: [
            {
              elements: [
                { text: "first", type: "text" },
                { text: "\n\n", type: "text" },
              ],
              type: "rich_text_section",
            },
            { elements: [{ text: "last", type: "text" }], type: "rich_text_section" },
          ],
          type: "rich_text",
        },
      ],
      form: "rich",
      text: "first\n\nlast",
      unfurl_links: true,
      unfurl_media: true,
    });
  });

  it("keeps the breaks in the NOTIFICATION fallback, so a phone sees the shape the card has", () => {
    const payload = renderDrip({ artifact: card({ texts: ["one", "two", "three"] }), mentions: NO_MENTIONS })[0]!;

    expect(payload.text).toBe("one\n\ntwo\n\nthree");
  });

  it("renders a card the paragraph-spacing gate passes, which is the whole point of the blank line", () => {
    const payload = renderDrip({ artifact: card({ texts: ["one", "two", "three"] }), mentions: NO_MENTIONS })[0]!;

    expect(isParagraphDense({ text: payload.text })).toBe(false);
  });

  it("resolves a typed mention run to `<@U…>` in both the block and the fallback", () => {
    const artifact: OneCardArtifact = {
      kind: "one-card",
      lines: [
        {
          runs: [
            { person: "ada", type: "mention" },
            { text: " pls review", type: "text" },
          ],
        },
      ],
    };

    const payload = renderDrip({ artifact, mentions: MENTIONS })[0]!;

    expect(payload.text).toBe("<@U0ADA> pls review");
  });

  it("renders a single-line card with no break at all", () => {
    const payload = renderDrip({ artifact: card({ texts: ["just this"] }), mentions: NO_MENTIONS })[0]!;

    expect(payload.text).toBe("just this");
    expect(payload.form === "rich" ? payload.blocks[0].elements.length : 0).toBe(1);
  });
});
