import { describe, expect, it } from "vitest";

import { FIGMA_FIELD_DENIALS, figmaFieldIsWithheld } from "../../../../atlas/figma/sensitiveFields.js";

describe("withholding a Figma response field", () => {
  it("withholds a webhook's shared secret", () => {
    const denial = figmaFieldIsWithheld({ field: "passcode", kind: "webhook" });

    expect(denial!.field).toBe("passcode");
    expect(denial!.reason).toContain("forge a delivery");
  });

  // The whole reason denials name a KIND: on Figma a `key` is the platform's own stable public identifier
  // for a component, style, variable or file. Denying on the substring would delete most of this atlas.
  it("withholds nothing named `key`, because on this platform a key is a public identifier", () => {
    expect(figmaFieldIsWithheld({ field: "key", kind: "component" })).toBe(null);
    expect(figmaFieldIsWithheld({ field: "key", kind: "style" })).toBe(null);
    expect(figmaFieldIsWithheld({ field: "key", kind: "variable" })).toBe(null);
    expect(figmaFieldIsWithheld({ field: "file_key", kind: "file" })).toBe(null);
  });

  it("withholds a name only under the kinds it was judged against", () => {
    expect(figmaFieldIsWithheld({ field: "passcode", kind: "file" })).toBe(null);
  });

  it("gives every denial a reason a reader can disagree with", () => {
    const unreasoned = FIGMA_FIELD_DENIALS.filter((denial) => denial.reason.length === 0);
    const universal = FIGMA_FIELD_DENIALS.filter((denial) => denial.kinds.length === 0);

    expect(unreasoned.map((denial) => denial.field)).toEqual([]);
    expect(universal.map((denial) => denial.field)).toEqual([]);
  });
});
