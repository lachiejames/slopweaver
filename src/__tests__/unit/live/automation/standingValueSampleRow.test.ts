/**
 * The weekly value-sample standing row: Monday morning, after both weekly transcript passes have run, running the
 * bare `value sample` verb so the week's draw, page and card all come from the one command.
 */
import { describe, expect, it } from "vitest";

import { unwrap } from "../../../../lib/result.js";
import {
  CONTEXT_COST_WEEKLY,
  TOKEN_PASS_WEEKLY,
  VALUE_SAMPLE_WEEKLY,
} from "../../../../live/automation/standingMeasurementRows.js";
import { GENERIC_STANDING_ROWS } from "../../../../live/automation/standingRows.js";
import { planVerbRun } from "../../../../live/automation/verbRun.js";

describe("VALUE_SAMPLE_WEEKLY", () => {
  it("requires the weekly value sample on Monday after both transcript passes, running the bare verb", () => {
    expect(GENERIC_STANDING_ROWS).toContain(VALUE_SAMPLE_WEEKLY);
    expect(VALUE_SAMPLE_WEEKLY.definition.cadence).toBe("0 7 * * 1");
    expect([CONTEXT_COST_WEEKLY.definition.cadence, TOKEN_PASS_WEEKLY.definition.cadence]).toEqual([
      "0 5 * * 1",
      "30 5 * * 1",
    ]);
    expect(VALUE_SAMPLE_WEEKLY.definition.params).toEqual({ argv: ["value", "sample"] });
  });

  it("plans as the value noun's sample verb", () => {
    const plan = unwrap(planVerbRun({ definition: VALUE_SAMPLE_WEEKLY.definition }));
    expect([plan.noun, plan.verb]).toEqual(["value", "sample"]);
  });
});
