/**
 * Which share of its WEEK a plan's usage limit sets: the limit on a weekly-window plan, and the whole week on a
 * monthly-spend one, whose limit is a share of the month's spend.
 */
import { describe, expect, it } from "vitest";

import { NO_USAGE_LIMIT, WEEKLY_WINDOW, weeklyUsageLimitOf } from "../../../plans/usageLimit.js";

describe("weeklyUsageLimitOf", () => {
  it("is the plan's own limit on a weekly-window plan", () => {
    expect(weeklyUsageLimitOf({ allowance: WEEKLY_WINDOW, usageLimitPercent: 50 })).toBe(50);
  });

  it("is the whole week on a monthly-spend plan, however low its limit", () => {
    expect(weeklyUsageLimitOf({ allowance: { kind: "monthly-spend" }, usageLimitPercent: 10 })).toBe(NO_USAGE_LIMIT);
  });
});
