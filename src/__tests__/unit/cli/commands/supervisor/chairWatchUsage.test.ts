/**
 * `supervisor chair-watch`'s usage text: it opens on its own verb and flags, and says the pass judges recorded readings
 * only and never loops, which is what a chair reading `--help` needs before scheduling it.
 */
import { describe, expect, it } from "vitest";

import { CHAIR_WATCH_USAGE } from "../../../../../cli/commands/supervisor/chairWatchUsage.js";

describe("chair-watch usage", () => {
  it("opens on its own verb line", () => {
    expect(CHAIR_WATCH_USAGE.split("\n")[0]).toBe("usage: slopweaver supervisor chair-watch [--home <dir>] [--json]");
  });

  it("says it never probes a plan and never loops", () => {
    expect([
      CHAIR_WATCH_USAGE.includes("so it never probes a plan\nor spends a token"),
      CHAIR_WATCH_USAGE.includes("Never a loop: the control plane calls it on its own timer."),
    ]).toEqual([true, true]);
  });
});
