/**
 * The finding proof bar (`outbound/slack/findingProof.ts`): a draft raising a finding brings a
 * screenshot, a link and the impact in people in its first line, or it never reaches the owner's Queue.
 */
import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "#lib/result.js";

import { findingFirstLine } from "../../../../outbound/slack/findingFirstLine.js";
import {
  findingImpactOf,
  findingProofRefusal,
  missingFindingProof,
  raisesFinding,
  storedFindingProofMissing,
} from "../../../../outbound/slack/findingProof.js";
import { FindingProofErrors } from "../../../../outbound/slack/findingProofErrors.js";
import { FINDING_PROOF_MISSING } from "../../../../outbound/slack/findingProofPieces.js";
import { renderUpdateCard } from "../../../../outbound/slack/render.js";
import type { SlackCardChrome, SlackDripMessagePayload } from "../../../../outbound/slack/types.js";

/** A bot card's chrome: the author row the renderer draws above the lead. */
const CHROME: SlackCardChrome = {
  authorEmoji: ":robot_face:",
  authorLabel: "test-bot",
  bannerColor: "#12B5A6",
  detailLabel: "*Details*",
  metadataEventType: "test_card_v1",
};

/** sd-b5a68451's form, as `slack draft show --json` printed it: a one-card declaring a possible problem for many. */
const INCIDENT_FORM = JSON.stringify({ kind: "one-card", lines: [], problem: { affects: "many", kind: "possible" } });

/** sd-b5a68451's rendered payload text, its mention and its one Linear link exactly as stored. */
const INCIDENT_TEXT =
  "<@U0SYN000029> just fyi, i think we're still re-sending repeat orders for many tier 3 customers\n\n" +
  "<https://linear.app/acme/issue/SUP-9381/example-ticket|SUP-9381> " +
  "counted 2,480 repeat orders over the last year for customers who already had a result. it's in backlog with no " +
  "assignee yet\n\nis the renewal SR workaround from up-thread still worth doing in the meantime?";

const INCIDENT_PAYLOAD = {
  form: "plain",
  text: INCIDENT_TEXT,
  unfurl_links: false,
  unfurl_media: false,
} satisfies SlackDripMessagePayload;

/** A form that declares no problem, and one row field set for a message that raises nothing. */
const NONE_FORM = JSON.stringify({ kind: "one-card", lines: [], problem: { kind: "none" } });
/** A team channel, so a top-level row in it is not a direct message. */
const CHANNEL = "C0SYN123ABCD";

const IMPACT = unwrap(findingImpactOf({ value: "12 users tried to check out and could not" }))!;

const PROVED_PAYLOAD = {
  form: "plain",
  text: "12 users tried to check out and could not, a few today\n\n<https://app.example.com/view|the view>",
  unfurl_links: false,
  unfurl_media: false,
} satisfies SlackDripMessagePayload;

