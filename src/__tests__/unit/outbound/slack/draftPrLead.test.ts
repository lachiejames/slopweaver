/*
 * A parked Slack draft's first block leads with the discussion, never a pull request — read off the rendered payload,
 * shaped as a fixture incident draft parks.
 */
import { describe, expect, it } from "vitest";

import { draftOpening, prLedDraftRefusals, prLedRefusalsFor } from "../../../../outbound/slack/draftPrLead.js";

/** The compare address the fixture incident draft's primary link points at. */
const COMPARE = "https://github.com/acme/acme-admin/compare/staging...incident-acme-admin-gateway";

/** A bot card wrapper whose first content block opens with `runs`, behind the bot's name line and a divider. */
function card({ runs }: { runs: readonly unknown[] }): unknown {
  return {
    attachments: [
      {
        blocks: [
          { elements: [{ text: ":robot_face:  *acme-bot*", type: "mrkdwn" }], type: "context" },
          { type: "divider" },
          { elements: [{ elements: runs, type: "rich_text_section" }], type: "rich_text" },
          { elements: [{ text: "*Details*", type: "mrkdwn" }], type: "context" },
          {
            elements: [
              { elements: [{ text: "could you review the fix PR?", type: "text" }], type: "rich_text_section" },
            ],
            type: "rich_text",
          },
        ],
        color: "#8B5CF6",
      },
    ],
    text: "",
  };
}

describe("draftOpening", () => {
  it("reads the first content block, the link's address ahead of its label", () => {
    const payload = card({
      runs: [
        { text: "🔗 ", type: "text" },
        { text: "Fix branch", type: "link", url: COMPARE },
        { text: "\n\nFixture prod gateway outage", type: "text" },
      ],
    });
    expect(draftOpening({ payload })).toBe(`🔗 ${COMPARE} Fix branch\n\nFixture prod gateway outage`);
  });

  it("falls to the message text when it carries no block", () => {
    expect(draftOpening({ payload: { text: "hey team, these errors" } })).toBe("hey team, these errors");
  });

  // A mention says who is pinged, never what the message is about, so a poll's question is what it opens on.
  it.each([
    {
      expected: "*Approve the fix PR?*",
      name: "a block",
      payload: {
        blocks: [{ text: { text: "<!subteam^S1> <@U2> *Approve the fix PR?*", type: "mrkdwn" }, type: "section" }],
      },
    },
    { expected: "Approve the fix PR?", name: "the message text", payload: { text: "<!here> Approve the fix PR?" } },
  ])("skips the mentions $name opens on", ({ expected, payload }) => {
    expect(draftOpening({ payload })).toBe(expected);
  });
});

describe("prLedDraftRefusals", () => {
  it("refuses the fixture incident draft's opening", () => {
    const payload = card({
      runs: [
        { text: "🔗 ", type: "text" },
        { text: "Fix branch", type: "link", url: COMPARE },
        { text: "\n\nFixture prod gateway outage hitting many users. need a reviewer for the fix", type: "text" },
      ],
    });
    expect(prLedDraftRefusals({ payload, toOwnerDm: false })).toEqual([
      expect.stringContaining(`the message's first block leads with a pull request ("${COMPARE}")`),
      "There is no hatch: reword the opening to lead with the evidence, and the pull request can sit in the detail.",
    ]);
  });

  it("passes the discussion, with a PR ask left below the fold", () => {
    const payload = card({
      runs: [
        {
          text: "hey team, I just noticed these errors coming through on the fixture gateway; looks like an incident, might be dropping our events",
          type: "text",
        },
      ],
    });
    expect(prLedDraftRefusals({ payload, toOwnerDm: false })).toEqual([]);
  });

  it("does not judge a draft bound for the owner's own bot DM, which no teammate reads", () => {
    const payload = card({ runs: [{ text: "Fix branch", type: "link", url: COMPARE }] });
    expect(prLedDraftRefusals({ payload, toOwnerDm: false })).toEqual([
      expect.stringContaining(`the message's first block leads with a pull request ("${COMPARE}")`),
      "There is no hatch: reword the opening to lead with the evidence, and the pull request can sit in the detail.",
    ]);
    expect(prLedDraftRefusals({ payload, toOwnerDm: true })).toEqual([]);
  });
});

describe("prLedRefusalsFor", () => {
  const payload = card({ runs: [{ text: "Fix branch", type: "link", url: COMPARE }] });
  const refused = [
    expect.stringContaining(`the message's first block leads with a pull request ("${COMPARE}")`),
    "There is no hatch: reword the opening to lead with the evidence, and the pull request can sit in the detail.",
  ];

  it("exempts the direct message a read proved the owner's own", () => {
    expect(prLedRefusalsFor({ channel: "D0SYNBOTDM01", payload, verifiedOwnDm: "D0SYNBOTDM01" })).toEqual([]);
  });

  // A configured `D…` id nobody proved is the owner's is a teammate's DM until shown otherwise.
  it("judges the prompt channel when nothing proved it the owner's", () => {
    expect(prLedRefusalsFor({ channel: "D0SYNBOTDM01", payload, verifiedOwnDm: undefined })).toEqual(refused);
  });

  it.each(["C0SYNTEAM001", "G0SYNGROUP01"])("judges %s even when a caller names it verified", (channel) => {
    expect(prLedRefusalsFor({ channel, payload, verifiedOwnDm: channel })).toEqual(refused);
  });

  it("judges a direct message the verified id only names once trimmed", () => {
    expect(prLedRefusalsFor({ channel: "D0SYNBOTDM01", payload, verifiedOwnDm: " D0SYNBOTDM01 " })).toEqual(refused);
  });

  it("judges a direct message other than the one proved the owner's", () => {
    expect(prLedRefusalsFor({ channel: "D0SYNCOLLEAG1", payload, verifiedOwnDm: "D0SYNBOTDM01" })).toEqual(refused);
  });
});
