/**
 * The `ruling` event's own schema: a live standing session with or without a bound, and a reconstruction that can
 * neither make one nor be decided at any instant but its source's.
 */
import { describe, expect, it } from "vitest";

import { rulingEventSchema } from "../../../handover/rulingEventSchema.js";

const AT = "2026-11-04T00:34:48.998Z";
const RULING = { anchor: "talk:p9", atIso: AT, decidedIso: AT, kind: "ruling", ruling: "keep that session open" };

describe("rulingEventSchema", () => {
  it("accepts a live standing session, bounded or not, and refuses a bound that is no instant", () => {
    expect([
      rulingEventSchema.safeParse({ ...RULING, standingSession: {} }).success,
      rulingEventSchema.safeParse({ ...RULING, standingSession: { untilIso: AT } }).success,
      rulingEventSchema.safeParse({ ...RULING, standingSession: { untilIso: "soon" } }).success,
    ]).toEqual([true, true, false]);
  });

  it("refuses a reconstruction carrying a standing session, which only the owner's live word can make", () => {
    const backfilled = { ...RULING, backfilledFrom: AT };
    expect([
      rulingEventSchema.safeParse(backfilled).success,
      rulingEventSchema.safeParse({ ...backfilled, standingSession: {} }).success,
    ]).toEqual([true, false]);
  });

  it("accepts either attach-upload verdict on a live ruling and refuses any other shape", () => {
    expect([
      rulingEventSchema.safeParse({ ...RULING, attachUpload: { verdict: "permitted" } }).success,
      rulingEventSchema.safeParse({ ...RULING, attachUpload: { verdict: "refused" } }).success,
      rulingEventSchema.safeParse({ ...RULING, attachUpload: { verdict: "maybe" } }).success,
      rulingEventSchema.safeParse({ ...RULING, attachUpload: { verdict: "permitted", until: AT } }).success,
    ]).toEqual([true, true, false, false]);
  });

  it("refuses a reconstruction carrying an attach-upload verdict, which opens no door", () => {
    const backfilled = { ...RULING, attachUpload: { verdict: "permitted" }, backfilledFrom: AT };
    expect(rulingEventSchema.safeParse(backfilled).success).toBe(false);
  });

  it("refuses a reconstruction decided at any instant but its source's", () => {
    const outranking = { ...RULING, backfilledFrom: "2026-11-03T00:00:00.000Z" };
    expect(rulingEventSchema.safeParse(outranking).success).toBe(false);
  });
});
