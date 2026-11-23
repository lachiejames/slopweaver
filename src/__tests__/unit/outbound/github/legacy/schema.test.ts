import { describe, expect, it } from "vitest";

import {
  prFormEditSchema,
  stampedBodySchema,
  storedPrFormSchema,
} from "../../../../../outbound/github/legacy/schema.js";
import { FULL_BODY, formOf, MINIMAL_BODY, PROVEN, t } from "./fixtures.js";

describe("stampedBodySchema", () => {
  it("accepts the minimal and the full fixture bodies", () => {
    expect([MINIMAL_BODY, FULL_BODY].map((body) => stampedBodySchema.safeParse(body).success)).toEqual([true, true]);
  });

  it("refuses a field nobody declared rather than dropping it", () => {
    expect(stampedBodySchema.safeParse({ ...MINIMAL_BODY, invented: 1 }).success).toBe(false);
  });

  it("refuses a malformed written-on day", () => {
    expect(stampedBodySchema.safeParse({ ...MINIMAL_BODY, writtenOn: "2026-02-31" }).success).toBe(false);
  });

  it("refuses an empty cell", () => {
    expect(stampedBodySchema.safeParse({ ...MINIMAL_BODY, change: [] }).success).toBe(false);
  });
});

describe("storedPrFormSchema", () => {
  it("accepts a whole form: body, target, title, draft state and day", () => {
    expect(storedPrFormSchema.safeParse(formOf({ body: FULL_BODY })).success).toBe(true);
  });

  it("refuses a form with no target", () => {
    const { target: _target, ...rest } = formOf({ body: MINIMAL_BODY });
    expect(storedPrFormSchema.safeParse(rest).success).toBe(false);
  });

  it("refuses a title spanning two lines", () => {
    expect(storedPrFormSchema.safeParse({ ...formOf({ body: MINIMAL_BODY }), title: "a\nb" }).success).toBe(false);
  });
});

describe("prFormEditSchema", () => {
  it("accepts one field set on its own", () => {
    expect(prFormEditSchema.safeParse({ change: t({ text: "New change." }) }).success).toBe(true);
  });

  it("refuses a misspelled field and the routing fields an edit may not touch", () => {
    expect([
      prFormEditSchema.safeParse({ chnage: t({ text: "x" }) }).success,
      prFormEditSchema.safeParse({ draft: false }).success,
      prFormEditSchema.safeParse({ writtenOn: "2026-10-01" }).success,
    ]).toEqual([false, false, false]);
  });

  it("refuses a field both set and removed, naming it", () => {
    const parsed = prFormEditSchema.safeParse({ proof: FULL_BODY.proof, remove: ["proof"] });
    expect(parsed.error!.issues[0]!.message).toBe(
      "proof is both set and removed. Set it to change it, or remove it to drop it — not both",
    );
  });

  it("refuses an append beside a set of the same field", () => {
    const parsed = prFormEditSchema.safeParse({ appendClaims: [PROVEN], claims: [PROVEN] });
    expect(parsed.error!.issues[0]!.message).toContain("appendClaims adds to claims");
  });

  it("refuses a remove naming a field twice", () => {
    const parsed = prFormEditSchema.safeParse({ remove: ["proof", "proof"] });
    expect(parsed.error!.issues[0]!.message).toBe("remove names a field twice");
  });
});
