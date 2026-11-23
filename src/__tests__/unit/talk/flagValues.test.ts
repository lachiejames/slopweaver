/*
 * Reading one `talk` flag's value: absent, empty, bad and good.
 */
import { describe, expect, it } from "vitest";

import { flagNames, numberOf, stringOf, stringOr } from "../../../cli/commands/talk/flagValues.js";

describe("stringOf", () => {
  it("keeps a non-empty string and drops an absent, empty or boolean value", () => {
    expect(stringOf({ value: "abc" })).toBe("abc");
    expect(stringOf({ value: "" })).toBe(undefined);
    expect(stringOf({ value: true })).toBe(undefined);
    expect(stringOf({ value: undefined })).toBe(undefined);
  });
});

describe("stringOr", () => {
  it("answers the fallback only when the flag was absent", () => {
    expect(stringOr({ fallback: "p2", value: undefined })).toBe("p2");
    expect(stringOr({ fallback: "p2", value: "p1" })).toBe("p1");
  });
});

describe("numberOf", () => {
  it("parses a whole number and records a bad one against the fallback", () => {
    const problems: string[] = [];
    expect(numberOf({ fallback: 20, name: "--limit", problems, value: "7" })).toBe(7);
    expect(numberOf({ fallback: 20, name: "--limit", problems, value: undefined })).toBe(20);
    expect(numberOf({ fallback: 20, name: "--limit", problems, value: "-1" })).toBe(20);
    expect(numberOf({ fallback: 20, name: "--limit", problems, value: "1.5" })).toBe(20);
    expect(problems).toEqual([
      "--limit must be a non-negative whole number, got -1",
      "--limit must be a non-negative whole number, got 1.5",
    ]);
  });
});

describe("flagNames", () => {
  it("prefixes and sorts both halves of a spec", () => {
    expect(flagNames({ spec: { boolean: ["json"], string: ["session", "home"] } })).toEqual([
      "--home",
      "--json",
      "--session",
    ]);
  });
});