describe("missingFindingProof", () => {
  it("names a screenshot and the impact for sd-b5a68451's shape, whose one ticket link counts as a link", () => {
    const missing = missingFindingProof({
      act: "reply",
      form: INCIDENT_FORM,
      impact: undefined,
      impactInForm: false,
      kind: undefined,
      media: 0,
      payload: INCIDENT_PAYLOAD,
    });
    expect(missing).toEqual(["screenshot", "impact"]);
  });

  it("names nothing for a finding bringing a file, a link and its count in the first line", () => {
    const missing = missingFindingProof({
      act: undefined,
      form: INCIDENT_FORM,
      impact: IMPACT,
      impactInForm: false,
      kind: "finding",
      media: 1,
      payload: PROVED_PAYLOAD,
    });
    expect(missing).toEqual([]);
  });

  it("names every piece for a declared finding carrying nothing", () => {
    const missing = missingFindingProof({
      act: undefined,
      form: NONE_FORM,
      impact: undefined,
      impactInForm: false,
      kind: "finding",
      media: 0,
      payload: { text: "the pool is exhausted" },
    });
    expect(missing).toEqual(["screenshot", "link", "impact"]);
  });

  it("names the first-line count when the declared count sits only on a later line", () => {
    const missing = missingFindingProof({
      act: undefined,
      form: INCIDENT_FORM,
      impact: IMPACT,
      impactInForm: false,
      kind: undefined,
      media: 1,
      payload: { text: "customers cannot check out\n12 of them today <https://app.example.com/view|view>" },
    });
    expect(missing).toEqual(["impact-count-first"]);
  });

  it("does not take a count inside a longer number: 12 is not in 2012", () => {
    const missing = missingFindingProof({
      act: undefined,
      form: INCIDENT_FORM,
      impact: IMPACT,
      impactInForm: false,
      kind: undefined,
      media: 1,
      payload: { text: "since 2012 customers cannot check out <https://app.example.com/view|view>" },
    });
    expect(missing).toEqual(["impact-count-first"]);
  });

  it("does not take a count joined to another number by a decimal point or thousands comma", () => {
    const missingFor = ({ text }: { text: string }): readonly string[] =>
      missingFindingProof({
        act: undefined,
        form: INCIDENT_FORM,
        impact: IMPACT,
        impactInForm: false,
        kind: undefined,
        media: 1,
        payload: { text: `${text} <https://app.example.com/view|view>` },
      });
    expect([
      missingFor({ text: "12.5 users could not check out" }),
      missingFor({ text: "1.12 users could not check out" }),
      missingFor({ text: "12,000 users could not check out" }),
      missingFor({ text: "1,12 users could not check out" }),
      missingFor({ text: "12, maybe more, users could not check out." }),
      missingFor({ text: "about 12. users could not check out" }),
      missingFor({ text: "\u030112\u0301 users could not check out" }),
    ]).toEqual([
      ["impact-count-first"],
      ["impact-count-first"],
      ["impact-count-first"],
      ["impact-count-first"],
      [],
      [],
      ["impact-count-first"],
    ]);
  });

  it("does not take a count joined to another word or number by a dash: twenty is not in twenty-five", () => {
    const missingFor = ({ impact, text }: { impact: string; text: string }): readonly string[] =>
      missingFindingProof({
        act: undefined,
        form: INCIDENT_FORM,
        impact: unwrap(findingImpactOf({ value: impact }))!,
        impactInForm: false,
        kind: undefined,
        media: 1,
        payload: { text: `${text} <https://e.example|evidence>` },
      });
    expect([
      missingFor({ impact: "twenty customers could not check out", text: "twenty-five requests failed" }),
      missingFor({ impact: "five customers could not check out", text: "twenty-five requests failed" }),
      missingFor({ impact: "12 users could not check out", text: "12–30 requests failed" }),
      missingFor({ impact: "12 users could not check out", text: "a 12-user cohort could not check out" }),
      missingFor({ impact: "twenty-five users could not check out", text: "twenty-five users could not check out" }),
      missingFor({ impact: "12 users could not check out", text: "12 - maybe more - users could not check out" }),
    ]).toEqual([
      ["impact-count-first"],
      ["impact-count-first"],
      ["impact-count-first"],
      ["impact-count-first"],
      [],
      [],
    ]);
  });

  it("never reads a count out of a drawn link's address, a `)` inside it included", () => {
    const missingFor = ({ url }: { url: string }): readonly string[] =>
      missingFindingProof({
        act: undefined,
        form: INCIDENT_FORM,
        impact: IMPACT,
        impactInForm: false,
        kind: undefined,
        media: 1,
        payload: {
          blocks: [
            {
              elements: [
                {
                  elements: [
                    { text: "evidence", type: "link", url },
                    { text: " many customers could not check out", type: "text" },
                  ],
                  type: "rich_text_section",
                },
              ],
              type: "rich_text",
            },
          ],
          text: "12 users could not check out",
        },
      });
    expect([missingFor({ url: "https://e.example/)#12" }), missingFor({ url: "https://e.example/12" })]).toEqual([
      ["impact-count-first"],
      ["impact-count-first"],
    ]);
  });

  it("reads the count off what the reader sees: a link's label counts, a number in its address does not", () => {
    const missingFor = ({ text }: { text: string }): readonly string[] =>
      missingFindingProof({
        act: undefined,
        form: INCIDENT_FORM,
        impact: IMPACT,
        impactInForm: false,
        kind: undefined,
        media: 1,
        payload: { text },
      });
    expect([
      missingFor({ text: "<https://example.test/incidents/12|the dashboard shows failures>" }),
      missingFor({ text: "<https://example.test/incidents/7|12 users could not check out>" }),
      missingFor({
        text: "<!date^1392734382^{date_short}|12> customers affected <https://e.example/evidence|evidence>",
      }),
    ]).toEqual([["impact-count-first"], [], ["impact-count-first"]]);
  });

  it("counts a link only where the reader sees it: one parked in a block_id or a fallback is none", () => {
    const missingFor = ({ payload }: { payload: unknown }): readonly string[] =>
      missingFindingProof({
        act: undefined,
        form: INCIDENT_FORM,
        impact: IMPACT,
        impactInForm: true,
        kind: "finding",
        media: 1,
        payload,
      });
    const section = ({ blockId, text }: { blockId: string; text: string }): unknown => ({
      blocks: [{ block_id: blockId, text: { text, type: "mrkdwn" }, type: "section" }],
      text: "12 users tried to check out and could not",
    });
    expect([
      missingFor({ payload: section({ blockId: "<https://evidence.example>", text: "12 users could not check out" }) }),
      missingFor({
        payload: {
          attachments: [{ fallback: "12 users <https://evidence.example|view>" }],
          text: "12 users x",
        },
      }),
      missingFor({ payload: section({ blockId: "b1", text: "12 users <https://evidence.example|view>" }) }),
      missingFor({
        payload: {
          blocks: [
            {
              elements: [{ elements: [{ type: "link", url: "https://e.example" }], type: "rich_text_section" }],
              type: "rich_text",
            },
          ],
          text: "12 users tried to check out and could not",
        },
      }),
    ]).toEqual([["link"], ["link"], [], []]);
  });

  it("reads a url only where Slack draws it: a typed element or a titled attachment, never the message root", () => {
    const missingFor = ({ payload }: { payload: unknown }): readonly string[] =>
      missingFindingProof({
        act: undefined,
        form: INCIDENT_FORM,
        impact: IMPACT,
        impactInForm: true,
        kind: "finding",
        media: 1,
        payload,
      });
    const text = "12 users tried to check out and could not";
    expect([
      missingFor({ payload: { text, url: "https://hidden.example/evidence" } }),
      missingFor({ payload: { blocks: [{ block_id: "b", url: "https://hidden.example/evidence" }], text } }),
      missingFor({
        payload: {
          blocks: [
            {
              elements: [
                {
                  action_id: "view",
                  text: { text: "view", type: "plain_text" },
                  type: "button",
                  url: "https://e.example",
                },
              ],
              type: "actions",
            },
          ],
          text,
        },
      }),
      missingFor({ payload: { attachments: [{ title: "the view", title_link: "https://e.example" }], text } }),
      missingFor({ payload: { attachments: [{ title_link: "https://hidden.example/evidence" }], text } }),
      missingFor({ payload: { attachments: [{ title: " ", title_link: "https://hidden.example/evidence" }], text } }),
      missingFor({ payload: { blocks: [{ blocks: [{ text: "<https://hidden.example|evidence>" }] }], text } }),
      missingFor({
        payload: {
          attachments: [{ blocks: [{ text: { text: "<https://e.example|view>", type: "mrkdwn" }, type: "section" }] }],
          text,
        },
      }),
      missingFor({ payload: { text: `${text} <https://hidden.example/evidence| >` } }),
      missingFor({
        payload: { blocks: [{ elements: [{ text: "", type: "link", url: "https://hidden.example" }] }], text },
      }),
      missingFor({ payload: { text: `${text} <https://e.example>` } }),
      missingFor({
        payload: {
          blocks: [
            {
              elements: [
                {
                  elements: [{ text, type: "text" }],
                  type: "rich_text_section",
                  url: "https://hidden.example/evidence",
                },
              ],
              type: "rich_text",
            },
          ],
          text,
        },
      }),
      missingFor({ payload: { blocks: [{ type: "section", url: "https://hidden.example/evidence" }], text } }),
      missingFor({
        payload: {
          blocks: [
            { elements: [{ elements: [{ text, type: "text" }], type: "rich_text_section" }], type: "rich_text" },
          ],
          text: `${text} <https://hidden.example/evidence|evidence>`,
        },
      }),
      missingFor({
        payload: {
          blocks: [
            {
              elements: [
                {
                  elements: [
                    { text, type: "text" },
                    { style: { code: true }, text: " <https://hidden.example/evidence|view>", type: "text" },
                  ],
                  type: "rich_text_section",
                },
              ],
              type: "rich_text",
            },
          ],
          text,
        },
      }),
      missingFor({
        payload: {
          blocks: [
            { text: { text: `${text} <https://hidden.example/evidence|view>`, type: "plain_text" }, type: "header" },
          ],
          text,
        },
      }),
    ]).toEqual([
      ["link"],
      ["link"],
      [],
      [],
      ["link"],
      ["link"],
      ["link"],
      [],
      ["link"],
      ["link"],
      [],
      ["link"],
      ["link"],
      ["link"],
      ["link"],
      ["link"],
    ]);
  });

  it("takes no link whose label is only zero-width characters, which draw nothing to click", () => {
    const text = "12 users tried to check out and could not";
    const missingFor = ({
      payload,
    }: {
      payload: SlackDripMessagePayload | Record<string, unknown>;
    }): readonly string[] =>
      missingFindingProof({
        act: undefined,
        form: INCIDENT_FORM,
        impact: IMPACT,
        impactInForm: true,
        kind: "finding",
        media: 1,
        payload,
      });
    const blank = "​⁠ ";
    const link = ({ run }: { run: unknown }): unknown => ({
      elements: [{ elements: [run], type: "rich_text_section" }],
      type: "rich_text",
    });
    expect([
      missingFor({ payload: { text: `${text} <https://hidden.example/evidence|${blank}>` } }),
      missingFor({
        payload: { blocks: [link({ run: { text: blank, type: "link", url: "https://hidden.example" } })], text },
      }),
      missingFor({ payload: { attachments: [{ title: blank, title_link: "https://hidden.example" }], text } }),
      missingFor({
        payload: {
          blocks: [
            {
              elements: [
                {
                  action_id: "view",
                  text: { text: blank, type: "plain_text" },
                  type: "button",
                  url: "https://hidden.example",
                },
              ],
              type: "actions",
            },
          ],
          text,
        },
      }),
      missingFor({ payload: { text: `${text} <https://e.example|​view>` } }),
    ]).toEqual([["link"], ["link"], ["link"], ["link"], []]);
  });

  it("takes no rich text link styled unlink, which Slack draws as plain text", () => {
    const missingFor = ({ style }: { style: Record<string, unknown> }): readonly string[] =>
      missingFindingProof({
        act: undefined,
        form: INCIDENT_FORM,
        impact: IMPACT,
        impactInForm: false,
        kind: "finding",
        media: 1,
        payload: {
          blocks: [
            {
              elements: [
                {
                  elements: [
                    { text: "12 users could not check out ", type: "text" },
                    { style, text: "evidence", type: "link", url: "https://evidence.example" },
                  ],
                  type: "rich_text_section",
                },
              ],
              type: "rich_text",
            },
          ],
          text: "12 users could not check out",
        },
      });
    expect([missingFor({ style: { unlink: true } }), missingFor({ style: { bold: true } })]).toEqual([["link"], []]);
  });

  it("reads an accessory only on a section, the one block type that draws it", () => {
    const text = "12 users could not check out";
    const button = {
      action_id: "view",
      text: { text: "view", type: "plain_text" },
      type: "button",
      url: "https://evidence.example",
    };
    const missingFor = ({ block }: { block: Record<string, unknown> }): readonly string[] =>
      missingFindingProof({
        act: undefined,
        form: INCIDENT_FORM,
        impact: IMPACT,
        impactInForm: true,
        kind: "finding",
        media: 1,
        payload: { blocks: [block], text },
      });
    const rich = { elements: [{ elements: [{ text, type: "text" }], type: "rich_text_section" }], type: "rich_text" };
    const section = { text: { text, type: "mrkdwn" }, type: "section" };
    expect([
      missingFor({ block: { ...rich, accessory: button } }),
      missingFor({ block: { ...section, accessory: button } }),
    ]).toEqual([["link"], []]);
  });

  it("takes a button's link only on Slack's documented button: an action_id and a plain_text label", () => {
    const text = "12 users could not check out";
    const missingFor = ({ button }: { button: Record<string, unknown> }): readonly string[] =>
      missingFindingProof({
        act: undefined,
        form: INCIDENT_FORM,
        impact: IMPACT,
        impactInForm: true,
        kind: "finding",
        media: 1,
        payload: { blocks: [{ elements: [button], type: "actions" }], text },
      });
    const label = { text: "evidence", type: "plain_text" };
    expect([
      missingFor({ button: { action_id: "view", text: label, type: "button", url: "https://e.example" } }),
      missingFor({ button: { text: label, type: "button", url: "https://e.example" } }),
      missingFor({ button: { action_id: "", text: label, type: "button", url: "https://e.example" } }),
      missingFor({
        button: { action_id: "view", text: { ...label, type: "mrkdwn" }, type: "button", url: "https://e.example" },
      }),
    ]).toEqual([[], ["link"], ["link"], ["link"]]);
  });

  it("takes no link from inside a code span or block, which Slack draws as code", () => {
    const text = "12 users tried to check out and could not";
    const missingFor = ({ tail }: { tail: string }): readonly string[] =>
      missingFindingProof({
        act: undefined,
        form: INCIDENT_FORM,
        impact: IMPACT,
        impactInForm: true,
        kind: "finding",
        media: 1,
        payload: { text: `${text} ${tail}` },
      });
    expect([
      missingFor({ tail: "`<https://hidden.example/evidence|evidence>`" }),
      missingFor({ tail: "```\n<https://hidden.example/evidence|evidence>\n```" }),
      missingFor({ tail: "`code` then <https://e.example|evidence>" }),
    ]).toEqual([["link"], ["link"], []]);
  });

  it("reads an attachment's title and a field's title as plain text, never as a link token", () => {
    const text = "12 users tried to check out and could not";
    const token = "<https://hidden.example/evidence|evidence>";
    const missingFor = ({ attachment }: { attachment: Record<string, unknown> }): readonly string[] =>
      missingFindingProof({
        act: undefined,
        form: INCIDENT_FORM,
        impact: IMPACT,
        impactInForm: true,
        kind: "finding",
        media: 1,
        payload: { attachments: [attachment], text },
      });
    expect([
      missingFor({ attachment: { mrkdwn_in: ["text"], text: "Details", title: token } }),
      missingFor({ attachment: { fields: [{ title: token, value: "open" }], mrkdwn_in: ["fields"] } }),
      missingFor({ attachment: { fields: [{ title: "where", value: token }], mrkdwn_in: ["fields"] } }),
      missingFor({ attachment: { mrkdwn_in: ["pretext"], pretext: token } }),
      missingFor({ attachment: { text: token } }),
      missingFor({ attachment: { mrkdwn_in: ["pretext"], text: token } }),
      missingFor({ attachment: { fields: [{ title: "where", value: token }] } }),
    ]).toEqual([["link"], ["link"], [], [], ["link"], ["link"], ["link"]]);
  });

  it("lets a bot finding card's own counted blast radius stand in for --impact", () => {
    const missing = missingFindingProof({
      act: undefined,
      form: INCIDENT_FORM,
      impact: undefined,
      impactInForm: true,
      kind: "finding",
      media: 3,
      payload: PROVED_PAYLOAD,
    });
    expect(missing).toEqual([]);
  });

  it("names nothing for a row that raises no finding, proof or not", () => {
    const missing = missingFindingProof({
      act: undefined,
      form: NONE_FORM,
      impact: undefined,
      impactInForm: false,
      kind: "message",
      media: 0,
      payload: { text: "thanks, looking now" },
    });
    expect(missing).toEqual([]);
  });
});

