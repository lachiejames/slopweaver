/*
 * The one-line check every incident form field shares: trimmed text, one line, within its cap.
 */
import { describe, expect, it } from "vitest";

import { IncidentNoteErrors } from "../../../incident/errors.js";
import { FINDING_LINE_CAP, line } from "../../../incident/formLine.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";

describe("line", () => {
  it("trims a line within its cap", () => {
    expect(unwrap(line({ cap: 20, field: "meaning", value: "  12 users  " }))).toBe("12 users");
  });

  it("takes a line exactly at the cap", () => {
    const text = "x".repeat(FINDING_LINE_CAP);
    expect(unwrap(line({ cap: FINDING_LINE_CAP, field: "impact", value: text }))).toBe(text);
  });

  it.each([
    { name: "a missing field", value: undefined, why: "is required as text" },
    { name: "blank text", value: "   ", why: "is required as text" },
    { name: "two lines", value: "one\ntwo", why: "is one line" },
    {
      name: "one past the cap",
      value: "x".repeat(21),
      why: `is 21 characters and the cap is 20: "${"x".repeat(21)}…"`,
    },
  ])("refuses $name", ({ value, why }) => {
    expect(unwrapErr(line({ cap: 20, field: "meaning", value }))).toEqual(
      IncidentNoteErrors.formInvalid({ field: "meaning", why }),
    );
  });
});
