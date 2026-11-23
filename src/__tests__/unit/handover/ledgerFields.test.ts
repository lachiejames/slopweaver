/**
 * The five journal field readers, each read for what an ABSENT or malformed field means: text collapses to
 * the empty string, a count to zero, an optional count to absent (so a missing pid is never pid 0), an
 * optional text to absent when blank, and a string list keeps only its string members, in order.
 */
import { describe, expect, it } from "vitest";

import { count, optionalCount, optionalText, stringList, text } from "../../../handover/ledgerFields.js";

describe("text", () => {
  it("keeps a string, the empty one included, and reads anything else as the empty string", () => {
    const payload = { blank: "", missingNot: 7, slug: "fix-the-board" };

    expect(text({ key: "slug", payload })).toBe("fix-the-board");
    expect(text({ key: "blank", payload })).toBe("");
    expect(text({ key: "missingNot", payload })).toBe("");
    expect(text({ key: "absent", payload })).toBe("");
  });
});

describe("count", () => {
  it("keeps zero and a positive finite number as written", () => {
    expect(count({ key: "n", payload: { n: 0 } })).toBe(0);
    expect(count({ key: "n", payload: { n: 12 } })).toBe(12);
  });

  it("reads an absent, non-number, NaN or infinite field as 0", () => {
    const payload = { inf: Number.POSITIVE_INFINITY, nan: Number.NaN, word: "12" };

    expect(["absent", "word", "nan", "inf"].map((key) => count({ key, payload }))).toEqual([0, 0, 0, 0]);
  });
});

describe("optionalCount", () => {
  it("keeps any finite number, zero included, and reads anything else as absent", () => {
    const payload = { inf: Number.NEGATIVE_INFINITY, nan: Number.NaN, pid: 4242, word: "4242", zero: 0 };

    expect(optionalCount({ key: "pid", payload })).toBe(4242);
    expect(optionalCount({ key: "zero", payload })).toBe(0);
    expect(["absent", "word", "nan", "inf"].map((key) => optionalCount({ key, payload }))).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
    ]);
  });
});

describe("optionalText", () => {
  it("keeps a non-blank string untrimmed and reads a blank, whitespace-only or non-string field as absent", () => {
    const payload = { blank: "", number: 3, path: "  /tmp/run  ", spaces: " \t\n" };

    expect(optionalText({ key: "path", payload })).toBe("  /tmp/run  ");
    expect(["blank", "spaces", "number", "absent"].map((key) => optionalText({ key, payload }))).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
    ]);
  });
});

describe("stringList", () => {
  it("keeps the string members in order and drops everything else", () => {
    expect(stringList({ key: "files", payload: { files: ["b.ts", 3, null, "a.ts", ""] } })).toEqual([
      "b.ts",
      "a.ts",
      "",
    ]);
  });

  it("is empty for an absent field or one that is not an array", () => {
    expect(stringList({ key: "files", payload: {} })).toEqual([]);
    expect(stringList({ key: "files", payload: { files: "a.ts" } })).toEqual([]);
  });
});