describe("raisesFinding", () => {
  it("is true for a possible problem declared --kind message: the kind never neutralises the declaration", () => {
    expect(raisesFinding({ act: undefined, form: INCIDENT_FORM, kind: "message" })).toBe(true);
  });

  it("is true for --kind finding whatever the form declares", () => {
    expect(raisesFinding({ act: undefined, form: NONE_FORM, kind: "finding" })).toBe(true);
  });

  it("is false for a chase bump whose form re-surfaces a finding, and true for one declaring --kind finding", () => {
    expect([
      raisesFinding({ act: "bump", form: INCIDENT_FORM, kind: undefined }),
      raisesFinding({ act: "bump", form: INCIDENT_FORM, kind: "message" }),
      raisesFinding({ act: "bump", form: NONE_FORM, kind: "finding" }),
    ]).toEqual([false, false, true]);
  });

  it("is false for a form that does not parse and no declared kind", () => {
    expect(raisesFinding({ act: undefined, form: "{not json", kind: undefined })).toBe(false);
  });
});

describe("findingImpactOf", () => {
  it("reads a thousands-separated count and keeps the words as given", () => {
    expect(unwrap(findingImpactOf({ value: " 2,480 customers re-ordered a test " }))).toEqual({
      count: "2,480",
      text: "2,480 customers re-ordered a test",
    });
  });

  it("reads a spelled count, hyphenated included", () => {
    expect(unwrap(findingImpactOf({ value: "twenty-five customers could not check out" }))!.count).toBe("twenty-five");
  });

  it("is nothing when the flag is absent", () => {
    expect(unwrap(findingImpactOf({ value: undefined }))).toBe(undefined);
  });

  it("refuses words that do not lead with a count", () => {
    expect(unwrapErr(findingImpactOf({ value: "many tier 3 customers re-ordered" }))[0]).toContain(
      "--impact must lead with how many people",
    );
  });

  it("refuses a count with nobody and nothing after it", () => {
    expect(unwrapErr(findingImpactOf({ value: "12 users" }))[0]).toContain("--impact must lead with how many people");
  });

  it("refuses a count of things rather than people: requests are not who was hurt", () => {
    const value = "20 requests failed today";
    expect(unwrapErr(findingImpactOf({ value }))).toEqual([FindingProofErrors.impactUncounted({ value }).message]);
  });

  it("reads a person named after a qualifier, the way sd-b5a68451's tier-three customers would be", () => {
    expect(unwrap(findingImpactOf({ value: "2,480 tier-3 customers were sent a repeat order" }))!.count).toBe("2,480");
  });

  it("does not read a person inside a longer word: a username is not a user", () => {
    expect(unwrapErr(findingImpactOf({ value: "20 usernames were rejected today" }))[0]).toContain(
      "--impact must lead with how many people",
    );
  });

  it("reads a person noun only as a whole word: not users123, user_ids, 2users or one a combining mark continues", () => {
    const combining = "20 user\u0301names failed today";
    const values = ["20 users123 failed today", "20 user_ids failed today", "20 x2users failed today", combining];
    expect(values.map((value) => unwrapErr(findingImpactOf({ value })))).toEqual(
      values.map((value) => [FindingProofErrors.impactUncounted({ value }).message]),
    );
    expect(unwrap(findingImpactOf({ value: "20 users (staff) failed today" }))!.count).toBe("20");
  });

  it("reads the impact as a reader sees it: a zero-width character splits no word and joins no count", () => {
    expect(unwrapErr(findingImpactOf({ value: "20 user​names failed today" }))[0]).toContain(
      "--impact must lead with how many people",
    );
    expect(unwrap(findingImpactOf({ value: "1​2 users could not check out" }))).toEqual({
      count: "12",
      text: "12 users could not check out",
    });
  });

  it("refuses a malformed thousands separator", () => {
    expect(unwrapErr(findingImpactOf({ value: "1,67 customers could not check out" }))[0]).toContain(
      "--impact must lead with how many people",
    );
  });
});

