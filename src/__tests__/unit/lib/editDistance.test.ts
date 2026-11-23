import { describe, expect, it } from "vitest";
import { levenshteinDistance, stringSimilarity } from "#lib/editDistance.js";

describe("levenshteinDistance", () => {
  it("is zero for identical strings", () => {
    expect(levenshteinDistance({ left: "tobin barton", right: "tobin barton" })).toBe(0);
  });

  it("counts the two substitutions the Tobyn Barten miss costs", () => {
    expect(levenshteinDistance({ left: "tobyn barten", right: "tobin barton" })).toBe(2);
  });

  it("is the other string's length when one side is empty, from either side", () => {
    expect(levenshteinDistance({ left: "", right: "ada" })).toBe(3);
    expect(levenshteinDistance({ left: "ada", right: "" })).toBe(3);
  });

  it("is symmetric", () => {
    expect(levenshteinDistance({ left: "kitten", right: "sitting" })).toBe(3);
    expect(levenshteinDistance({ left: "sitting", right: "kitten" })).toBe(3);
  });

  it("counts a single transposition as two edits, which is what a rolling-row Levenshtein means", () => {
    expect(levenshteinDistance({ left: "ab", right: "ba" })).toBe(2);
  });
});

describe("stringSimilarity", () => {
  it("is 1 for identical strings, including two empty ones", () => {
    expect(stringSimilarity({ left: "ada", right: "ada" })).toBe(1);
    expect(stringSimilarity({ left: "", right: "" })).toBe(1);
  });

  it("is 0 when only one side is empty", () => {
    expect(stringSimilarity({ left: "", right: "ada" })).toBe(0);
  });

  it("expresses the distance as a fraction of the longer string", () => {
    // "abcd" -> "abcx": one edit over four characters.
    expect(stringSimilarity({ left: "abcd", right: "abcx" })).toBe(0.75);
  });
});
