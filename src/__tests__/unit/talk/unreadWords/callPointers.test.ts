/*
 * How one of the owner's words is named: a `talk-call:` pointer written in one form and read back lowercased and
 * trimmed, and every malformed pointer refused.
 */
import { describe, expect, it } from "vitest";

import { formatCallPointer, parseCallPointer } from "../../../../talk/unreadWords.js";
import { CALL } from "./harness.js";

describe("call pointers", () => {
  it("formats and reads back one written form, lowercasing the call id and trimming", () => {
    expect(formatCallPointer({ callId: CALL, segmentId: "segment_0_163" })).toBe(`talk-call:${CALL}#segment_0_163`);
    expect(parseCallPointer({ text: ` talk-call:${CALL.toUpperCase()}#segment_0_163 ` })).toBe(
      `talk-call:${CALL}#segment_0_163`,
    );
  });

  it("reads back punctuation and a segment id at its bound in astral code points", () => {
    const ids = ["a:b,c%d", "\u{1D41A}".repeat(200)];

    expect(ids.map((segmentId) => parseCallPointer({ text: formatCallPointer({ callId: CALL, segmentId }) }))).toEqual(
      ids.map((segmentId) => `talk-call:${CALL}#${segmentId}`),
    );
  });

  it.each([
    ["no scheme", `${CALL}#s`],
    ["no separator", `talk-call:${CALL}`],
    ["an empty segment", `talk-call:${CALL}#`],
    ["a segment with whitespace", `talk-call:${CALL}#a b`],
    ["a segment with a tab", `talk-call:${CALL}#a\tb`],
    ["a segment with a no-break space", `talk-call:${CALL}#a${String.fromCodePoint(0xa0)}b`],
    ["a segment with a line separator", `talk-call:${CALL}#a${String.fromCodePoint(0x2028)}b`],
    ["a segment holding a second separator", `talk-call:${CALL}#a#b`],
    ["a segment past its bound", `talk-call:${CALL}#${"\u{1D41A}".repeat(201)}`],
    ["a call id that is not a v4 uuid", "talk-call:not-a-call#s"],
    ["the turn scheme", `talk:${CALL}`],
  ])("refuses %s", (_label, text) => {
    expect(parseCallPointer({ text })).toBe(undefined);
  });
});
