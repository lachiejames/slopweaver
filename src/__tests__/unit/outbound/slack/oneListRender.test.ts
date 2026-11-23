import { describe, expect, it } from "vitest";

import type { OneListArtifact } from "../../../../outbound/artifact/types.js";
import { renderDrip } from "../../../../outbound/slack/dripRender.js";
import type { ResolvedMentions } from "../../../../outbound/slack/render.js";
import type { SlackDripMessagePayload } from "../../../../outbound/slack/types.js";
import { isParagraphDense } from "../../../../outbound/voice/paragraphSpacing.js";

const MENTIONS: ResolvedMentions = {
  groups: new Map([["deploy-master", "S0A00000001"]]),
  people: new Map([["ada", "U0ADA"]]),
};

/** A one-list post from plain strings, so a test talks about shape rather than restating runs. */
function list({
  lead,
  bullets,
  trailing = [],
}: {
  lead: string;
  bullets: readonly string[];
  trailing?: readonly string[];
}): OneListArtifact {
  return {
    bullets: bullets.map((text) => [{ text, type: "text" as const }]),
    kind: "one-list",
    lead: [{ text: lead, type: "text" as const }],
    trailing: trailing.map((text) => [{ text, type: "text" as const }]),
  };
}

/**
 * The one rendered message's blocks, throwing rather than branching when the render was not `rich`.
 *
 * A throwing narrowing combinator for the same reason `unwrap` is one: a `payload.form === "rich" ? … : …`
 * in an assertion is a test that silently passes on the wrong form, which `.claude/rules/testing.md` bans.
 */
function richBlocks({ payloads }: { payloads: readonly SlackDripMessagePayload[] }) {
  const payload = payloads[0];
  if (payload?.form !== "rich") {
    throw new Error("expected exactly one rich payload");
  }
  return payload.blocks;
}

/** One text run inside one section of the single rendered block, throwing on any other shape. */
function sectionText({
  blocks,
  element,
  run,
}: {
  blocks: readonly { readonly elements: readonly unknown[] }[];
  element: number;
  run: number;
}): string {
  const section = blocks[0]?.elements?.[element];
  if (typeof section !== "object" || section === null || !("elements" in section)) {
    throw new Error("expected a rich_text_section at that position");
  }
  const found = (section.elements as readonly unknown[])[run];
  if (typeof found !== "object" || found === null || !("text" in found) || typeof found.text !== "string") {
    throw new Error("expected a text run at that position");
  }
  return found.text;
}

describe("renderDrip, one-list", () => {
  it("renders exactly ONE message, never a drip", () => {
    const payloads = renderDrip({
      artifact: list({ bullets: ["one", "two"], lead: "for review:" }),
      mentions: MENTIONS,
    });

    expect(payloads.length).toBe(1);
  });

  it("puts the whole post in ONE block, so the five-block fold cannot fire", () => {
    const payloads = renderDrip({
      artifact: list({ bullets: ["one"], lead: "for review:", trailing: ["3 left"] }),
      mentions: MENTIONS,
    });

    expect(richBlocks({ payloads }).length).toBe(1);
  });

  it("renders the dot points as Slack's own bullet list, single-spaced rather than as paragraphs", () => {
    const payloads = renderDrip({
      artifact: list({ bullets: ["one", "two", "three"], lead: "for review:" }),
      mentions: MENTIONS,
    });

    const element = richBlocks({ payloads })[0]?.elements[1];
    if (element?.type !== "rich_text_list") {
      throw new Error("expected a rich_text_list as the second element");
    }
    expect(element.style).toBe("bullet");
    expect(element.elements.length).toBe(3);
  });

  it("separates the lead from the list with the measured paragraph-to-bullets gap", () => {
    const payloads = renderDrip({ artifact: list({ bullets: ["one"], lead: "for review:" }), mentions: MENTIONS });

    expect(sectionText({ blocks: richBlocks({ payloads }), element: 0, run: 1 })).toBe("\n\n");
  });

  it("separates the list from the line after it with the measured single-newline gap", () => {
    const payloads = renderDrip({
      artifact: list({ bullets: ["one"], lead: "for review:", trailing: ["3 left"] }),
      mentions: MENTIONS,
    });

    expect(sectionText({ blocks: richBlocks({ payloads }), element: 2, run: 0 })).toBe("\n");
  });

  it("resolves a typed group mention in a trailing line, which a plain body could not verify", () => {
    const payloads = renderDrip({
      artifact: {
        bullets: [[{ text: "one", type: "text" }]],
        kind: "one-list",
        lead: [{ text: "for review:", type: "text" }],
        trailing: [[{ handle: "deploy-master", type: "group" }]],
      },
      mentions: MENTIONS,
    });

    expect(payloads[0]!.text).toContain("<!subteam^S0A00000001|@deploy-master>");
  });

  it("keeps a dot-point glyph in the notification fallback, which has no list element to draw one", () => {
    const payloads = renderDrip({
      artifact: list({ bullets: ["one", "two"], lead: "for review:" }),
      mentions: MENTIONS,
    });

    expect(payloads[0]!.text).toBe("for review:\n\n• one\n• two");
  });

  it("renders sub-points as Slack's own nested list: sibling lists, the sub-point run one indent in", () => {
    const payloads = renderDrip({
      artifact: { ...list({ bullets: ["a", "a1", "a2", "b"], lead: "for review:" }), depths: [0, 1, 1, 0] },
      mentions: MENTIONS,
    });

    const lists = richBlocks({ payloads })[0].elements.slice(1);
    expect(lists.map((element) => element.type)).toEqual(["rich_text_list", "rich_text_list", "rich_text_list"]);
    expect(lists.map((element) => (element as { readonly indent?: number }).indent)).toEqual([undefined, 1, undefined]);
    expect(lists.map((element) => element.elements.length)).toEqual([1, 2, 1]);
  });

  it("indents a sub-point under its headline in the notification fallback", () => {
    const payloads = renderDrip({
      artifact: { ...list({ bullets: ["a", "a1", "b"], lead: "for review:" }), depths: [0, 1, 0] },
      mentions: MENTIONS,
    });

    expect(payloads[0]!.text).toBe("for review:\n\n• a\n    ◦ a1\n• b");
  });

  it("does not read as a dense wall, so the operator's paragraph-spacing rule passes it", () => {
    const payloads = renderDrip({
      artifact: list({ bullets: ["one", "two"], lead: "for review:", trailing: ["3 left"] }),
      mentions: MENTIONS,
    });

    expect(isParagraphDense({ text: payloads[0]!.text })).toBe(false);
  });
});
