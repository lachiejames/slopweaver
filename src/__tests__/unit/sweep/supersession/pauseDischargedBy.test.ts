/*
 * Whether a newer top-up generation discharges a paused row: only a pause on that exact recipe's next firing, set
 * before the newer generation fired and carrying an instant that parses exactly, is discharged.
 */
import { describe, expect, it } from "vitest";

import { pauseDischargedBy } from "../../../../sweep/supersession.js";

describe("pauseDischargedBy", () => {
  const NEW = "vulnerability-fix-topup-acme-acme-admin-1792411589626";
  const RECIPE_ID = "vulnerability-fix-topup-acme-admin";
  const RECIPE = "the vulnerability-fix-topup-acme-admin recipe's next firing";
  const SINCE = "2026-10-18T20:44:52.015Z";
  const discharged = ({ pausedOn, pausedSince = SINCE }: { pausedOn: string; pausedSince?: string }): boolean =>
    pauseDischargedBy({ doc: { pausedOn, pausedSince }, newerSlug: NEW, recipe: RECIPE_ID });

  // The measured pause's words and instant, naming the recipe by the current `slugStem` the reader matches on.
  it("discharges the measured pause on the recipe's next firing, set before that firing ran", () => {
    expect(discharged({ pausedOn: RECIPE })).toBe(true);
  });

  it("discharges the same words in another casing, or with surrounding space", () => {
    expect(discharged({ pausedOn: "  The VULNERABILITY-FIX-TOPUP-ACME-ADMIN recipe's next firing " })).toBe(true);
  });

  it("never discharges a pause on a person", () => {
    expect(discharged({ pausedOn: "a colleague's review" })).toBe(false);
  });

  it.each([
    [
      "a person's review that names the recipe",
      "Alice's review of whether the vulnerability-fix-topup-acme-admin recipe is safe",
    ],
    ["a review of the firing itself", "a review of the vulnerability-fix-topup-acme-admin recipe's next firing"],
    [
      "an investigation that names the recipe",
      "investigating why the vulnerability-fix-topup-acme-admin recipe's next firing failed",
    ],
    ["a recipe held until re-enabled", "the vulnerability-fix-topup-acme-admin recipe being re-enabled"],
    ["the same top-up on another repository", "the vulnerability-fix-topup-acme-app recipe's next firing"],
    ["the bare top-up stem", "the vulnerability-fix-topup recipe's next firing"],
  ])("never discharges %s, though it mentions the top-up", (_label, pausedOn) => {
    expect(discharged({ pausedOn })).toBe(false);
  });

  it("never discharges a pause set after the newer generation fired", () => {
    expect(discharged({ pausedOn: RECIPE, pausedSince: "2026-10-19T12:06:30.000Z" })).toBe(false);
  });

  it("never discharges a pause with no instant, or one that does not parse exactly", () => {
    expect(
      pauseDischargedBy({ doc: { pausedOn: RECIPE, pausedSince: undefined }, newerSlug: NEW, recipe: RECIPE_ID }),
    ).toBe(false);
    expect(discharged({ pausedOn: RECIPE, pausedSince: "2026-02-30T00:00:00Z" })).toBe(false);
  });
});
