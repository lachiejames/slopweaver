/**
 * The two judgements Canva puts in prose and nowhere else.
 *
 * These are worth testing directly rather than through the registry because they are the only place this
 * atlas READS a natural-language sentence, and the failure mode of getting one wrong is silent: a stable
 * verdict on a preview operation, or a `none` entitlement on one that needs a Canva Enterprise organisation,
 * both look exactly like a correct answer in every downstream view.
 */
import { describe, expect, it } from "vitest";

import { canvaEntitlementFor, canvaStabilityFor } from "../../../../atlas/canva/eligibility.js";

/** The vendor's own preview warning, as it appears in the pinned description. */
const PREVIEW = "<Warning>\n\nThis API is currently provided as a preview. Be aware of the following:\n\n</Warning>";

describe("canvaStabilityFor", () => {
  it("calls an operation with no warning stable", () => {
    expect(canvaStabilityFor({ description: "Lists the user's designs.", name: "listDesigns" })).toBe("stable");
  });

  it("reads a preview out of the warning the vendor actually writes", () => {
    expect(canvaStabilityFor({ description: `${PREVIEW}\n\nGets a thread.`, name: "getThread" })).toBe("preview");
  });

  it("prefers deprecated over preview, because the vendor's deprecation notice says both", () => {
    const description =
      "<Warning>\nThis preview API is deprecated. You should use the Create thread API instead.\n</Warning>";
    expect(canvaStabilityFor({ description, name: "createComment" })).toBe("deprecated");
  });

  it("throws on a warning it cannot classify rather than defaulting to stable", () => {
    expect(() =>
      canvaStabilityFor({ description: "<Warning>\nSomething new.\n</Warning>", name: "someOperation" }),
    ).toThrow("someOperation carries a <Warning> this rule does not classify");
  });

  it("ignores a Note block, which the vendor uses for ordinary guidance", () => {
    expect(canvaStabilityFor({ description: "<Note>\nSee the docs.\n</Note>\n\nDoes a thing.", name: "x" })).toBe(
      "stable",
    );
  });
});

describe("canvaEntitlementFor", () => {
  it("requires nothing beyond a scope when the description carries no availability block", () => {
    expect(canvaEntitlementFor({ description: "Lists designs.", name: "listDesigns" })).toStrictEqual({
      entitlement: "none",
      entitlementBecause: null,
    });
  });

  it("reads a Canva Enterprise requirement, flattening the vendor's own markdown link", () => {
    const description =
      "<Availability>\nTo use this API, your integration must act on behalf of a user who is a member of a [Canva Enterprise](https://www.canva.com/enterprise/) organization.\n</Availability>\n\nGets analytics.";
    const verdict = canvaEntitlementFor({ description, name: "getDesignAnalytics" });
    expect(verdict.entitlement).toBe("enterprise-organization");
    expect(verdict.entitlementBecause).toBe(
      "To use this API, your integration must act on behalf of a user who is a member of a Canva Enterprise organization.",
    );
  });

  it("reads a premium-plan requirement", () => {
    const description =
      "<Availability>\nTo use this API, your integration must act on behalf of a user that's on a Canva plan with premium features (such as Canva Pro).\n</Availability>\n\nResizes.";
    expect(canvaEntitlementFor({ description, name: "createDesignResizeJob" }).entitlement).toBe("premium-plan");
  });

  it("throws on an availability block it cannot classify rather than reporting none", () => {
    expect(() =>
      canvaEntitlementFor({ description: "<Availability>\nAsk your rep.\n</Availability>", name: "someOperation" }),
    ).toThrow("someOperation carries an <Availability> this rule does not classify");
  });
});
