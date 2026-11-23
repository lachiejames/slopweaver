/*
 * The console prints a card's not-confirmed reason on its Facts line and hover only when it is one the producers write,
 * so its restated list (`site/lib/cardCurrency.ts`) must equal the producers' own (`src/handover/currency.ts`): a phrase
 * the console lacked would drop a real reason to the staleness mark, and one it held that no producer writes would be a
 * hole nothing exercises. The done-check's kind is held the same way, since a console that spelled it otherwise
 * would drop a recorded reading's done-check. In the src lane, the site module imported at run time by address, because `src/`'s `rootDir`
 * may not contain a `site/` file (TS6059).
 */

import { describe, expect, it } from "vitest";

import { NOT_CONFIRMED_WHYS, OWNER_RULING_DONE_KIND } from "../../handover/currency.js";

const CARD_CURRENCY = new URL("../../../site/lib/cardCurrency.ts", import.meta.url).href;

/**
 * Whether a module exposes the site's `NOT_CONFIRMED_WHYS` list.
 *
 * @param module what the run-time import returned
 * @returns true when it carries that list as an array
 */
function hasWhys(module: unknown): module is { NOT_CONFIRMED_WHYS: readonly unknown[] } {
  return (
    typeof module === "object" &&
    module !== null &&
    "NOT_CONFIRMED_WHYS" in module &&
    Array.isArray(module.NOT_CONFIRMED_WHYS)
  );
}

/**
 * Whether a module exposes the site's `OWNER_RULING_DONE_KIND`.
 *
 * @param module what the run-time import returned
 * @returns true when it carries that kind as a string
 */
function hasRulingKind(module: unknown): module is { OWNER_RULING_DONE_KIND: string } {
  return (
    typeof module === "object" &&
    module !== null &&
    "OWNER_RULING_DONE_KIND" in module &&
    typeof module.OWNER_RULING_DONE_KIND === "string"
  );
}

describe("the console's not-confirmed reasons mirror the producers'", () => {
  it("holds exactly the producers' phrases, in their order", async () => {
    const site: unknown = await import(CARD_CURRENCY);
    expect(hasWhys(site)).toBe(true);
    expect(NOT_CONFIRMED_WHYS.length).toBeGreaterThan(0);
    expect((site as { NOT_CONFIRMED_WHYS: readonly unknown[] }).NOT_CONFIRMED_WHYS).toEqual([...NOT_CONFIRMED_WHYS]);
  });

  it("holds the producers' kind for a ruling's done-check", async () => {
    const site: unknown = await import(CARD_CURRENCY);
    expect(hasRulingKind(site)).toBe(true);
    expect((site as { OWNER_RULING_DONE_KIND: unknown }).OWNER_RULING_DONE_KIND).toBe(OWNER_RULING_DONE_KIND);
  });
});
