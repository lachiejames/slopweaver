/**
 * The daily call reader's standing row: seated as `call-assessment`, settling on a counts-only check under a read
 * effect, and refused when its argv drifts to a verb that sends.
 */
import { describe, expect, it } from "vitest";

import { RECIPE_DEFINITION_SCHEMA_VERSION } from "../../../../live/automation/definition.js";
import { runShapeForKind } from "../../../../live/automation/definitionShape.js";
import { CALL_ASSESSMENT_KIND } from "../../../../live/automation/kinds.js";
import { CALL_ASSESSMENT_DAILY } from "../../../../live/automation/standingCallAssessmentRows.js";
import { GENERIC_STANDING_ROWS } from "../../../../live/automation/standingRows.js";
import { planVerbRun } from "../../../../live/automation/verbRun.js";

describe("CALL_ASSESSMENT_DAILY", () => {
  it("requires the daily call reader, seated as call-assessment, settling on a counts-only check under a read effect", () => {
    expect(GENERIC_STANDING_ROWS).toContain(CALL_ASSESSMENT_DAILY);
    expect(runShapeForKind({ kind: CALL_ASSESSMENT_KIND })).toBe("spawn");
    expect(CALL_ASSESSMENT_DAILY.definition).toEqual({
      cadence: "30 21 * * *",
      destination: { kind: "local-atlas" },
      effect: "read",
      enabled: true,
      kind: CALL_ASSESSMENT_KIND,
      onMissed: "skip",
      params: { argv: ["talk", "assessment-due", "--check"] },
      recipeId: "call-assessment-daily",
      schemaVersion: RECIPE_DEFINITION_SCHEMA_VERSION,
    });
    expect(CALL_ASSESSMENT_DAILY.supersedes).toBeUndefined();
  });

  it("runs the call reader's check itself, and refuses its argv drifted to a verb that sends", () => {
    expect(planVerbRun({ definition: CALL_ASSESSMENT_DAILY.definition }).isOk()).toBe(true);
    const drifted = planVerbRun({
      definition: { ...CALL_ASSESSMENT_DAILY.definition, params: { argv: ["slack", "reply", "--as", "me"] } },
    });
    expect(drifted._unsafeUnwrapErr().code).toBe("EFFECT_EXCEEDS_ROW");
  });
});
