/**
 * The `perf` noun's manifest. Every verb is `local-state`: the machine reads under it go through
 * `productionMachineCapacityDeps`, whose disk reading can request a worktree prune. `seat` and `hook` REQUIRE their
 * reference, so they refuse a bare run before spawning anything; the summary (bare noun) and `console` act on a bare
 * run. That the manifest imports nothing heavier is `../manifestBarrelClosure.test.ts`'s job.
 */
import { describe, expect, it } from "vitest";

import { perfManifest } from "../../../../cli/manifests/perf.js";

import { classificationsOf } from "./_classification.js";

describe("perfManifest", () => {
  it("declares exactly the summary default plus `console`, `hook` and `seat`", () => {
    expect(Object.keys(perfManifest).toSorted()).toEqual(["", "console", "hook", "seat"]);
  });

  it("pins every verb's six classification fields", () => {
    expect(classificationsOf({ manifest: perfManifest })).toEqual({
      "": {
        createsWorkItem: false,
        diagnostic: true,
        doorRouted: false,
        dryParseSafe: false,
        effect: "local-state",
        parseRejectIsIoFree: true,
      },
      console: {
        createsWorkItem: false,
        diagnostic: true,
        doorRouted: false,
        dryParseSafe: false,
        effect: "local-state",
        parseRejectIsIoFree: true,
      },
      hook: {
        createsWorkItem: false,
        diagnostic: true,
        doorRouted: false,
        dryParseSafe: true,
        effect: "local-state",
        parseRejectIsIoFree: true,
      },
      seat: {
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
