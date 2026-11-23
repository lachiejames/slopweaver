/**
 * The `fresh-cut` noun's manifest: three local-state verbs and NO bare-noun default, so `slopweaver fresh-cut` prints
 * its verbs and can never start a cut. That the manifest imports nothing heavier is
 * `../manifestBarrelClosure.test.ts`'s job.
 */
import { describe, expect, it } from "vitest";

import { freshCutManifest } from "../../../../cli/manifests/freshCut.js";

import { classificationsOf } from "./_classification.js";

describe("freshCutManifest", () => {
  it("declares exactly `accept`, `produce` and `verify`, with no bare-noun default", () => {
    expect(Object.keys(freshCutManifest).toSorted()).toEqual(["accept", "produce", "verify"]);
  });

  it("classifies every verb as local-state, never an external write, with verify a diagnostic", () => {
    expect(classificationsOf({ manifest: freshCutManifest })).toEqual({
      accept: {
        createsWorkItem: false,
        diagnostic: false,
        doorRouted: false,
        dryParseSafe: true,
        effect: "local-state",
        parseRejectIsIoFree: true,
      },
      produce: {
        createsWorkItem: false,
        diagnostic: false,
        doorRouted: false,
        dryParseSafe: true,
        effect: "local-state",
        parseRejectIsIoFree: true,
      },
      verify: {
        createsWorkItem: false,
        diagnostic: true,
        doorRouted: false,
        dryParseSafe: true,
        effect: "local-state",
        parseRejectIsIoFree: true,
      },
    });
  });
});
