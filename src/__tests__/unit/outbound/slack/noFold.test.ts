import { describe, expect, it } from "vitest";

import { noFoldArtifactSchema } from "../../../../outbound/artifact/noFoldSchema.js";
import type { NoFoldArtifact } from "../../../../outbound/artifact/types.js";
import { noFoldFallback, noFoldPayloadIssues, renderNoFoldMessage } from "../../../../outbound/slack/noFold.js";
import { NO_MENTIONS, type ResolvedMentions } from "../../../../outbound/slack/render.js";
import type { SlackNoFoldPayload } from "../../../../outbound/slack/types.js";

const MENTIONS: ResolvedMentions = { groups: new Map(), people: new Map([["ada", "U1"]]) };

function artifact(over: Record<string, unknown> = {}): NoFoldArtifact {
  const parsed = noFoldArtifactSchema.safeParse({
    bullets: [[{ text: "Code of Conduct", type: "text" }], [{ text: "Acceptable Use", type: "text" }]],
    kind: "no-fold",
    lead: [
      { person: "ada", type: "mention" },
      { text: " ", type: "text" },
      { label: "Open your Vanta security tasks", type: "link", url: "https://vanta.invalid/onboarding" },
      { text: " and press accept.", type: "text" },
    ],
    trailing: [[{ text: "Tracked per person for ISO 27001.", type: "text" }]],
    ...over,
  });
  return parsed.data as NoFoldArtifact;
}

function payload({ from }: { from: NoFoldArtifact }): SlackNoFoldPayload {
  return renderNoFoldMessage({
    artifact: from,
    artifactFingerprint: "fp-1",
    mentions: MENTIONS,
    metadataEventType: "test_card_v1",
  });
}

describe("renderNoFoldMessage", () => {
  it("emits ONE top-level block and no attachment wrapper at all", () => {
    const rendered = payload({ from: artifact() });

    expect(rendered.blocks.length).toBe(1);
    expect(rendered.blocks[0].type).toBe("rich_text");
    expect(Object.keys(rendered).includes("attachments")).toBe(false);
  });

  it("puts the lead, the bullet list and the trailing line in that one block, in order", () => {
    const elements = payload({ from: artifact() }).blocks[0].elements;

    expect(elements.map((element) => element.type)).toEqual([
      "rich_text_section",
      "rich_text_list",
      "rich_text_section",
    ]);
  });

  it("renders the mention as a typed user element, never as text", () => {
    const section = payload({ from: artifact() }).blocks[0].elements[0]!;

    expect(section.type).toBe("rich_text_section");
    expect(section.type === "rich_text_section" ? section.elements[0] : null).toEqual({ type: "user", user_id: "U1" });
  });

  it("renders the action as a real link element beside the mention", () => {
    const section = payload({ from: artifact() }).blocks[0].elements[0]!;
    const link = section.type === "rich_text_section" ? section.elements[2] : null;

    expect(link).toEqual({
      text: "Open your Vanta security tasks",
      type: "link",
      url: "https://vanta.invalid/onboarding",
    });
  });

  it("renders a bold link as one link element carrying Slack's bold style", () => {
    const bolded = artifact({
      bullets: [
        [
          { bold: true, label: "Staff", type: "link", url: "https://vanta.invalid/people" },
          { text: ": 2 of 2 people", type: "text" },
        ],
      ],
    });
    const list = payload({ from: bolded }).blocks[0].elements[1]!;

    expect(list).toEqual({
      elements: [
        {
          elements: [
            { style: { bold: true }, text: "Staff", type: "link", url: "https://vanta.invalid/people" },
            { text: ": 2 of 2 people", type: "text" },
          ],
          type: "rich_text_section",
        },
      ],
      style: "bullet",
      type: "rich_text_list",
    });
  });

  it("renders the dot points as Slack's own bulleted list", () => {
    const list = payload({ from: artifact() }).blocks[0].elements[1]!;

    expect(list.type).toBe("rich_text_list");
    expect(list.type === "rich_text_list" ? list.style : null).toBe("bullet");
    expect(list.type === "rich_text_list" ? list.elements.length : 0).toBe(2);
  });

  it("stamps the no-fold renderer and kind into metadata", () => {
    const rendered = payload({ from: artifact() });

    expect(rendered.metadata.event_payload.renderer).toBe("slack-no-fold-v1");
    expect(rendered.metadata.event_payload.artifactKind).toBe("no-fold");
    expect(rendered.metadata.event_type).toBe("test_card_v1");
  });

  it("disables both unfurls, so a link cannot grow a preview card under the message", () => {
    const rendered = payload({ from: artifact() });

    expect(rendered.unfurl_links).toBe(false);
    expect(rendered.unfurl_media).toBe(false);
  });

  it("still emits ONE block for a lead-only message", () => {
    const lone = noFoldArtifactSchema.safeParse({ kind: "no-fold", lead: [{ text: "Just this.", type: "text" }] })
      .data as NoFoldArtifact;
    const rendered = renderNoFoldMessage({
      artifact: lone,
      artifactFingerprint: "fp-2",
      mentions: NO_MENTIONS,
      metadataEventType: "test_card_v1",
    });

    expect(rendered.blocks.length).toBe(1);
    expect(rendered.blocks[0].elements.length).toBe(1);
  });
});

