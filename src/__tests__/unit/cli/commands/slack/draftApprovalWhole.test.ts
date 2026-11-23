/**
 * `partialWordsWhy` — whether the owner's words, as one record read them, stand whole enough to bind as a yes.
 */
import { describe, expect, it } from "vitest";

import { partialWordsWhy } from "../../../../../cli/commands/slack/draftApprovalWhole.js";
import type { RawWords } from "../../../../../handover/hisWordsResolve.js";
import { WHOLE_ENDS } from "../../../../rawWordsFixture.js";

const LANDED: RawWords = {
  atIso: "2026-10-08T00:10:00.000Z",
  context: { cardKey: "post:sd-0a0b0c0d", draftIds: undefined, draftIdsUnread: undefined, kind: "card-landing" },
  ...WHOLE_ENDS,
  text: "send it",
  where: "call-landing",
};
const RELAYED: RawWords = {
  ...LANDED,
  context: { about: "", kind: "relay", triageRuling: null },
  where: "console-voice",
};
const STRETCH = "name the call's own stretch instead (talk-call:<call>#<segment>)";
const PART = "the record holds only part of what the owner said there, so it cannot stand as their yes";

describe("partialWordsWhy", () => {
  it("lets whole, dated words stand", () => {
    expect(partialWordsWhy({ words: LANDED })).toBe(undefined);
  });

  it("refuses a card landing whose words were cut, or that predates saying whether they were", () => {
    expect([
      partialWordsWhy({ words: { ...LANDED, tailLost: true } }),
      partialWordsWhy({ words: { ...LANDED, headLost: true } }),
      partialWordsWhy({ words: { ...LANDED, text: "  " } }),
      partialWordsWhy({ words: { ...LANDED, tailKnown: false } }),
    ]).toEqual([
      PART,
      PART,
      PART,
      `the card landing predates the record of whether its words were cut, so it is never read as whole — ${STRETCH}`,
    ]);
  });

  it("names the stretch for a relay made mid-sentence, and says which half an older relay never recorded", () => {
    expect([
      partialWordsWhy({ words: { ...RELAYED, tailLost: true } }),
      partialWordsWhy({ words: { ...RELAYED, tailKnown: false } }),
      partialWordsWhy({ words: { ...RELAYED, headKnown: false } }),
    ]).toEqual([
      `the relay was made while the owner was still speaking, so it cannot stand as a yes — ${STRETCH}`,
      `the relay predates the record of whether the owner was still speaking, so it is never read as whole — ${STRETCH}`,
      `the relay predates the record of whether its start was cut, so it is never read as whole — ${STRETCH}`,
    ]);
  });

  it("refuses words the register could not date", () => {
    expect(partialWordsWhy({ words: { ...LANDED, atIso: "yesterday" } })).toBe(
      "the record does not date the owner's words as an instant (yesterday), so the register could not read the yes back",
    );
  });
});
