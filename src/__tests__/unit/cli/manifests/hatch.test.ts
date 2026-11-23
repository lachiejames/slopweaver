/**
 * The `hatch` noun's manifest: `open` writes one grant line under the home (local-state, not door-routed — routing
 * the escape through the door whose refusals it opens would wedge it), while `list` is an effect-free diagnostic.
 * That the manifest imports nothing heavier is `../manifestBarrelClosure.test.ts`'s job.
 */
import { describe, expect, it } from "vitest";

import { hatchManifest } from "../../../../cli/manifests/hatch.js";

import { classificationsOf } from "./_classification.js";

describe("hatchManifest", () => {
  it("declares exactly `list` and `open`", () => {
    expect(Object.keys(hatchManifest).toSorted()).toEqual(["list", "open"]);
  });

  it("classifies `list` as an effect-free diagnostic and `open` as an un-door-routed local-state write", () => {
    expect(classificationsOf({ manifest: hatchManifest })).toEqual({
      list: {
        createsWorkItem: false,
        diagnostic: true,
        doorRouted: false,
        dryParseSafe: false,
        effect: "none",
        parseRejectIsIoFree: true,
      },
      open: {
        createsWorkItem: false,
        diagnostic: false,
        doorRouted: false,
        dryParseSafe: false,
        effect: "local-state",
        parseRejectIsIoFree: true,
      },
    });
  });
});
