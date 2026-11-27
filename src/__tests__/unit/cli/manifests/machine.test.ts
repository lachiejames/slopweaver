/**
 * The `machine` noun's manifest: every gauge samples the host on a bare call, so none of them is dry-parse-safe;
 * `free-disk` alone is, because a bare call names no target and is refused before any read. `unused` reads
 * histories already on disk (`effect: "none"`), `series` rewrites its own ring under the home (`local-state`),
 * `watch` alone creates a work item (it seats an investigation), and `capacity` and `watch` alone are diagnostics.
 * That the manifest imports nothing heavier is `../manifestBarrelClosure.test.ts`'s job.
 */
import { describe, expect, it } from "vitest";

import { machineManifest } from "../../../../cli/manifests/machine.js";

import { classificationsOf } from "./_classification.js";

describe("machineManifest", () => {
  it("declares exactly `capacity`, `dispatches`, `free-disk`, `reap`, `series`, `unused` and `watch`", () => {
    expect(Object.keys(machineManifest).toSorted()).toEqual([
      "capacity",
      "dispatches",
      "free-disk",
      "reap",
      "series",
      "unused",
      "watch",
    ]);
  });

  it("classifies each gauge by what it reads, whether it is a diagnostic, and whether it seats work", () => {
    expect(classificationsOf({ manifest: machineManifest })).toEqual({
      capacity: {
        createsWorkItem: false,
        diagnostic: true,
        doorRouted: false,
        dryParseSafe: false,
        effect: "local-state",
        parseRejectIsIoFree: true,
      },
      dispatches: {
        createsWorkItem: false,
        diagnostic: false,
        doorRouted: false,
        dryParseSafe: false,
        effect: "local-state",
        parseRejectIsIoFree: true,
      },
      "free-disk": {
        createsWorkItem: false,
        diagnostic: false,
        doorRouted: false,
        dryParseSafe: true,
        effect: "local-state",
        parseRejectIsIoFree: true,
      },
      reap: {
        createsWorkItem: false,
        diagnostic: false,
        doorRouted: false,
        dryParseSafe: false,
        effect: "local-state",
        parseRejectIsIoFree: true,
      },
      series: {
        createsWorkItem: false,
        diagnostic: false,
        doorRouted: false,
        dryParseSafe: false,
        effect: "local-state",
        parseRejectIsIoFree: true,
      },
      unused: {
        createsWorkItem: false,
        diagnostic: false,
        doorRouted: false,
        dryParseSafe: false,
        effect: "none",
        parseRejectIsIoFree: true,
      },
      watch: {
        createsWorkItem: true,
        diagnostic: true,
        doorRouted: false,
        dryParseSafe: false,
        effect: "local-state",
        parseRejectIsIoFree: true,
      },
    });
  });
});
