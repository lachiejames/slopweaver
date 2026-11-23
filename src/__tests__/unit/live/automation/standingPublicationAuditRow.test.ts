/**
 * The daily publication audit is declared OFF, so landing it fires nothing until the owner turns it on, and it fires
 * the `publication-leak` pass naming no repository.
 */
import { describe, expect, it } from "vitest";

import { unwrap } from "../../../../lib/result.js";
import { RECIPE_DEFINITION_SCHEMA_VERSION } from "../../../../live/automation/definition.js";
import { judgeRecipeDue } from "../../../../live/automation/definitionDue.js";
import { GENERIC_STANDING_ROWS } from "../../../../live/automation/standingRows.js";
import { planVerbRun, VERB_RUN_KIND } from "../../../../live/automation/verbRun.js";

const ROW = GENERIC_STANDING_ROWS.find((d) => d.definition.recipeId === "publication-audit-daily")!;

describe("the daily publication audit row", () => {
  it("declares the daily publication audit OFF, so landing it fires nothing until the owner turns it on", () => {
    // Long past every slot of its cadence and never run: a live row would be due here.
    const verdict = judgeRecipeDue({ definition: ROW.definition, nowIso: "2026-12-01T12:00:00.000Z", run: null });
    expect([verdict.due, verdict.offReason]).toEqual([false, "disabled"]);
    const live = judgeRecipeDue({
      definition: { ...ROW.definition, enabled: true },
      nowIso: "2026-12-01T12:00:00.000Z",
      run: null,
    });
    expect(live.due).toBe(true);
  });

  it("requires the daily publication audit, firing the publication-leak pass and naming no repository", () => {
    expect(ROW.definition).toEqual({
      cadence: "45 5 * * *",
      destination: { kind: "local-atlas" },
      effect: "read-write",
      enabled: false,
      kind: VERB_RUN_KIND,
      onMissed: "skip",
      params: { argv: ["audit", "publications", "--fire", "--by-session", "recipe:publication-audit-daily"] },
      recipeId: "publication-audit-daily",
      schemaVersion: RECIPE_DEFINITION_SCHEMA_VERSION,
    });
    expect(unwrap(planVerbRun({ definition: ROW.definition })).verb).toBe("publications");
  });
});
