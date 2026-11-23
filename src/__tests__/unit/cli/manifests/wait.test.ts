/**
 * The `wait` noun's manifest: one bare-noun verb that waits on a pid or a file and touches nothing
 * (`effect: "none"`); `runWaitWithDeps` refuses a bare run (no `--pid` or `--file`) and an unknown flag before it
 * waits, so it is `dryParseSafe`. That the manifest imports nothing heavier is `../manifestBarrelClosure.test.ts`'s job.
 */
import { describe, expect, it } from "vitest";

import { waitManifest } from "../../../../cli/manifests/wait.js";

import { classificationsOf } from "./_classification.js";

describe("waitManifest", () => {
  it("declares exactly the bare noun", () => {
    expect(Object.keys(waitManifest).toSorted()).toEqual([""]);
  });

  it("classifies the bare noun as effect-free with a parse phase separable from the wait", () => {
    expect(classificationsOf({ manifest: waitManifest })).toEqual({
      "": {
        createsWorkItem: false,
        diagnostic: false,
        doorRouted: false,
        dryParseSafe: true,
        effect: "none",
        parseRejectIsIoFree: true,
      },
    });
  });
});