describe("findingFirstLine", () => {
  it("reads a rendered card's tldr, which its fallback carries and its lead draws, past the author chrome", () => {
    const payload = renderUpdateCard({
      artifact: {
        citations: [],
        detail: [{ runs: [{ text: "The pool is exhausted.", type: "text" }], type: "paragraph" }],
        index: [[{ text: "since 09:00", type: "text" }]],
        kind: "update",
        media: [],
        primaryLink: { label: "the view", url: "https://app.example.com/view" },
        tldr: "12 users cannot check out",
      },
      artifactFingerprint: "fp-1",
      chrome: CHROME,
      mentions: { groups: new Map(), people: new Map() },
    });
    expect(findingFirstLine({ payload })).toBe("12 users cannot check out");
  });

  it("never takes a count from a fallback the card's blocks do not draw", () => {
    const section = ({ elements }: { elements: readonly unknown[] }): unknown => ({
      elements: [{ elements, type: "rich_text_section" }],
      type: "rich_text",
    });
    const payload = {
      attachments: [
        {
          blocks: [
            section({ elements: [{ text: "The pool is exhausted.", type: "text" }] }),
            section({ elements: [{ text: "evidence", type: "link", url: "https://evidence.example/view" }] }),
          ],
          fallback: "12 users could not check out",
        },
      ],
      text: "",
    };
    expect(findingFirstLine({ payload })).toBe("The pool is exhausted.");
  });

  it("takes a card's fallback only where its lead opens on it, never from a later block that repeats it", () => {
    const section = ({ elements }: { elements: readonly unknown[] }): unknown => ({
      elements: [{ elements, type: "rich_text_section" }],
      type: "rich_text",
    });
    const author = { elements: [{ text: ":robot_face:  *test-bot*", type: "mrkdwn" }], type: "context" };
    const card = ({ blocks }: { blocks: readonly unknown[] }): unknown => ({
      attachments: [{ blocks, fallback: "12 users could not check out" }],
      text: "",
    });
    const later = card({
      blocks: [
        author,
        { type: "divider" },
        section({ elements: [{ text: "The pool is exhausted.", type: "text" }] }),
        section({ elements: [{ text: "12 users could not check out", type: "text" }] }),
      ],
    });
    const unframed = card({ blocks: [section({ elements: [{ text: "12 users cannot check out", type: "text" }] })] });
    expect([findingFirstLine({ payload: later }), findingFirstLine({ payload: unframed })]).toEqual([
      ":robot_face:  *test-bot*",
      "12 users cannot check out",
    ]);
  });

  it("reads the first line of an as-me message's text", () => {
    expect(findingFirstLine({ payload: INCIDENT_PAYLOAD })).toBe(
      "<@U0SYN000029> just fyi, i think we're still re-sending repeat orders for many tier 3 customers",
    );
  });

  it("ends the first line at a Unicode line or paragraph separator, and at a carriage return", () => {
    const lines = ["\u2028", "\u2029", "\r"].map((separator) =>
      findingFirstLine({
        payload: { text: `This may affect many customers.${separator}12 users could not check out` },
      }),
    );
    expect(lines).toEqual(Array(3).fill("This may affect many customers."));
  });

  it("reads a message's drawn blocks over its notification text: the count must be where the reader looks", () => {
    const rich = ({ elements }: { elements: readonly Record<string, unknown>[] }): unknown => ({
      blocks: [{ elements: [{ elements, type: "rich_text_section" }], type: "rich_text" }],
      text: "12 users could not check out",
    });
    expect([
      findingFirstLine({ payload: rich({ elements: [{ text: "The pool is exhausted", type: "text" }] }) }),
      findingFirstLine({ payload: rich({ elements: [{ text: "12 users could not check out\nmore", type: "text" }] }) }),
      findingFirstLine({
        payload: { blocks: [{ elements: "not a list", type: "rich_text" }], text: "12 users x" },
      }),
    ]).toEqual(["The pool is exhausted", "12 users could not check out", undefined]);
  });

  it("does not count a number inside a drawn rich text link's address", () => {
    const missing = missingFindingProof({
      act: undefined,
      form: INCIDENT_FORM,
      impact: IMPACT,
      impactInForm: false,
      kind: undefined,
      media: 1,
      payload: {
        blocks: [
          {
            elements: [
              {
                elements: [{ text: "the dashboard", type: "link", url: "https://example.test/incidents/12" }],
                type: "rich_text_section",
              },
            ],
            type: "rich_text",
          },
        ],
        text: "12 users tried to check out and could not",
      },
    });
    expect(missing).toEqual(["impact-count-first"]);
  });

  it("takes no count from an emoji's name, which Slack draws as a picture", () => {
    const impact = unwrap(findingImpactOf({ value: "twenty customers could not check out" }));
    const missingFor = ({ first }: { first: readonly unknown[] }): readonly string[] =>
      missingFindingProof({
        act: undefined,
        form: INCIDENT_FORM,
        impact,
        impactInForm: false,
        kind: undefined,
        media: 1,
        payload: {
          blocks: [
            {
              elements: [
                {
                  elements: [...first, { text: "evidence", type: "link", url: "https://e.example" }],
                  type: "rich_text_section",
                },
              ],
              type: "rich_text",
            },
          ],
          text: "twenty customers could not check out",
        },
      });
    expect([
      missingFor({
        first: [
          { name: "twenty", type: "emoji" },
          { text: " customers could not check out ", type: "text" },
        ],
      }),
      missingFor({ first: [{ text: "twenty customers could not check out ", type: "text" }] }),
    ]).toEqual([["impact-count-first"], []]);
    expect(
      missingFindingProof({
        act: undefined,
        form: INCIDENT_FORM,
        impact,
        impactInForm: false,
        kind: undefined,
        media: 1,
        payload: { text: ":twenty: customers could not check out <https://e.example|evidence>" },
      }),
    ).toEqual(["impact-count-first"]);
  });

  it("is nothing for a payload carrying no text", () => {
    expect(findingFirstLine({ payload: { blocks: [] } })).toBe(undefined);
  });
});

