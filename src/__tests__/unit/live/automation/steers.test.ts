/**
 * The recorded owner steers over stopped recipe rows. What matters is WHICH rows a steer covers: the resync steer
 * answers every row whose definition selects the resync kind or runs `automation resync` on verb-run, and nothing
 * named like one that does not.
 */
import { describe, expect, it } from "vitest";

import { RESYNC_KIND } from "../../../../live/automation/kinds.js";
import { RECIPE_STEERS, steerFor } from "../../../../live/automation/steers.js";

import { dailyRow } from "./recipeHome.js";

describe("RECIPE_STEERS", () => {
  it("declares at least one steer, so every guard below is true of something", () => {
    expect(RECIPE_STEERS.length).toBeGreaterThan(0);
  });

  it("declares a unique id, an anchor and the owner's words for each", () => {
    expect(new Set(RECIPE_STEERS.map((steer) => steer.id)).size).toBe(RECIPE_STEERS.length);
    expect(RECIPE_STEERS.filter((steer) => steer.anchor.trim() === "" || steer.words.trim() === "")).toEqual([]);
  });
});

describe("steerFor", () => {
  it("answers the resync steer for a row whose definition selects the resync kind", () => {
    const definition = dailyRow({ kind: RESYNC_KIND, recipeId: "resync-atlas-aether" });
    expect(steerFor({ definition })!.id).toBe("resync-restart");
  });

  // A compile-only atlas's managed row runs in the chair's tick on verb-run, and is one of the same resyncs.
  it("answers the resync steer for a verb-run row whose argv runs recipe resync", () => {
    const definition = dailyRow({
      params: { argv: ["recipe", "resync", "--atlas", "airtable"] },
      recipeId: "resync-atlas-airtable",
    });
    expect(steerFor({ definition })!.id).toBe("resync-restart");
  });

  it("answers the resync steer for a verb-run row whose argv spells the noun automation", () => {
    const definition = dailyRow({
      params: { argv: ["automation", "resync", "--atlas", "airtable"] },
      recipeId: "resync-atlas-airtable",
    });
    expect(steerFor({ definition })!.id).toBe("resync-restart");
  });

  it("answers nothing for a verb-run row whose argv runs another automation verb", () => {
    const definition = dailyRow({ params: { argv: ["automation", "due"] }, recipeId: "automation-due" });
    expect(steerFor({ definition })).toBe(undefined);
  });

  it("answers nothing for a row merely NAMED like a resync, since the kind is what runs", () => {
    expect(steerFor({ definition: dailyRow({ recipeId: "resync-atlas-datadog" }) })).toBe(undefined);
  });

  it("answers nothing for an ordinary row, whose choice is still the owner's", () => {
    expect(steerFor({ definition: dailyRow({ recipeId: "store-backup-daily" }) })).toBe(undefined);
  });
});
