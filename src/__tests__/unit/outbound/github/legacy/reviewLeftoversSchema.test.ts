import { describe, expect, it } from "vitest";

import { reviewLeftoversSchema } from "../../../../../outbound/github/legacy/reviewLeftoversSchema.js";

const ENTRY = { artifactId: "art-1", description: "The retry is unbounded", pass: "pass-2", propertyId: "prop:1" };

const messagesOf = ({ value }: { value: unknown }): readonly string[] =>
  reviewLeftoversSchema.safeParse(value).error!.issues.map((issue) => issue.message);

describe("reviewLeftoversSchema", () => {
  it("accepts one well-formed leftover", () => {
    expect(reviewLeftoversSchema.safeParse([ENTRY]).success).toBe(true);
  });

  it("refuses an empty list", () => {
    expect(reviewLeftoversSchema.safeParse([]).success).toBe(false);
  });

  it("refuses more than thirty-two leftovers", () => {
    const many = Array.from({ length: 33 }, (_, n) => ({ ...ENTRY, artifactId: `art-${String(n)}` }));
    expect(reviewLeftoversSchema.safeParse(many).success).toBe(false);
  });

  it("refuses a description carrying an at-sign, which would notify someone", () => {
    expect(messagesOf({ value: [{ ...ENTRY, description: "ping @someone" }] })[0]).toContain("one plain-text line");
  });

  it("refuses a description with no letter or digit", () => {
    expect(messagesOf({ value: [{ ...ENTRY, description: "..." }] })).toEqual([
      "a leftover's description must say what is still wrong",
    ]);
  });

  it("refuses a token with a slash", () => {
    expect(messagesOf({ value: [{ ...ENTRY, pass: "pass/2" }] })[0]).toContain("the pass is one token");
  });

  it("refuses two leftovers naming the same artifact", () => {
    expect(messagesOf({ value: [ENTRY, { ...ENTRY, description: "Another finding" }] })).toEqual([
      "a leftover names an artifact id another leftover already names",
    ]);
  });
});
