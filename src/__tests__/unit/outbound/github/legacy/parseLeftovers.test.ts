/**
 * The leftovers section read back on its own: absent consumes nothing, present reads every entry through the
 * landing verbs' own reader, and a section that is there but does not read is a `STRUCTURE` refusal.
 */
import { describe, expect, it } from "vitest";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";
import { LEFTOVERS_HEADING, leftoverEntryLine } from "../../../../../outbound/github/legacy/leftoverLines.js";
import { leftoversSection } from "../../../../../outbound/github/legacy/parseLeftovers.js";
import { leftoversOpen } from "../../../../../outbound/github/legacy/render.js";

const ENTRY = {
  artifactId: "cr-0001",
  description: "the fold is re-read once per landing",
  pass: "r2",
  propertyId: "r2-01",
};

describe("leftoversSection", () => {
  it("consumes nothing when the body carries no leftovers section", () => {
    const cursor = { at: 0, blocks: ["## What this PR does"] };

    expect(unwrap(leftoversSection({ cursor }))).toBeUndefined();
    expect(cursor.at).toBe(0);
  });

  it("reads every entry under the heading and consumes the whole section", () => {
    const cursor = {
      at: 0,
      blocks: [
        LEFTOVERS_HEADING,
        leftoversOpen({ count: 1 }),
        leftoverEntryLine({ entry: ENTRY }),
        "</details>",
        "next",
      ],
    };

    expect(unwrap(leftoversSection({ cursor }))).toEqual([ENTRY]);
    expect(cursor.at).toBe(4);
  });

  it("refuses a section whose summary counts a different number of entries", () => {
    const cursor = {
      at: 0,
      blocks: [LEFTOVERS_HEADING, leftoversOpen({ count: 2 }), leftoverEntryLine({ entry: ENTRY }), "</details>"],
    };

    expect(unwrapErr(leftoversSection({ cursor })).code).toBe("STRUCTURE");
  });

  it("refuses a section that is never closed", () => {
    const cursor = {
      at: 0,
      blocks: [LEFTOVERS_HEADING, leftoversOpen({ count: 1 }), leftoverEntryLine({ entry: ENTRY })],
    };

    expect(unwrapErr(leftoversSection({ cursor })).code).toBe("STRUCTURE");
  });
});