describe("renderNoFoldMessage — the PII pass a card crosses", () => {
  const EMAIL = "jane.doe@example.com";
  const IP = "203.0.113.7";
  const carrying = artifact({
    bullets: [[{ text: `from ${IP}`, type: "text" }]],
    lead: [{ text: `The failing login was ${EMAIL} from ${IP}.`, type: "text" }],
    trailing: [[{ text: `Reported by ${EMAIL}.`, type: "text" }]],
  });

  it("is fed an artifact that really carries the email and the IP", () => {
    const input = JSON.stringify(carrying);

    expect(input).toContain(EMAIL);
    expect(input).toContain(IP);
  });

  it("posts neither, in the block or the notification text", () => {
    const wire = JSON.stringify(payload({ from: carrying }));

    expect(wire).not.toContain(EMAIL);
    expect(wire).not.toContain(IP);
  });

  it("puts the placeholders where they were, the notification text included", () => {
    const rendered = payload({ from: carrying });

    expect(rendered.text).toBe("The failing login was [email] from [ip].");
    expect(rendered.blocks[0].elements[0]).toEqual({
      elements: [
        { text: "The failing login was [email] from [ip].", type: "text" },
        { text: "\n\n", type: "text" },
      ],
      type: "rich_text_section",
    });
  });

  it("keeps the payload a no-fold message", () => {
    expect(noFoldPayloadIssues({ payload: payload({ from: carrying }) })).toEqual([]);
  });
});

describe("noFoldFallback", () => {
  it("carries the LEAD's visible text, so the notification is not a second copy of the message", () => {
    expect(noFoldFallback({ artifact: artifact() })).toBe("Open your Vanta security tasks and press accept.");
  });
});

describe("noFoldPayloadIssues — prove the check can fire before quoting it", () => {
  it("finds nothing in a payload the renderer built", () => {
    expect(noFoldPayloadIssues({ payload: payload({ from: artifact() }) })).toEqual([]);
  });

  it("FIRES on an attachments key smuggled onto the payload", () => {
    const smuggled = { ...payload({ from: artifact() }), attachments: [{ blocks: [], color: "#fff", fallback: "x" }] };
    const issues = noFoldPayloadIssues({ payload: smuggled });

    expect(issues.length).toBe(1);
    expect(issues[0]!).toContain("`attachments` wrapper");
  });

  it("FIRES on a second block", () => {
    const rendered = payload({ from: artifact() });
    const widened = { ...rendered, blocks: [rendered.blocks[0], rendered.blocks[0]] };
    const issues = noFoldPayloadIssues({ payload: widened as unknown as SlackNoFoldPayload });

    expect(issues.length).toBe(1);
    expect(issues[0]!).toContain("carries 2 blocks");
  });

  it("FIRES on a block that is not rich_text", () => {
    const rendered = payload({ from: artifact() });
    const wrong = { ...rendered, blocks: [{ type: "divider" }] };
    const issues = noFoldPayloadIssues({ payload: wrong as unknown as SlackNoFoldPayload });

    expect(issues.length).toBe(1);
    expect(issues[0]!).toContain("is a `divider`");
  });
});
