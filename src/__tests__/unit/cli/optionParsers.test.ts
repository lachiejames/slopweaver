import { describe, expect, it } from "vitest";

import {
  flagValueOr,
  nonNegativeIntegerFlag,
  parseFlagTail,
  parsePositiveInteger,
  requiredFlagValue,
  resolveHome,
} from "../../../cli/optionParsers.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";

describe("nonNegativeIntegerFlag", () => {
  it("carries an absent flag as an explicit undefined value", () => {
    expect(nonNegativeIntegerFlag({ name: "limit", values: {} })).toEqual({ value: undefined });
  });

  it("accepts zero, which a positive-integer parser would refuse", () => {
    expect(nonNegativeIntegerFlag({ name: "since", values: { since: "0" } })).toEqual({ value: 0 });
  });

  it("answers a positive whole number as a number", () => {
    expect(nonNegativeIntegerFlag({ name: "limit", values: { limit: "25" } })).toEqual({ value: 25 });
  });

  it("refuses a negative number, quoting what was passed", () => {
    expect(nonNegativeIntegerFlag({ name: "limit", values: { limit: "-1" } })).toEqual({
      error: '--limit must be a non-negative whole number, got "-1"',
    });
  });

  it("refuses a fractional number", () => {
    expect(nonNegativeIntegerFlag({ name: "timeout-seconds", values: { "timeout-seconds": "1.5" } })).toEqual({
      error: '--timeout-seconds must be a non-negative whole number, got "1.5"',
    });
  });

  it("refuses a value that is not a number at all", () => {
    expect(nonNegativeIntegerFlag({ name: "days", values: { days: "soon" } })).toEqual({
      error: '--days must be a non-negative whole number, got "soon"',
    });
  });
});

describe("parsePositiveInteger", () => {
  it("returns the parsed value and pushes no error for a valid positive integer", () => {
    const errors: string[] = [];
    const result = parsePositiveInteger({ errors, label: "--limit", value: "50" });
    expect(result).toBe(50);
    expect(errors.length).toBe(0);
  });

  it("returns undefined rather than a fallback number when the value is not a positive integer", () => {
    const errors: string[] = [];
    const result = parsePositiveInteger({ errors, label: "--limit", value: "-3" });
    expect(result).toBe(undefined);
    expect(errors).toEqual(["--limit must be a positive integer"]);
  });

  it("returns undefined for a non-numeric value", () => {
    const errors: string[] = [];
    const result = parsePositiveInteger({ errors, label: "--days", value: "abc" });
    expect(result).toBe(undefined);
    expect(errors).toEqual(["--days must be a positive integer"]);
  });

  it("returns undefined for zero, which is not positive", () => {
    const errors: string[] = [];
    const result = parsePositiveInteger({ errors, label: "--top", value: "0" });
    expect(result).toBe(undefined);
    expect(errors).toEqual(["--top must be a positive integer"]);
  });
});

describe("flagValueOr", () => {
  it("answers the stated fallback when the flag was not passed", () => {
    const parsed = { flags: new Set<string>(), values: {} };
    expect(flagValueOr({ fallback: "now", name: "to", parsed })).toBe("now");
  });

  it("answers the passed value when the flag carried one", () => {
    const parsed = { flags: new Set<string>(), values: { to: "1h" } };
    expect(flagValueOr({ fallback: "now", name: "to", parsed })).toBe("1h");
  });

  it("keeps an empty value rather than substituting the fallback for it", () => {
    const parsed = { flags: new Set<string>(), values: { to: "" } };
    expect(flagValueOr({ fallback: "now", name: "to", parsed })).toBe("");
  });
});

describe("requiredFlagValue", () => {
  const missing = "--out <dir> is required: where to write";

  it("refuses a flag never passed with the caller's own line", () => {
    const parsed = { flags: new Set<string>(), values: {} };
    expect(unwrapErr(requiredFlagValue({ missing, name: "out", parsed }))).toEqual([missing]);
  });

  it("refuses an empty value with a different line from a missing one", () => {
    const parsed = { flags: new Set<string>(), values: { out: "" } };
    expect(unwrapErr(requiredFlagValue({ missing, name: "out", parsed }))).toEqual([
      "--out was given an empty value — pass the value itself",
    ]);
  });

  it("answers a non-empty value as given", () => {
    const parsed = { flags: new Set<string>(), values: { out: "/tmp/x" } };
    expect(unwrap(requiredFlagValue({ missing, name: "out", parsed }))).toBe("/tmp/x");
  });
});

describe("parseFlagTail", () => {
  it('refuses --policy "" --policy p rather than reading p and losing the empty value', () => {
    expect(unwrapErr(parseFlagTail({ rest: ["--policy", "", "--policy", "p"], spec: { value: ["policy"] } }))).toEqual([
      "--policy was given 2 times — pass it once; the parser would keep only the last and drop the rest",
    ]);
  });

  it("passes a declared repeatable value flag through, keeping one value in the bag", () => {
    const parsed = unwrap(
      parseFlagTail({
        rest: ["--column", "a", "--column", "b", "--json"],
        spec: { boolean: ["json"], repeatable: ["column"], value: ["column"] },
      }),
    );
    expect(parsed.values).toEqual({ column: "b" });
    expect([...parsed.flags]).toEqual(["json"]);
  });
});

describe("resolveHome", () => {
  it("answers the named home verbatim when --home carried one", () => {
    expect(resolveHome({ named: "/tmp/some-home" })).toBe("/tmp/some-home");
  });

  it("answers an empty --home verbatim rather than treating it as absent", () => {
    expect(resolveHome({ named: "" })).toBe("");
  });

  it("falls back to the resolved state home only when --home was not passed at all", () => {
    const named = "/tmp/named-home";
    expect(resolveHome({ named })).toBe(named);
    expect(resolveHome({ named: undefined })).not.toBe(named);
  });
});
