/**
 * The `slice` noun's manifest: `capture` writes a slice manifest under the state home (local-state) while the
 * bare noun and `verify` share one read-only diagnostic handler (`effect: "none"`). That the manifest imports
 * nothing heavier is `../manifestBarrelClosure.test.ts`'s job.
 */
import { describe, expect, it } from "vitest";

import { sliceManifest } from "../../../../cli/manifests/slice.js";

import { classificationsOf } from "./_classification.js";

describe("sliceManifest", () => {
  it("declares exactly the bare noun, `capture` and `verify`", () => {
    expect(Object.keys(sliceManifest).toSorted()).toEqual(["", "capture", "verify"]);
  });

  it("classifies `capture` as the one writer and the bare noun and `verify` as effect-free diagnostics", () => {
    expect(classificationsOf({ manifest: sliceManifest })).toEqual({
      "": {
        createsWorkItem: false,
        diagnostic: true,
        doorRouted: false,
        dryParseSafe: true,
        effect: "none",
        parseRejectIsIoFree: true,
      },
      capture: {
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
        effect: "none",
        parseRejectIsIoFree: true,
      },
    });
  });
});
