/**
 * The firing's two derived keys: the attempt key every caller agrees on without coordinating, and the
 * delivery key a door refusal names.
 */
import { describe, expect, it } from "vitest";

import { slotAttemptKey, slotDeliveryKey } from "../../../../../live/automation/slotLedger.js";
import { RECIPE, SLOT } from "./harness.js";

describe("slotAttemptKey", () => {
  it("derives the same key for the same firing from anywhere, with nothing to agree about", () => {
    expect(slotAttemptKey({ recipeId: RECIPE, slotIso: SLOT })).toBe(
      slotAttemptKey({ recipeId: RECIPE, slotIso: SLOT }),
    );
  });

  it("gives two firings of one row two different keys", () => {
    expect(slotAttemptKey({ recipeId: RECIPE, slotIso: SLOT })).not.toBe(
      slotAttemptKey({ recipeId: RECIPE, slotIso: "2026-09-17T12:00:00.000Z" }),
    );
  });

  it("gives two rows sharing a firing two different keys", () => {
    expect(slotAttemptKey({ recipeId: RECIPE, slotIso: SLOT })).not.toBe(
      slotAttemptKey({ recipeId: "knock-alerts", slotIso: SLOT }),
    );
  });

  it("keeps the raw recipe id off the key, since a definition file chooses that string", () => {
    expect(slotAttemptKey({ recipeId: RECIPE, slotIso: SLOT })).not.toContain(RECIPE);
  });
});

describe("slotDeliveryKey", () => {
  it("prefixes the digest so an operator reading a door refusal can tell what refused", () => {
    expect(slotDeliveryKey({ recipeId: RECIPE, slotIso: SLOT })).toBe(
      `recipe-slot:${slotAttemptKey({ recipeId: RECIPE, slotIso: SLOT })}`,
    );
  });
});