describe("storedFindingProofMissing", () => {
  it("sends sd-b5a68451's stored row back for a screenshot and the impact", () => {
    const missing = storedFindingProofMissing({
      draft: { channel: CHANNEL, act: "reply", form: INCIDENT_FORM, payload: INCIDENT_PAYLOAD },
    });
    expect(missing).toEqual(["screenshot", "impact"]);
  });

  it("re-reads a stored impact from its words, so a stored row with its proof stands", () => {
    const missing = storedFindingProofMissing({
      draft: {
        channel: CHANNEL,
        form: INCIDENT_FORM,
        impact: "12 users tried to check out and could not",
        media: [{ bytes: 1, name: "a.png", sha256: "d" }],
        payload: PROVED_PAYLOAD,
      },
    });
    expect(missing).toEqual([]);
  });

  it("reads a stored impact that is not text as none, so a finding goes back for it", () => {
    const draft = { channel: CHANNEL, form: INCIDENT_FORM, impact: 123 as unknown as string, payload: PROVED_PAYLOAD };
    expect(
      storedFindingProofMissing({ draft: { ...draft, media: [{ bytes: 1, name: "a.png", sha256: "d" }] } }),
    ).toEqual(["impact"]);
  });

  it("reads a blank stored impact as none: a finding goes back for it, a row raising none is untouched", () => {
    const media = [{ bytes: 1, name: "a.png", sha256: "d" }];
    const finding = storedFindingProofMissing({
      draft: { channel: CHANNEL, form: INCIDENT_FORM, impact: "", media, payload: PROVED_PAYLOAD },
    });
    const message = storedFindingProofMissing({
      draft: { channel: CHANNEL, form: NONE_FORM, impact: "", kind: "message", payload: INCIDENT_PAYLOAD },
    });
    expect([finding, message]).toEqual([["impact"], []]);
  });

  it("reads a bot finding form's MEASURED blast radius in place of an impact, and an unmeasured one as none", () => {
    const card = ({ blastRadius }: { blastRadius: Record<string, unknown> }): readonly string[] =>
      storedFindingProofMissing({
        draft: {
          channel: CHANNEL,
          actor: "bot",
          form: JSON.stringify({ blastRadius, kind: "finding" }),
          kind: "finding",
          media: [{ bytes: 1, name: "a.png", sha256: "d" }],
          payload: PROVED_PAYLOAD,
        },
      });
    const measured = card({ blastRadius: { basis: "usr.id", users: 12, window: "14 days" } });
    const unmeasured = card({ blastRadius: { proxy: "120 failed calls", unmeasuredBecause: "no user id" } });
    const malformed = card({ blastRadius: { basis: "usr.id", users: 0, window: "14 days" } });
    expect([measured, unmeasured, malformed]).toEqual([[], ["impact"], ["impact"]]);
  });

  it("holds a legacy top-level row as the owner that declares no kind as a finding, and nothing else", () => {
    const legacy = {
      channel: CHANNEL,
      form: NONE_FORM,
      payload: { ...INCIDENT_PAYLOAD, text: "the pool is exhausted" },
    };
    expect([
      storedFindingProofMissing({ draft: legacy }),
      storedFindingProofMissing({ draft: { ...legacy, threadTs: "1700000000.000100" } }),
      storedFindingProofMissing({ draft: { ...legacy, channel: "D0SYN123ABCD" } }),
      storedFindingProofMissing({ draft: { ...legacy, kind: "message" } }),
      storedFindingProofMissing({ draft: { ...legacy, actor: "bot" } }),
    ]).toEqual([["screenshot", "link", "impact"], [], [], [], []]);
  });
});

describe("findingProofRefusal", () => {
  it("names every missing piece and says --tried does not answer it", () => {
    const lines = findingProofRefusal({ missing: FINDING_PROOF_MISSING });
    expect(lines[0]).toContain("is missing screenshot, link, impact, impact-count-first");
    expect(lines.length).toBe(FINDING_PROOF_MISSING.length + 2);
    expect(lines.at(-1)).toContain("--self-evident and --tried do not answer this");
  });

  it("is empty when nothing is missing", () => {
    expect(findingProofRefusal({ missing: [] })).toEqual([]);
  });
});
