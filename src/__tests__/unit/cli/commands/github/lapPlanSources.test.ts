/*
 * The lap's plan sources carry the lap-seat gate's modules and the list's own module. Without them a running CLI
 * holding a stale gate could let an off-seat session lap while every listed file read the same as the head.
 */

import { describe, expect, it } from "vitest";

import { LAP_PLAN_SOURCES } from "../../../../../cli/commands/github/lapPlanSources.js";

const GITHUB_COMMANDS = "src/cli/commands/github";

describe("LAP_PLAN_SOURCES", () => {
  it("lists each lap-seat gate module and its own module", () => {
    expect(LAP_PLAN_SOURCES).toContain(`${GITHUB_COMMANDS}/lapSeat.ts`);
    expect(LAP_PLAN_SOURCES).toContain(`${GITHUB_COMMANDS}/lapSeatRun.ts`);
    expect(LAP_PLAN_SOURCES).toContain(`${GITHUB_COMMANDS}/lapSeatStore.ts`);
    expect(LAP_PLAN_SOURCES).toContain(`${GITHUB_COMMANDS}/lapSeatUsage.ts`);
    expect(LAP_PLAN_SOURCES).toContain(`${GITHUB_COMMANDS}/lapPlanSources.ts`);
  });
});
