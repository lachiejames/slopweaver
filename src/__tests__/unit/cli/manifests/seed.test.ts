/**
 * The `seed` noun's manifest: the bare noun and `run` share one handler that writes the demo corpus under
 * `--demo` (local-state), and `runSeed` refuses a bare run, `--help` and an unknown flag before it resolves the
 * home, so both are `dryParseSafe`. That the manifest imports nothing heavier is `../manifestBarrelClosure.test.ts`'s job.
 */
import { describe, expect, it } from "vitest";

import { seedManifest } from "../../../../cli/manifests/seed.js";

import { classificationsOf } from "./_classification.js";

describe("seedManifest", () => {
  it("declares exactly the bare noun and `run`", () => {
    expect(Object.keys(seedManifest).toSorted()).toEqual(["", "run"]);
  });

  it("classifies both entries as local-state writers whose bare run is refused before any I/O", () => {
    expect(classificationsOf({ manifest: seedManifest })).toEqual({
      "": {
        createsWorkItem: false,
        diagnostic: false,
        doorRouted: false,
        dryParseSafe: true,
        effect: "local-state",
        parseRejectIsIoFree: true,
      },
      run: {
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
