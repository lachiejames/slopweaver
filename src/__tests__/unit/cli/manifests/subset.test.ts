/**
 * The `subset` noun's manifest: `build` writes a corpus copy (local-state, refused before any I/O without
 * `--out`), while the bare noun and `status` share one read-only diagnostic whose every flag is optional, so a bare
 * run reads the home's manifest and reports rather than parsing dry. That the manifest imports nothing heavier is
 * `../manifestBarrelClosure.test.ts`'s job.
 */
import { describe, expect, it } from "vitest";

import { subsetManifest } from "../../../../cli/manifests/subset.js";

import { classificationsOf } from "./_classification.js";

describe("subsetManifest", () => {
  it("declares exactly the bare noun, `build` and `status`", () => {
    expect(Object.keys(subsetManifest).toSorted()).toEqual(["", "build", "status"]);
  });

  it("classifies `build` as the one writer and the bare noun and `status` as reports that are not dry parses", () => {
    expect(classificationsOf({ manifest: subsetManifest })).toEqual({
      "": {
        createsWorkItem: false,
        diagnostic: true,
        doorRouted: false,
        dryParseSafe: false,
        effect: "none",
        parseRejectIsIoFree: true,
      },
      build: {
        createsWorkItem: false,
        diagnostic: false,
        doorRouted: false,
        dryParseSafe: true,
        effect: "local-state",
        parseRejectIsIoFree: true,
      },
      status: {
        createsWorkItem: false,
        diagnostic: true,
        doorRouted: false,
        dryParseSafe: false,
        effect: "none",
        parseRejectIsIoFree: true,
      },
    });
  });
});
