/**
 * The home-rooted legs are exactly the four that walk the home themselves, and every one is a real leg.
 */
import { describe, expect, it } from "vitest";

import { FLEET_LEGS } from "../../../../../cli/commands/store/importFleetUsage.js";
import { HOME_ROOTED_LEGS } from "../../../../../cli/commands/store/importHomeRootedLegs.js";

describe("HOME_ROOTED_LEGS", () => {
  it("names the five legs that read from the home, each one a declared fleet leg", () => {
    expect(Object.keys(HOME_ROOTED_LEGS).toSorted()).toEqual([
      "authored",
      "codex-fallback",
      "grants",
      "measurements",
      "owner-turns",
    ]);
    expect(Object.keys(HOME_ROOTED_LEGS).filter((leg) => !(FLEET_LEGS as readonly string[]).includes(leg))).toEqual([]);
  });
});
