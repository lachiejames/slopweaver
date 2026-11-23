/*
 * The sentences a Queue card's heading is drawn from, and the one it heads with — the pick `cardAlignment.ts` judges
 * and `site/__tests__/unit/queueHeadingMirror.test.ts` holds equal to the card's own.
 */
import { describe, expect, it } from "vitest";

import { cardHeading, cardLead, LEAD_SENTENCES } from "../../../handover/cardHeading.js";

describe("cardLead", () => {
  it("keeps the opening two sentences, trimmed", () => {
    expect(LEAD_SENTENCES).toBe(2);
    expect(cardLead({ question: "  One. Two? Three?  " })).toEqual(["One.", "Two?"]);
  });
});

describe("cardHeading", () => {
  it.each([
    { expected: "Should we share it?", lead: ["The test dashboard shows fixture errors.", "Should we share it?"] },
    { expected: "Push it, A or B?", lead: ["Push it, A or B?", "The branch is written."] },
    { expected: undefined, lead: ["The branch is written.", "It is on staging."] },
    { expected: undefined, lead: [] },
  ])("heads $lead with $expected", ({ expected, lead }) => {
    expect(cardHeading({ lead })).toBe(expected);
  });
});
