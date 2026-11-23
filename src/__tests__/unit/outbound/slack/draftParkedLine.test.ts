/** Whether a register line's park is whole, called directly; the line-level reading is in `draftRegister/`. */
import { describe, expect, it } from "vitest";

import { carriesWords } from "../../../../outbound/slack/carriesWords.js";
import { approvalValid, isOptionalString, isParkedDraft } from "../../../../outbound/slack/draftParkedLine.js";
import { draftItem, KNOCK } from "../../supervisor/draftItemFixture.js";

/** Text built from code points, so a character that renders as nothing is still legible in this file. */
const chars = (...codes: number[]): string => String.fromCodePoint(...codes);

/** NEXT LINE (U+0085) and ZERO WIDTH SPACE (U+200B): separators `trim` leaves in place. */
const SEPARATORS = chars(0x85, 0x200b);

describe("isParkedDraft", () => {
  it("vouches for a whole park and refuses one whose approval sits beside a change of meaning", () => {
    const { draft } = draftItem({ approval: KNOCK, id: "sd-c57b4ade", tsIso: "2026-10-08T00:10:00.000Z" });

    expect(isParkedDraft(draft)).toBe(true);
    expect(isParkedDraft({ ...draft, meaningChanged: "the ask moved" })).toBe(false);
    expect(isParkedDraft("sd-c57b4ade")).toBe(false);
  });

  it("reads a group-DM stamp only as a literal true, so no other value exempts a row from the first-message bar", () => {
    const { draft } = draftItem({ id: "sd-c57b4ade", tsIso: "2026-10-08T00:10:00.000Z" });

    expect([true, false, "true", 1].map((groupDm) => isParkedDraft({ ...draft, groupDm }))).toEqual([
      true,
      false,
      false,
      false,
    ]);
  });
});

describe("approvalValid", () => {
  it("reads an absent or whole approval, never a blank change of meaning or an unparseable instant", () => {
    expect(approvalValid({ approval: undefined, meaningChanged: undefined })).toBe(true);
    expect(approvalValid({ approval: undefined, meaningChanged: "the ask moved" })).toBe(true);
    expect(approvalValid({ approval: KNOCK, meaningChanged: undefined })).toBe(true);
    expect(approvalValid({ approval: undefined, meaningChanged: " " })).toBe(false);
    expect(approvalValid({ approval: { ...KNOCK, atIso: "yesterday" }, meaningChanged: undefined })).toBe(false);
    expect(
      approvalValid({ approval: { ...KNOCK, atIso: "2026-02-30T06:00:00.000Z" }, meaningChanged: undefined }),
    ).toBe(false);
    expect(approvalValid({ approval: { ...KNOCK, anchor: "   " }, meaningChanged: undefined })).toBe(false);
    expect(approvalValid({ approval: { ...KNOCK, heard: "   " }, meaningChanged: undefined })).toBe(false);
  });

  it("reads a field of only separators trim misses as blank", () => {
    expect(approvalValid({ approval: { ...KNOCK, anchor: SEPARATORS }, meaningChanged: undefined })).toBe(false);
    expect(approvalValid({ approval: { ...KNOCK, heard: SEPARATORS }, meaningChanged: undefined })).toBe(false);
    expect(approvalValid({ approval: undefined, meaningChanged: SEPARATORS })).toBe(false);
  });
});

describe("carriesWords", () => {
  it("is true for a word, a digit or a lone mark of punctuation, false for only separators", () => {
    const texts = ["yes", "7", chars(0x1f44d), "?", chars(0x85, 0x200b, 0xa0), ""];
    expect(texts.map((text) => carriesWords({ text }))).toEqual([true, true, true, true, false, false]);
  });

  it("is false for invisible marks and fillers Unicode files as letters or marks", () => {
    // COMBINING GRAPHEME JOINER, HANGUL FILLER, a lone COMBINING ACUTE, WORD JOINER + BOM, and the filler before words.
    const texts = [chars(0x34f), chars(0x3164), chars(0x301), chars(0x2060, 0xfeff), `${chars(0x3164)}ok`];
    expect(texts.map((text) => carriesWords({ text }))).toEqual([false, false, false, false, true]);
  });
});

describe("isOptionalString", () => {
  it("is true for absent or a string and false for anything else", () => {
    expect([undefined, "", 0, null].map((field) => isOptionalString(field))).toEqual([true, true, false, false]);
  });
});
