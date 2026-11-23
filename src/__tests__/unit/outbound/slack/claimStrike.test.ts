/**
 * The block surgery under `correctClaim`: how often a block makes a claim, and the struck block with the Correction
 * block placed directly under it — never at the end of the list.
 */
import { describe, expect, it } from "vitest";

import { occurrences } from "../../../../outbound/slack/claimMrkdwnSpans.js";
import { CORRECTION_LABEL, correctBlocks, countInBlock } from "../../../../outbound/slack/claimStrike.js";

const SECTION = { text: { text: "10 failed overnight", type: "mrkdwn" }, type: "section" };
const RICH = {
  elements: [{ elements: [{ text: "10 failed, then 10 retried", type: "text" }], type: "rich_text_section" }],
  type: "rich_text",
};
const CORRECTION = {
  elements: [
    {
      elements: [
        { style: { bold: true }, text: `${CORRECTION_LABEL} `, type: "text" },
        { text: "30 failed.", type: "text" },
      ],
      type: "rich_text_section",
    },
  ],
  type: "rich_text",
};

describe("countInBlock", () => {
  it.each([
    ["a mrkdwn section", SECTION, "10 failed", 1],
    ["a rich-text block, twice", RICH, "10", 2],
    ["a divider, which says nothing", { type: "divider" }, "10", 0],
    ["a value that is not a block", "10 failed", "10", 0],
  ])("counts %s", (_label, block, wrong, expected) => {
    expect(countInBlock({ block, wrong })).toBe(expected);
  });
});

describe("occurrences", () => {
  it("finds every non-overlapping offset", () => {
    expect(occurrences({ haystack: "aaaa", needle: "aa" })).toEqual([0, 2]);
  });
});

describe("correctBlocks", () => {
  it("strikes a mrkdwn claim with ~ and puts the Correction block directly under it, before what follows", () => {
    const divider = { type: "divider" };
    const corrected = correctBlocks({ blocks: [SECTION, divider], correction: "30 failed.", wrong: "10 failed" });
    expect(corrected).toEqual({
      blocks: [{ text: { text: "~10 failed~ overnight", type: "mrkdwn" }, type: "section" }, CORRECTION, divider],
      struck: { alreadyStruck: false, kind: "mrkdwn" },
    });
  });

  it("leaves a list that does not make the claim unchanged and reports no strike", () => {
    expect(correctBlocks({ blocks: [SECTION], correction: "30 failed.", wrong: "40 failed" })).toEqual({
      blocks: [SECTION],
    });
  });

  it("reports a claim already struck in mrkdwn as already struck", () => {
    const struck = { text: { text: "~10 failed~ overnight", type: "mrkdwn" }, type: "section" };
    expect(correctBlocks({ blocks: [struck], correction: "30 failed.", wrong: "10 failed" }).struck).toEqual({
      alreadyStruck: true,
      kind: "mrkdwn",
    });
  });
});
