import { describe, expect, it } from "vitest";

import { optionalText, requiredText } from "../../../hand/stepText.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";

describe("requiredText", () => {
  it("trims a value and keeps one exactly at the cap", () => {
    expect(unwrap(requiredText({ cap: 5, field: "what", value: "  abcde \n" }))).toBe("abcde");
  });

  it("refuses an empty value by the field's name", () => {
    expect(unwrapErr(requiredText({ cap: 5, field: "witness", value: "   " })).message).toContain(
      "witness is required and was empty",
    );
  });

  it("refuses a value one past the cap rather than truncating it", () => {
    expect(unwrapErr(requiredText({ cap: 5, field: "what", value: "abcdef" })).message).toContain(
      "is 6 characters and the cap is 5",
    );
  });
});

describe("optionalText", () => {
  it("reads an absent or blank value as not supplied", () => {
    expect([
      unwrap(optionalText({ cap: 5, field: "where", value: undefined })),
      unwrap(optionalText({ cap: 5, field: "where", value: "  " })),
    ]).toEqual([undefined, undefined]);
  });

  it("checks a supplied value against the cap", () => {
    expect(unwrap(optionalText({ cap: 5, field: "where", value: " term " }))).toBe("term");
    expect(unwrapErr(optionalText({ cap: 2, field: "where", value: "term" })).message).toContain(
      "is 4 characters and the cap is 2",
    );
  });
});
