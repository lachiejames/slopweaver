/**
 * The hourly fleet-capacity survival read keeps its legacy recipe id and an unchanged definition — so an installed
 * row is neither orphaned nor read as superseded — while its `why` names both providers.
 */
import { describe, expect, it } from "vitest";

import { GENERIC_STANDING_ROWS } from "../../../../live/automation/standingRows.js";

const ROW = GENERIC_STANDING_ROWS.find((row) => row.definition.recipeId === "claude-survival-forecast")!;

describe("the hourly fleet-capacity survival read", () => {
  it("keeps the legacy recipe id and fires fleet-runs-dry alone, hourly", () => {
    expect(ROW.definition.cadence).toBe("17 * * * *");
    expect(ROW.definition.params["argv"]).toEqual([
      "monitor",
      "check",
      "--only",
      "fleet-runs-dry",
      "--fire",
      "--by-session",
      "recipe:claude-survival-forecast",
    ]);
  });

  it("declares no earlier shape, since the stored definition is the current one", () => {
    expect(ROW.supersedes).toBeUndefined();
  });

  it("says what stops happening for both providers", () => {
    expect(ROW.why).toBe(
      "nothing else judges every Claude and Codex plan's capacity together against their resets, so without this " +
        "row a fleet with no route left is found by a seat that cannot start, never by a note naming the reset",
    );
  });
});
