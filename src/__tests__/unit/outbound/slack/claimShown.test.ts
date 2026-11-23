/**
 * What a stored message shows a reader: the fallbacks the edit rewrites, and whether one of them reads corrected.
 */
import { describe, expect, it } from "vitest";

import { fallbackCorrected, fallbacksOf, notExactlyOnce } from "../../../../outbound/slack/claimShown.js";

describe("fallbacksOf", () => {
  it("lists the message text first, then each attachment fallback, skipping an attachment without one", () => {
    const attachments = [{ fallback: "first" }, { text: "no fallback" }, "not a record", { fallback: "second" }];
    expect(fallbacksOf({ attachments, text: "top" })).toEqual(["top", "first", "second"]);
  });
});

describe("fallbackCorrected", () => {
  const wrong = "she is NZ staff";
  const line = "she resolves in the AU lookup";

  it.each<[string, boolean]>([
    [`Correction: ${line}`, true],
    [`We checked: ~${wrong}~.\n*Correction:* ${line}`, true],
    [`We checked: ${wrong}.\n*Correction:* ${line}`, false],
    [`We checked: ~${wrong}~.`, false],
    [`*Correction:* earlier\n~${wrong}~\n*Correction:* ${line}`, false],
  ])("%j reads corrected: %s", (fallback, expected) => {
    expect(fallbackCorrected({ fallback, line, wrong })).toBe(expected);
  });
});

describe("notExactlyOnce", () => {
  it("counts the text when there are no blocks", () => {
    expect(notExactlyOnce({ allBlocks: [], text: "a b a", wrong: "a" })!.code).toBe("CLAIM_AMBIGUOUS");
    expect(notExactlyOnce({ allBlocks: [], text: "b", wrong: "a" })!.code).toBe("CLAIM_NOT_FOUND");
    expect(notExactlyOnce({ allBlocks: [], text: "a b", wrong: "a" })).toBeUndefined();
  });
});
