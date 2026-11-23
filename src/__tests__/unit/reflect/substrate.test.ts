import { describe, expect, it } from "vitest";

import { classKeyOf } from "../../../reflect/finding.js";
import { classOr, classOrOther, jsonlRecords } from "../../../reflect/substrate.js";

describe("jsonlRecords", () => {
  it("decodes a well-formed line normally", () => {
    const { records, skipped } = jsonlRecords({ text: JSON.stringify({ a: 1 }) });
    expect(records).toStrictEqual([{ a: 1 }]);
    expect(skipped).toBe(0);
  });

  it("recovers a line truncated exactly one byte short of its closing brace", () => {
    const whole = JSON.stringify({ at: "2026-08-28T02:00:00Z", error: "gone", what: "a probe" });
    const truncated = whole.slice(0, -1);
    const { records, skipped } = jsonlRecords({ text: truncated });
    expect(records).toStrictEqual([{ at: "2026-08-28T02:00:00Z", error: "gone", what: "a probe" }]);
    expect(skipped).toBe(0);
  });

  it("still counts a line broken any other way as skipped rather than guessing at it", () => {
    const { records, skipped } = jsonlRecords({ text: '{"at": "broken, no value' });
    expect(records).toStrictEqual([]);
    expect(skipped).toBe(1);
  });

  it("skips a line that decodes to something other than an object, brace repair included", () => {
    const { records, skipped } = jsonlRecords({ text: "[1,2,3" });
    expect(records).toStrictEqual([]);
    expect(skipped).toBe(1);
  });
});

describe("classOrOther", () => {
  it("returns the named class when one matches", () => {
    expect(classOrOther({ empty: "e", other: "o", text: "owner ruling arrived mid-run" })).toBe(
      "owner-ruling-arrived-mid-run",
    );
  });

  it("returns the stated other class for unmatched, non-empty prose", () => {
    const text = "wrote the four TLDRs to a durable artifact and linked it";
    expect(classOrOther({ empty: "e", other: "o", text })).toBe("o");
  });

  it("returns the stated empty class when nothing is classifiable at all", () => {
    expect(classOrOther({ empty: "e", other: "o", text: "the and 12 99" })).toBe("e");
  });

  it("never falls back to the general token mash, unlike classOr", () => {
    const text = "wrote the four TLDRs to a durable artifact and linked it";
    expect(classOr({ fallback: "e", text })).toBe(classKeyOf({ text }));
    expect(classOrOther({ empty: "e", other: "o", text })).not.toBe(classKeyOf({ text }));
  });
});
