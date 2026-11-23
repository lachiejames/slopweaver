import { describe, expect, it } from "vitest";

import { spawnHatches } from "../../../cmux/spawnDeps.js";

describe("spawnHatches", () => {
  it("opens neither hatch with no flag and neither variable set", () => {
    expect(spawnHatches({ allowSpentPlan: false, spentPlanEnv: undefined, unreadablePlanEnv: undefined })).toEqual({
      spentPlan: false,
      unreadablePlan: false,
    });
  });

  it("opens the spent-plan hatch alone on the caller's flag", () => {
    expect(spawnHatches({ allowSpentPlan: true, spentPlanEnv: undefined, unreadablePlanEnv: undefined })).toEqual({
      spentPlan: true,
      unreadablePlan: false,
    });
  });

  it("opens the spent-plan hatch on its variable set to 1 when the flag is false, and not on the near-miss true", () => {
    expect(spawnHatches({ allowSpentPlan: false, spentPlanEnv: "1", unreadablePlanEnv: undefined })).toEqual({
      spentPlan: true,
      unreadablePlan: false,
    });
    expect(spawnHatches({ allowSpentPlan: false, spentPlanEnv: "true", unreadablePlanEnv: undefined })).toEqual({
      spentPlan: false,
      unreadablePlan: false,
    });
  });

  it("opens the unreadable-plan hatch alone on its variable set to 1, and not on the near-miss true", () => {
    expect(spawnHatches({ allowSpentPlan: false, spentPlanEnv: undefined, unreadablePlanEnv: "1" })).toEqual({
      spentPlan: false,
      unreadablePlan: true,
    });
    expect(spawnHatches({ allowSpentPlan: false, spentPlanEnv: undefined, unreadablePlanEnv: "true" })).toEqual({
      spentPlan: false,
      unreadablePlan: false,
    });
  });

  it("opens the spent-plan hatch and keeps the unreadable-plan one closed when the flag is set, the spent variable is 1 and the unreadable variable is 0", () => {
    expect(spawnHatches({ allowSpentPlan: true, spentPlanEnv: "1", unreadablePlanEnv: "0" })).toEqual({
      spentPlan: true,
      unreadablePlan: false,
    });
  });
});
