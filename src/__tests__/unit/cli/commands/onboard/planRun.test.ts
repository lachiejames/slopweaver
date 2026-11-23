import { describe, expect, it } from "vitest";

import { runOnboardPlan } from "../../../../../cli/commands/onboard/planRun.js";
import { EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";

describe("runOnboardPlan", () => {
  it("runs the real full-argv offset for a valid machine plan", () => {
    expect(
      runOnboardPlan(["node", "slopweaver", "onboard", "plan", "--sources", "slack", "--backfill", "90", "--json"]),
    ).toBe(EXIT_OK);
  });

  it("refuses an incomplete plan", () => {
    expect(runOnboardPlan(["node", "slopweaver", "onboard", "plan", "--sources", "github"])).toBe(EXIT_USAGE);
  });
});
