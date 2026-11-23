import { describe, expect, it } from "vitest";

import type { UpdateArtifact } from "../../../../outbound/artifact/types.js";
import {
  FOLD_UNKNOWN_NOTICE,
  PREVIEW_LEGEND,
  previewBlockLines,
  previewLines,
} from "../../../../outbound/slack/preview.js";
import { renderUpdateCard } from "../../../../outbound/slack/render.js";
import type { SlackCardChrome } from "../../../../outbound/slack/types.js";

const CHROME: SlackCardChrome = {
  authorEmoji: ":robot_face:",
  authorLabel: "test-bot",
  bannerColor: "#12B5A6",
  detailLabel: "*Details*",
  metadataEventType: "test_card_v1",
};

/** Preview the payload the real renderer produces — so what is previewed is what goes on the wire. */
function preview({ artifact }: { artifact: UpdateArtifact }): readonly string[] {
  return previewLines({
    payload: renderUpdateCard({
      artifact,
      artifactFingerprint: "fp",
      chrome: CHROME,
      mentions: {
        groups: new Map([["engineers", "S_fake_engineers"]]),
        people: new Map([["ada-l", "U_fake_ada"]]),
      },
    }),
  });
}

function cardFor({ detail }: { detail: UpdateArtifact["detail"] }): UpdateArtifact {
  return { citations: [], detail, index: [], kind: "update", media: [], tldr: "The lead line." };
}

