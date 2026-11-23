/**
 * The `velocity` noun's manifest: the bare noun and `run` share one read-only handler (`effect: "none"`), but
 * every flag is optional, so a bare run reads git and the ledgers and prints a report and is not `dryParseSafe`.
 * That the manifest imports nothing heavier is `../manifestBarrelClosure.test.ts`'s job.
 */
import { describe, expect, it } from "vitest";

import { velocityManifest } from "../../../../cli/manifests/velocity.js";

import { classificationsOf } from "./_classification.js";

describe("velocityManifest", () => {
  it("declares exactly the bare noun and `run`", () => {
    expect(Object.keys(velocityManifest).toSorted()).toEqual(["", "run"]);
  });

  it("classifies both entries as effect-free reports whose bare run is not a dry parse", () => {
    expect(classificationsOf({ manifest: velocityManifest })).toEqual({
      "": {
        createsWorkItem: false,
        diagnostic: false,
        doorRouted: false,
        dryParseSafe: false,
        effect: "none",
        parseRejectIsIoFree: true,
      },
      run: {
        createsWorkItem: false,
        diagnostic: false,
        doorRouted: false,
        dryParseSafe: false,
        effect: "none",
        parseRejectIsIoFree: true,
      },
    });
  });
});
