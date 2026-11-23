/**
 * The unseated-stopped-recipes refusal's text: each arm names what answers it, and the refused arm prints the exact
 * spawn for every row of the set. The gate's verdict is `stoppedRecipeSeat.test.ts`; the close that prints it is
 * `tick/*.test.ts`.
 */
import { describe, expect, it } from "vitest";

import { stoppedRecipesRefusalLines } from "../../../../../cli/commands/supervisor/tickCloseStoppedRecipes.js";

const REPAIR = { episodeKey: "bump-fix-slopweaver-f9f0c5d6eeecb3b9", recipeIds: ["bump-fix-slopweaver"] };

describe("stoppedRecipesRefusalLines", () => {
  it("prints the spawn for each row of a refused set", () => {
    const row = "repair-stopped-recipes-bump-fix-slopweaver-f9f0c5d6eeecb3b9-handoff-9323-tick-4";
    const lines = stoppedRecipesRefusalLines({ verdict: { kind: "refused", repair: REPAIR, rows: [row] } });

    expect(lines).toContain("  spawn its repair row:");
    expect(lines).toContain(`    slopweaver cmux spawn ${row} --model opus`);
  });

  it("says to re-open the tick when no row of the set is on the board", () => {
    const lines = stoppedRecipesRefusalLines({ verdict: { kind: "refused", repair: REPAIR, rows: [] } });

    expect(lines).toContain("  no repair row is on the board — re-open the tick to register one, or hold the set:");
    expect(lines.filter((line) => line.includes("cmux spawn"))).toEqual([]);
  });

  it("says neither a spawn nor a hold answers a set it could not judge", () => {
    const lines = stoppedRecipesRefusalLines({
      verdict: { kind: "unreadable", why: "the reconcile reading did not complete" },
    });

    expect(lines.at(-1)).toBe(
      "Re-open the tick with this checkout so its recipe-stopped and reconcile readings complete. Neither a spawn nor " +
        "a hold answers THIS arm — the gate refuses before it reads either.",
    );
  });
});
