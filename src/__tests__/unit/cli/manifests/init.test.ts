/**
 * The `init` noun's manifest: the bare noun and `run` are the same scaffolding verb, a local-state write whose
 * bare call is not no-args-safe (it scaffolds) but whose parse-reject path is I/O-free. That the manifest imports
 * nothing heavier is `../manifestBarrelClosure.test.ts`'s job.
 */
import { describe, expect, it } from "vitest";

import { initManifest } from "../../../../cli/manifests/init.js";

import { classificationsOf } from "./_classification.js";

describe("initManifest", () => {
  it("declares exactly the bare noun and its `run` alias", () => {
    expect(Object.keys(initManifest).toSorted()).toEqual(["", "run"]);
  });

  it("classifies both rows as local-state, not dry-parse-safe, with an I/O-free parse reject", () => {
    expect(classificationsOf({ manifest: initManifest })).toEqual({
      "": {
        createsWorkItem: false,
        diagnostic: false,
        doorRouted: false,
        dryParseSafe: false,
        effect: "local-state",
        parseRejectIsIoFree: true,
      },
      run: {
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