describe("previewLines", () => {
  it("renders the whole six-block card, marking where the chrome ends and the detail begins", () => {
    const lines = preview({
      artifact: cardFor({ detail: [{ runs: [{ text: "The detail.", type: "text" }], type: "paragraph" }] }),
    });

    expect(lines).toEqual([
      PREVIEW_LEGEND,
      FOLD_UNKNOWN_NOTICE,
      ":robot_face:  *test-bot*",
      "────────────────────",
      "The lead line.",
      "────────────────────",
      "*Details*",
      "──── detail ──── (blocks 5+ are behind the Details label)",
      "The detail.",
    ]);
  });

  it("shows emphasis as [b]/[i]/[c] markers, never as asterisks that could BE the mistake", () => {
    const lines = preview({
      artifact: cardFor({
        detail: [
          {
            runs: [
              { bold: true, text: "Lead-in: ", type: "text" },
              { italic: true, text: "leaning", type: "text" },
              { code: true, text: "yarn validate", type: "text" },
            ],
            type: "paragraph",
          },
        ],
      }),
    });

    expect(lines.at(-1)).toBe("[b]Lead-in: [/b][i]leaning[/i][c]yarn validate[/c]");
  });

  it("leaves a LITERAL asterisk literal, so the markdown-lookalike mistake stays visible", () => {
    const lines = preview({
      artifact: cardFor({ detail: [{ runs: [{ text: "*not bold*", type: "text" }], type: "paragraph" }] }),
    });

    expect(lines.at(-1)).toBe("*not bold*");
  });

  it("shows a mention as the Slack id that will actually be pinged", () => {
    const lines = preview({
      artifact: cardFor({ detail: [{ runs: [{ person: "ada-l", type: "mention" }], type: "paragraph" }] }),
    });

    expect(lines.at(-1)).toBe("<@U_fake_ada>");
  });

  it("shows a user group by its SUBTEAM ID, so a reviewer can tell which team is about to be pinged", () => {
    const lines = preview({
      artifact: cardFor({ detail: [{ runs: [{ handle: "engineers", type: "group" }], type: "paragraph" }] }),
    });

    expect(lines.at(-1)).toBe("<!subteam^S_fake_engineers>");
  });

  it("shows a broadcast in Slack's own syntax", () => {
    const lines = preview({
      artifact: cardFor({ detail: [{ runs: [{ range: "here", type: "broadcast" }], type: "paragraph" }] }),
    });

    expect(lines.at(-1)).toBe("<!here>");
  });

  it("shows a link's label AND its url, so a wrong url is visible before it is sent", () => {
    const lines = preview({
      artifact: cardFor({
        detail: [{ runs: [{ label: "the RFC", type: "link", url: "https://example.test/rfc" }], type: "paragraph" }],
      }),
    });

    expect(lines.at(-1)).toBe("[the RFC](https://example.test/rfc)");
  });

  it("turns the MEASURED embedded paragraph gap into a real blank line", () => {
    const lines = preview({
      artifact: cardFor({
        detail: [
          { runs: [{ text: "First.", type: "text" }], type: "paragraph" },
          { runs: [{ text: "Second.", type: "text" }], type: "paragraph" },
        ],
      }),
    });

    // The renderer emits "First." then a standalone "\n\n" element then "Second." in ONE section, which is
    // where the gap actually comes from. The preview must show that as a blank line, not swallow it — and
    // exactly ONE, which is what `sectionLines` absorbing a section's own trailing boundary leaves behind.
    expect(lines.slice(-3)).toEqual(["First.", "", "Second."]);
  });

  it("labels a link sent without text by its URL, which is what Slack draws for one", () => {
    const lines = previewBlockLines({
      block: {
        elements: [
          {
            elements: [
              { text: "the RFC", type: "link", url: "https://example.test/rfc" },
              { text: " and ", type: "text" },
              { type: "link", url: "https://example.test/bare" },
            ],
            type: "rich_text_section",
          },
        ],
        type: "rich_text",
      },
    });

    expect(lines).toEqual([
      "[the RFC](https://example.test/rfc) and [https://example.test/bare](https://example.test/bare)",
    ]);
  });

  it("shows a one-card line break as ONE line break, never a blank line Slack will not draw", () => {
    const lines = previewBlockLines({
      block: {
        elements: [
          {
            elements: [
              { text: "First.", type: "text" },
              { text: "\n", type: "text" },
            ],
            type: "rich_text_section",
          },
          { elements: [{ text: "Second.", type: "text" }], type: "rich_text_section" },
        ],
        type: "rich_text",
      },
    });

    expect(lines).toEqual(["First.", "Second."]);
  });

  it("draws a nested list's sub-points indented under their headline with Slack's second glyph", () => {
    const item = ({ text }: { text: string }) => ({
      elements: [{ text, type: "text" as const }],
      type: "rich_text_section" as const,
    });
    const lines = previewBlockLines({
      block: {
        elements: [
          { elements: [item({ text: "headline" })], style: "bullet", type: "rich_text_list" },
          {
            elements: [item({ text: "child one" }), item({ text: "child two" })],
            indent: 1,
            style: "bullet",
            type: "rich_text_list",
          },
          { elements: [item({ text: "next" })], style: "bullet", type: "rich_text_list" },
        ],
        type: "rich_text",
      },
    });

    expect(lines).toEqual(["• headline", "  ◦ child one", "  ◦ child two", "• next"]);
  });

  it("renders bullets with a bullet glyph", () => {
    const lines = preview({
      artifact: cardFor({
        detail: [{ items: [[{ text: "one", type: "text" }], [{ text: "two", type: "text" }]], type: "bullets" }],
      }),
    });

    expect(lines.slice(-2)).toEqual(["• one", "• two"]);
  });

  it("renders a table as pipe-delimited rows, header first", () => {
    const lines = preview({
      artifact: cardFor({
        detail: [
          {
            columns: ["Probe", "Folds"],
            rows: [
              [[{ text: "A3", type: "text" }], [{ text: "no", type: "text" }]],
              [[{ text: "A4", type: "text" }], [{ text: "yes", type: "text" }]],
            ],
            type: "table",
          },
        ],
      }),
    });

    expect(lines.slice(-3)).toEqual(["| Probe | Folds |", "| A3 | no |", "| A4 | yes |"]);
  });

  it("renders the primary link at the head of the lead block, with the unicode glyph", () => {
    const lines = previewLines({
      payload: renderUpdateCard({
        artifact: {
          citations: [],
          detail: [{ runs: [{ text: "d", type: "text" }], type: "paragraph" }],
          index: [],
          kind: "update",
          media: [],
          primaryLink: { label: "Draft PR", url: "https://example.test/pr/1" },
          tldr: "The lead line.",
        },
        artifactFingerprint: "fp",
        chrome: CHROME,
        mentions: { groups: new Map(), people: new Map() },
      }),
    });

    expect(lines[4]).toBe("🔗 [Draft PR](https://example.test/pr/1)");
    expect(lines[5]).toBe("");
    expect(lines[6]).toBe("The lead line.");
  });

  it("says the fold is NOT decidable here, on a card of any size, and names what can decide it", () => {
    const lines = previewLines({
      payload: {
        attachments: [{ blocks: [{ type: "divider" }], color: "#12B5A6", fallback: "f" }],
        metadata: {
          event_payload: {
            artifactFingerprint: "fp",
            artifactKind: "update",
            renderer: "slack-card-v1",
            schemaVersion: 1,
          },
          event_type: "t",
        },
        text: "",
        unfurl_links: false,
        unfurl_media: false,
      },
    });

    // RETRACTED: this used to assert `!! 1 blocks — this card WILL NOT FOLD (more than 5 is required)`,
    // which is the block-count rule a three-block attachment refuted. The preview now
    // refuses to predict the fold at all, on every card, and says where an answer actually comes from.
    expect(lines[1]).toBe(FOLD_UNKNOWN_NOTICE);
    expect(lines.join("\n")).toContain("slopweaver slack shot");
  });
});
