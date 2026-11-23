/**
 * The `derive` noun's manifest: the bare noun and `run` are the same verb, and both declare the one classification
 * that differs from its neighbours — `parseRejectIsIoFree: false`, because a rejected `derive` parse is not I/O-free.
 * That the manifest imports nothing heavier is `../manifestBarrelClosure.test.ts`'s job.
 */
import { describe, expect, it } from "vitest";

import { deriveManifest } from "../../../../cli/manifests/derive.js";

import { classificationsOf } from "./_classification.js";

describe("deriveManifest", () => {
  it("declares exactly the bare noun and its `run` alias", () => {
    expect(Object.keys(deriveManifest).toSorted()).toEqual(["", "run"]);
  });

  it("classifies both rows as local-state and neither as parse-reject I/O-free", () => {
    expect(classificationsOf({ manifest: deriveManifest })).toEqual({
      "": {
        createsWorkItem: false,
        diagnostic: false,
        doorRouted: false,
        dryParseSafe: false,
        effect: "local-state",
        parseRejectIsIoFree: false,
      },
      run: {
        createsWorkItem: false,
        diagnostic: false,
        doorRouted: false,
        dryParseSafe: false,
        effect: "local-state",
        parseRejectIsIoFree: false,
      },
    });
  });
});
