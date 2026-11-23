/**
 * The two shapes that reached a reader wrong in the engineering channel, fed back in as the REAL text and
 * asserted as the rendered form Slack is handed.
 *
 * - A `<url|label>` link to a real pull request: C0SYN000002/1790243252.027999 posted as a
 *   link to `…/pull/N%7Cadd` with literal angle brackets around it.
 * - A `> ` quote line: C0SYN000002/1790224958.879279 posted a literal greater-than sign.
 */
import type { RichTextBlock } from "@slack/types";
import { describe, expect, it } from "vitest";

import { dripArtifactSchema } from "../../../../outbound/artifact/asMeSchema.js";
import { linkifyDripArtifact } from "../../../../outbound/artifact/bareRefRuns.js";
import { noFoldArtifactSchema } from "../../../../outbound/artifact/noFoldSchema.js";
import type { AsMeArtifact, NoFoldArtifact } from "../../../../outbound/artifact/types.js";
import type { BareRefContext } from "../../../../outbound/linkify/bareRefs.js";
import { renderDrip } from "../../../../outbound/slack/dripRender.js";
import { renderNoFoldMessage } from "../../../../outbound/slack/noFold.js";
import { noFoldPreviewLines } from "../../../../outbound/slack/preview.js";
import type { ResolvedMentions } from "../../../../outbound/slack/render.js";
import { payloadRenderIssues, storedRenderIssues } from "../../../../outbound/slack/renderCheck.js";
import type { SlackDripMessagePayload } from "../../../../outbound/slack/types.js";

const ACME_ADMIN: BareRefContext = { repos: [{ owner: "acme", repo: "acme-admin" }] };
const MENTIONS: ResolvedMentions = {
  groups: new Map(),
  people: new Map([
    ["U0SYN000004", "U0SYN000004"],
    ["U0SYN000012", "U0SYN000012"],
    ["U0SYN000007", "U0SYN000007"],
  ]),
};

/** The link exactly as the composer wrote it. */
const REAL_LINK = "<https://github.com/acme/acme-admin/pull/16672|add the Agent CLI package #16672>";
const REAL_BUMP = `hey <@U0SYN000004>, bumping ${REAL_LINK} in case it got buried. still green and merges clean, just needs a dx approval`;

/** The as-me artifact as the send path builds it: validated through the schema, then bare references linked. */
function asMe({ value }: { value: unknown }): AsMeArtifact {
  const parsed = dripArtifactSchema({ maxMessages: 6, messageVisibleMax: 400 }).parse(value);
  return linkifyDripArtifact({ artifact: parsed, context: ACME_ADMIN }).artifact;
}

/** A rich payload's blocks, throwing on the plain form so no assertion needs a conditional. */
function richBlocks({ payload }: { payload: SlackDripMessagePayload }): readonly unknown[] {
  if (payload.form !== "rich") {
    throw new Error("expected the rich form");
  }
  return payload.blocks;
}

describe("a <url|label> link to a real pull request", () => {
  it("renders the FORM lane as one link element to the pull request, labelled with the title, no %7C", () => {
    const artifact = asMe({ value: { kind: "drip", messages: [{ runs: [{ text: REAL_BUMP, type: "text" }] }] } });
    const [payload] = renderDrip({ artifact, mentions: MENTIONS });

    expect(payload!.form).toBe("rich");
    expect(richBlocks({ payload: payload! })).toEqual([
      {
        elements: [
          {
            elements: [
              { text: "hey ", type: "text" },
              { type: "user", user_id: "U0SYN000004" },
              { text: ", bumping ", type: "text" },
              {
                text: "add the Agent CLI package #16672",
                type: "link",
                url: "https://github.com/acme/acme-admin/pull/16672",
              },
              {
                text: " in case it got buried. still green and merges clean, just needs a dx approval",
                type: "text",
              },
            ],
            type: "rich_text_section",
          },
        ],
        type: "rich_text",
      },
    ]);
  });

  it("sends the --body lane's string unchanged, and nothing in it is refused before the wire", () => {
    const artifact = linkifyDripArtifact({
      artifact: { kind: "plain", text: REAL_BUMP },
      context: ACME_ADMIN,
    }).artifact;
    const [payload] = renderDrip({ artifact, mentions: MENTIONS });

    expect(payload!.text).toBe(REAL_BUMP);
    expect(payloadRenderIssues({ payload: payload! })).toEqual([]);
  });

  it("refuses the nested string the old linkifier made of it, before the wire", () => {
    const nested =
      "bumping <https://github.com/acme/acme-admin/pull/16672|add the Agent CLI package " +
      "<https://github.com/acme/acme-admin/issues/16672|#16672>> in case it got buried";
    const [payload] = renderDrip({ artifact: { kind: "plain", text: nested }, mentions: MENTIONS });

    expect(payloadRenderIssues({ payload: payload! }).length).toBe(1);
    expect(payloadRenderIssues({ payload: payload! })[0]).toContain('another "<" interrupts');
  });
});

/** The no-fold correction exactly as the bot composed it. */
const REAL_QUOTE = "> Confirming the FE commit isn't the cause.";
const REAL_REPLY = [
  { person: "U0SYN000012", type: "mention" },
  { text: " you're right, 17714 isn't it, sorry for the noise. per ", type: "text" },
  { person: "U0SYN000007", type: "mention" },
  { text: " the customer-entitlement-inngest flag went on in staging about three hours earlier", type: "text" },
];

function noFold({ value }: { value: unknown }): NoFoldArtifact {
  return noFoldArtifactSchema.parse(value);
}

describe("a > quote line", () => {
  it("renders the no-fold lead as a rich_text_quote without the marker, and the reply as its own line", () => {
    const artifact = noFold({
      value: { bullets: [], kind: "no-fold", lead: [{ text: REAL_QUOTE, type: "text" }], trailing: [REAL_REPLY] },
    });
    const rendered = renderNoFoldMessage({
      artifact,
      artifactFingerprint: "fp",
      mentions: MENTIONS,
      metadataEventType: "test_v1",
    });
    const block: RichTextBlock = rendered.blocks[0];

    expect(block.elements).toEqual([
      { elements: [{ text: "Confirming the FE commit isn't the cause.", type: "text" }], type: "rich_text_quote" },
      {
        elements: [
          { type: "user", user_id: "U0SYN000012" },
          { text: " you're right, 17714 isn't it, sorry for the noise. per ", type: "text" },
          { type: "user", user_id: "U0SYN000007" },
          {
            text: " the customer-entitlement-inngest flag went on in staging about three hours earlier",
            type: "text",
          },
        ],
        type: "rich_text_section",
      },
    ]);
    expect(storedRenderIssues({ blocks: rendered.blocks })).toEqual([]);
    expect(noFoldPreviewLines({ payload: rendered }).includes("> Confirming the FE commit isn't the cause.")).toBe(
      true,
    );
  });

  it("names the literal marker in the blocks Slack stored for the published reply", () => {
    const stored = [
      {
        block_id: "rkySx",
        elements: [
          {
            elements: [
              { text: REAL_QUOTE, type: "text" },
              { text: "\n\n", type: "text" },
            ],
            type: "rich_text_section",
          },
          { elements: [{ type: "user", user_id: "U0SYN000012" }], type: "rich_text_section" },
        ],
        type: "rich_text",
      },
    ];

    expect(storedRenderIssues({ blocks: stored }).length).toBe(1);
    expect(storedRenderIssues({ blocks: stored })[0]).toContain(JSON.stringify(REAL_QUOTE));
  });
});
