/**
 * The `org` noun's manifest rows quote their usage from the leaf the commands print, so the two cannot drift; that
 * the manifest imports nothing heavier is `../manifestBarrelClosure.test.ts`'s job.
 */
import { describe, expect, it } from "vitest";

import { ORG_SET_USAGE, ORG_SHOW_USAGE } from "../../../../cli/commands/org/usage.js";
import { orgManifest } from "../../../../cli/manifests/org.js";

describe("orgManifest", () => {
  it("quotes each verb's usage from its leaf, the constant the command itself prints", () => {
    expect(orgManifest["set"]!.meta.usage).toBe(ORG_SET_USAGE);
    expect(orgManifest["show"]!.meta.usage).toBe(ORG_SHOW_USAGE);
  });

  it("declares set the local-state writer and show effect-free, neither door-routed", () => {
    expect(Object.keys(orgManifest).toSorted()).toEqual(["set", "show"]);
    expect(orgManifest["set"]!.meta.effect).toBe("local-state");
    expect(orgManifest["show"]!.meta.effect).toBe("none");
    expect(orgManifest["set"]!.meta.doorRouted).toBe(false);
    expect(orgManifest["show"]!.meta.doorRouted).toBe(false);
  });
});
