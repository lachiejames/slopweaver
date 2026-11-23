/**
 * The product-absence field a manifest may carry on a kind — `src/atlas/kit/productAbsence.ts`.
 */
import { describe, expect, it } from "vitest";

import { atlasProductAbsenceSchema } from "../../../../atlas/kit/productAbsence.js";

describe("atlasProductAbsenceSchema", () => {
  it("accepts an instant and the provider's own answer", () => {
    const parsed = atlasProductAbsenceSchema.safeParse({ at: "2026-09-17T00:00:00.000Z", detail: "answered 404" });
    expect(parsed.success).toBe(true);
  });

  it("refuses an empty answer, since an absence that cannot say what the provider said is a guess", () => {
    const parsed = atlasProductAbsenceSchema.safeParse({ at: "2026-09-17T00:00:00.000Z", detail: "" });
    expect(parsed.success).toBe(false);
  });

  it("refuses a remedy field, because nothing short of adopting the product lifts an absence", () => {
    const parsed = atlasProductAbsenceSchema.safeParse({
      at: "2026-09-17T00:00:00.000Z",
      detail: "answered 404",
      unblockedBy: "a grant",
    });
    expect(parsed.success).toBe(false);
  });
});
