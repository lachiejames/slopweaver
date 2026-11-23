/**
 * How many boots one `handover wake` run may spend: half the boot window's hold, less what already booted in it.
 */
import { describe, expect, it } from "vitest";

import { WAKE_BOOT_SHARE, wakeBootBudget } from "../../../../../cli/commands/handover/wakeBootBudget.js";
import { DEFAULT_RECENT_BOOTS_HOLD } from "../../../../../live/machine/recentBoots.js";

describe("wakeBootBudget", () => {
  it("is half the boot window's hold", () => {
    expect([DEFAULT_RECENT_BOOTS_HOLD, WAKE_BOOT_SHARE]).toEqual([6, 3]);
  });

  it("shrinks by every boot already in flight, never below zero", () => {
    expect([0, 1, 2, 3, 4, 9].map((bootsInFlight) => wakeBootBudget({ bootsInFlight }))).toEqual([3, 2, 1, 0, 0, 0]);
  });
});
