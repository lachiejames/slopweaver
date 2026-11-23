/**
 * The fleet-ceiling standing row: a daily local page, never Slack, keeping the recipe id the Monday Slack row held
 * so an install's stored row is brought forward rather than doubled.
 */
import { describe, expect, it } from "vitest";

import { unwrap } from "../../../../lib/result.js";
import { runShapeForKind } from "../../../../live/automation/definitionShape.js";
import { planFleetCeilingReport } from "../../../../live/automation/fleetCeilingReport.js";
import { FLEET_CEILING_REPORT_KIND } from "../../../../live/automation/kinds.js";
import { FLEET_CEILING_DAILY } from "../../../../live/automation/standingMeasurementRows.js";
import { GENERIC_STANDING_ROWS } from "../../../../live/automation/standingRows.js";

describe("FLEET_CEILING_DAILY", () => {
  it("requires the unused-usage report DAILY as a local page, run here, measuring seven days", () => {
    expect(GENERIC_STANDING_ROWS).toContain(FLEET_CEILING_DAILY);
    expect(FLEET_CEILING_DAILY.definition.kind).toBe(FLEET_CEILING_REPORT_KIND);
    expect(runShapeForKind({ kind: FLEET_CEILING_REPORT_KIND })).toBe("run-here");
    expect(FLEET_CEILING_DAILY.definition.cadence).toBe("0 6 * * *");
    expect(FLEET_CEILING_DAILY.definition.destination).toEqual({ kind: "local-page" });
    expect(FLEET_CEILING_DAILY.definition.params).toEqual({ days: 7 });
    expect(unwrap(planFleetCeilingReport({ definition: FLEET_CEILING_DAILY.definition })).days).toBe(7);
  });

  it("keeps the recipe id and supersedes the Monday Slack row, so an install's stored row is brought forward", () => {
    expect(FLEET_CEILING_DAILY.definition.recipeId).toBe("fleet-ceiling-weekly");
    expect(FLEET_CEILING_DAILY.supersedes).toEqual([
      { ...FLEET_CEILING_DAILY.definition, cadence: "0 6 * * 1", destination: { kind: "slack" } },
    ]);
  });
});
