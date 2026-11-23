/**
 * The `machine` noun's manifest: every verb is a gauge of the host and none is dry-parse-safe (a bare call samples the
 * machine). `unused` reads histories already on disk (`effect: "none"`), `series` rewrites its own ring under the
 * home (`local-state`), `watch` alone creates a work item (it seats an
 * investigation), and `capacity` and `watch` alone are diagnostics. That the manifest imports nothing heavier is
 * `../manifestBarrelClosure.test.ts`'s job.
 */
import { describe, expect, it } from "vitest";

import { machineManifest } from "../../../../cli/manifests/machine.js";

import { classificationsOf } from "./_classification.js";

describe("machineManifest", () => {
  it("declares exactly `capacity`, `dispatches`, `reap`, `series`, `unused` and `watch`", () => {
    expect(Object.keys(machineManifest).toSorted()).toEqual([
      "capacity",
      "dispatches",
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
