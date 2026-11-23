/*
 * `correctClaim` over rich text in an attachment wrapper: exactly the claim's words struck, the Correction line
 * directly under its block, and only what chat.update takes sent back. It moved here when `claimCorrection.test.ts`
 * was split by behaviour.
 */
import { describe, expect, it } from "vitest";

import { unwrap } from "../../../../../lib/result.js";
import { correctClaim } from "../../../../../outbound/slack/claimCorrection.js";
import { CORRECTION_BLOCK, LEAD, METADATA } from "./harness.js";

describe("correctClaim, rich text in an attachment wrapper", () => {
  const stored = {
    attachments: [{ blocks: [LEAD, { type: "divider" }], color: "#7c3aed", fallback: "Only 4.2.0 is affected", id: 1 }],
    metadata: METADATA,
    text: "Only 4.2.0 is affected",
  };

  it("strikes exactly the claim's words, splitting the runs at its edges, and keeps the mention", () => {
    const corrected = unwrap(correctClaim({ correction: "4.2.1 is affected.", stored, wrong: "4.2.0 is affected" }));
    const attachment = corrected.attachments![0]!;
    expect(attachment.blocks![0]).toEqual({
      ...LEAD,
      elements: [
        {
          elements: [
            { text: "Only ", type: "text" },
            { style: { bold: true, strike: true }, text: "4.2.0 is affected", type: "text" },
            { text: ", ", type: "text" },
            { type: "user", user_id: "U0ASKER" },
            { text: " — upgrade.", type: "text" },
          ],
          type: "rich_text_section",
        },
      ],
    });
  });

  it("puts the Correction line directly under the claim's block, before what followed it", () => {
    const corrected = unwrap(correctClaim({ correction: " 4.2.1 is affected. ", stored, wrong: "4.2.0 is affected" }));
    expect(corrected.attachments![0]!.blocks!.slice(1)).toEqual([CORRECTION_BLOCK, { type: "divider" }]);
  });

  it("sends back only what chat.update takes, keeps the metadata, and corrects both fallbacks", () => {
    const corrected = unwrap(correctClaim({ correction: "4.2.1 is affected.", stored, wrong: "4.2.0 is affected" }));
    expect(Object.keys(corrected.attachments![0]!).toSorted()).toEqual(["blocks", "color", "fallback"]);
    expect(corrected.metadata).toEqual(METADATA);
    expect(corrected.text).toBe("Only ~4.2.0 is affected~\n*Correction:* 4.2.1 is affected.");
    expect(corrected.attachments![0]!.fallback).toBe(corrected.text);
    expect(corrected.struckIn).toBe("rich-text");
  });

  it("splits a single run in three when the claim sits inside it", () => {
    const corrected = unwrap(correctClaim({ correction: "4.2.1 is affected.", stored, wrong: "4.2.0" }));
    expect((corrected.attachments![0]!.blocks![0] as typeof LEAD).elements[0]!.elements.slice(0, 3)).toEqual([
      { text: "Only ", type: "text" },
      { style: { bold: true, strike: true }, text: "4.2.0", type: "text" },
      { style: { bold: true }, text: " is affected", type: "text" },
    ]);
  });
});
