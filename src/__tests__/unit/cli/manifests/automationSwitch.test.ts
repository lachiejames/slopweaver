/**
 * `automation enable` and `automation disable` in `cli/manifests/automationSwitch.ts` quote their usage from the leaf
 * the command prints, declare a local-state write routed through no door, and are spread into the automation noun
 * unchanged.
 */
import { describe, expect, it } from "vitest";

import { RECIPE_DISABLE_USAGE, RECIPE_ENABLE_USAGE } from "../../../../cli/commands/automation/switchUsage.js";
import { automationManifest } from "../../../../cli/manifests/automation.js";
import { automationSwitchManifest } from "../../../../cli/manifests/automationSwitch.js";

describe("automationSwitchManifest", () => {
  it("declares exactly the two switch verbs", () => {
    expect(Object.keys(automationSwitchManifest).toSorted((a, b) => a.localeCompare(b))).toEqual(["disable", "enable"]);
  });

  it("quotes each usage from the leaf, so the manifest and --help cannot drift", () => {
    expect([automationSwitchManifest["enable"]!.meta.usage, automationSwitchManifest["disable"]!.meta.usage]).toEqual([
      RECIPE_ENABLE_USAGE,
      RECIPE_DISABLE_USAGE,
    ]);
  });

  it("declares a local-state write with no door, and is spread into the automation noun", () => {
    expect([
      automationSwitchManifest["enable"]!.meta.effect,
      automationSwitchManifest["enable"]!.meta.doorRouted,
    ]).toEqual(["local-state", false]);
    expect(automationManifest["enable"]).toStrictEqual(automationSwitchManifest["enable"]);
    expect(automationManifest["disable"]).toStrictEqual(automationSwitchManifest["disable"]);
  });
});
