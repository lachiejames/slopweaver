/**
 * The `proof` noun's manifest: both capture recipes drive a real local process (`vhs`) and so are `local-state`, and
 * both REQUIRE their flags, refusing a bare run before rendering anything. That the manifest imports nothing heavier
 * is `../manifestBarrelClosure.test.ts`'s job.
 */
import { describe, expect, it } from "vitest";

import { proofManifest } from "../../../../cli/manifests/proof.js";

import { classificationsOf } from "./_classification.js";

describe("proofManifest", () => {
  it("declares exactly `cassette` and `yarn-why`", () => {
    expect(Object.keys(proofManifest).toSorted()).toEqual(["cassette", "yarn-why"]);
  });

  it("pins every verb's six classification fields", () => {
    expect(classificationsOf({ manifest: proofManifest })).toEqual({
      cassette: {
        createsWorkItem: false,
        diagnostic: false,
        doorRouted: false,
        dryParseSafe: true,
        effect: "local-state",
        parseRejectIsIoFree: true,
      },
      "yarn-why": {
        createsWorkItem: false,
        diagnostic: false,
        doorRouted: false,
        dryParseSafe: true,
        effect: "local-state",
        parseRejectIsIoFree: true,
      },
    });
  });
});
