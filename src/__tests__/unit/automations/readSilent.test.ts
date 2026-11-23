/**
 * The Automations page keeps one silent row per recipe id, and definitions may share one: a row nobody holds must
 * never be displaced by a duplicate's held row, or the held one would paint the unheld stop `running`.
 */
import { describe, expect, it } from "vitest";

import { silentByRecipe } from "../../../automations/readSilent.js";
import type { SilentRow } from "../../../live/automation/silentRows.js";

/** A stopped `dup` row on `cadence`, held by `holder` when one is given. */
function quiet({ cadence, holder }: { cadence: string; holder?: string }): SilentRow {
  return {
    cadence,
    currentSlotHold: holder === undefined ? null : { holder, startedAtIso: "2026-10-15T12:30:05.000Z" },
    detail: `1 slot(s) of \`${cadence}\` went by unrun`,
    lastRunAtIso: "2026-10-13T08:00:00.000Z",
    missedSlots: 1,
    reason: "MISSED",
    recipeId: "dup",
  };
}

describe("silentByRecipe", () => {
  it("keeps the duplicate nobody holds, whichever order the held one comes in", () => {
    const unheld = quiet({ cadence: "0 8 * * *" });
    const held = quiet({ cadence: "30 12 * * *", holder: "seat-b" });

    expect([
      silentByRecipe({ rows: [unheld, held] }).get("dup")!.cadence,
      silentByRecipe({ rows: [held, unheld] }).get("dup")!.cadence,
    ]).toEqual(["0 8 * * *", "0 8 * * *"]);
  });

  it("keeps the later row when neither or both are held", () => {
    const rows = [quiet({ cadence: "0 8 * * *" }), quiet({ cadence: "30 12 * * *" })];
    const held = [quiet({ cadence: "0 8 * * *", holder: "a" }), quiet({ cadence: "30 12 * * *", holder: "b" })];

    expect([silentByRecipe({ rows }).get("dup")!.cadence, silentByRecipe({ rows: held }).get("dup")!.cadence]).toEqual([
      "30 12 * * *",
      "30 12 * * *",
    ]);
  });
});
