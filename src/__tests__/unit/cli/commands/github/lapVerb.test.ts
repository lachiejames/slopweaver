import { describe, expect, it } from "vitest";

import { verbExit } from "../../../../../cli/commands/github/lapVerb.js";

describe("verbExit", () => {
  const timedOut = Object.assign(new Error("spawnSync slopweaver ETIMEDOUT"), { code: "ETIMEDOUT" });

  it("reports a verb killed at the ceiling as 124 with a line naming the verb and the ceiling, never 127", () => {
    expect(verbExit({ ceilingMs: 45 * 60_000, run: { error: timedOut, status: null }, verb: "github merge" })).toEqual({
      exitCode: 124,
      line: "github lap: `slopweaver github merge` was killed at the lap's 45-minute verb ceiling before it finished — whether it acted first is unknown, so read the pull request before running it again",
    });
  });

  it("keeps 127 for a verb that never started, with no ceiling line", () => {
    const missing = Object.assign(new Error("spawnSync slopweaver ENOENT"), { code: "ENOENT" });
    expect(verbExit({ ceilingMs: 60_000, run: { error: missing, status: null }, verb: "github merge" })).toEqual({
      exitCode: 127,
      line: undefined,
    });
  });

  it("answers a finished verb's own code, and 1 for one a signal ended", () => {
    expect(verbExit({ ceilingMs: 60_000, run: { status: 3 }, verb: "github hold" }).exitCode).toBe(3);
    expect(verbExit({ ceilingMs: 60_000, run: { status: null }, verb: "github hold" }).exitCode).toBe(1);
  });
});
