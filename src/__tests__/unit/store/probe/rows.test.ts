/**
 * The three driver-row readers: a required text column throws the statement/reader disagreement, a nullable
 * one answers `null` for anything that is not a string, and a count reads a number or a bigint-style string.
 * The zero and `null` answers on a wrong-typed or malformed value are pinned as the code behaves today.
 */
import { describe, expect, it } from "vitest";

import { numberOf, optionalText, requireText } from "../../../../store/probe/rows.js";

describe("requireText", () => {
  it("returns the column's string exactly", () => {
    expect(requireText({ key: "slug", row: { slug: "alpha-row" } })).toBe("alpha-row");
  });

  it("returns an empty string column as itself rather than refusing it", () => {
    expect(requireText({ key: "slug", row: { slug: "" } })).toBe("");
  });

  it("throws the disagreement naming the column when the column is absent", () => {
    expect(() => requireText({ key: "slug", row: {} })).toThrow(
      'store row has no string "slug" — the statement and the reader disagree',
    );
  });

  it("throws the same disagreement when the column holds a number", () => {
    expect(() => requireText({ key: "count", row: { count: 7 } })).toThrow(
      'store row has no string "count" — the statement and the reader disagree',
    );
  });

  it("throws the same disagreement when the column holds null", () => {
    expect(() => requireText({ key: "slug", row: { slug: null } })).toThrow(
      'store row has no string "slug" — the statement and the reader disagree',
    );
  });
});

describe("optionalText", () => {
  it("returns the column's string exactly", () => {
    expect(optionalText({ key: "note", row: { note: "held" } })).toBe("held");
  });

  it("answers null for an explicit null column", () => {
    expect(optionalText({ key: "note", row: { note: null } })).toBe(null);
  });

  it("answers null for an absent column", () => {
    expect(optionalText({ key: "note", row: {} })).toBe(null);
  });

  it("answers null for a column holding a number, as the code behaves today", () => {
    expect(optionalText({ key: "note", row: { note: 42 } })).toBe(null);
  });
});

describe("numberOf", () => {
  it("returns a finite number as itself", () => {
    expect(numberOf({ key: "n", row: { n: 12.5 } })).toBe(12.5);
  });

  it("returns zero for a zero column", () => {
    expect(numberOf({ key: "n", row: { n: 0 } })).toBe(0);
  });

  it("parses a bigint-style count string", () => {
    expect(numberOf({ key: "n", row: { n: "9007199254740" } })).toBe(9007199254740);
  });

  it("answers zero for a malformed string, as the code behaves today", () => {
    expect(numberOf({ key: "n", row: { n: "twelve" } })).toBe(0);
  });

  it("answers zero for an infinite number, as the code behaves today", () => {
    expect(numberOf({ key: "n", row: { n: Number.POSITIVE_INFINITY } })).toBe(0);
  });

  it("answers zero for an absent column, as the code behaves today", () => {
    expect(numberOf({ key: "n", row: {} })).toBe(0);
  });

  it("answers zero for a boolean column, as the code behaves today", () => {
    expect(numberOf({ key: "n", row: { n: true } })).toBe(0);
  });
});
