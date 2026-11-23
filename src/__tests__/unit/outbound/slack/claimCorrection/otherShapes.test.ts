/*
 * `correctClaim` over the other message shapes: a mrkdwn section struck with `~…~`, a block-less message corrected
 * in its text, and a claim inside a list item. It moved here when `claimCorrection.test.ts` was split by behaviour.
 */
import { describe, expect, it } from "vitest";

import { unwrap } from "../../../../../lib/result.js";
import { correctClaim } from "../../../../../outbound/slack/claimCorrection.js";
import { CORRECTION_BLOCK } from "./harness.js";

describe("correctClaim, the other shapes", () => {
  it("uses ~…~ in a mrkdwn section, the one place Slack parses it", () => {
    const stored = {
      blocks: [{ text: { text: "Only 4.2.0 is affected.", type: "mrkdwn" }, type: "section" }],
      text: "x",
    };
    const corrected = unwrap(correctClaim({ correction: "4.2.1 is affected.", stored, wrong: "4.2.0 is affected" }));
    expect(corrected.blocks).toEqual([
      { text: { text: "Only ~4.2.0 is affected~.", type: "mrkdwn" }, type: "section" },
      CORRECTION_BLOCK,
    ]);
    expect(corrected.struckIn).toBe("mrkdwn");
  });

  it("corrects a block-less message in its text, escaping the line", () => {
    const corrected = unwrap(correctClaim({ correction: "a & b", stored: { text: "it was c" }, wrong: "c" }));
    expect(corrected).toEqual({ struckIn: "text", text: "it was ~c~\n*Correction:* a &amp; b" });
  });

  it("matches a claim inside a list item", () => {
    const list = {
      elements: [
        {
          elements: [{ elements: [{ text: "pool is 10", type: "text" }], type: "rich_text_section" }],
          style: "bullet",
          type: "rich_text_list",
        },
      ],
      type: "rich_text",
    };
    const corrected = unwrap(correctClaim({ correction: "it is 20.", stored: { blocks: [list] }, wrong: "is 10" }));
    expect(corrected.blocks![0]).toEqual({
      ...list,
      elements: [
        {
          ...list.elements[0],
          elements: [
            {
              elements: [
                { text: "pool ", type: "text" },
                { style: { strike: true }, text: "is 10", type: "text" },
              ],
              type: "rich_text_section",
            },
          ],
        },
      ],
    });
    expect(corrected.text).toBe("Correction: it is 20.");
  });
});
