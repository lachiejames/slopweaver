/**
 * The `monitor` noun's manifest: `check` and `filter` write local state, `list` only prints the in-memory monitor
 * declaration (`effect: "none"`). Only `check` acts on a bare run (it is the rehearsal pass). That the manifest
 * imports nothing heavier is `../manifestBarrelClosure.test.ts`'s job.
 */
import { describe, expect, it } from "vitest";

import { monitorManifest } from "../../../../cli/manifests/monitor.js";

import { classificationsOf } from "./_classification.js";

describe("monitorManifest", () => {
  it("declares exactly `check`, `filter` and `list`", () => {
    expect(Object.keys(monitorManifest).toSorted()).toEqual(["check", "filter", "list"]);
  });

  it("pins every verb's six classification fields", () => {
    expect(classificationsOf({ manifest: monitorManifest })).toEqual({
      check: {
        createsWorkItem: false,
        diagnostic: false,
        doorRouted: false,
        dryParseSafe: false,
        effect: "local-state",
        parseRejectIsIoFree: true,
      },
      filter: {
        createsWorkItem: false,
        diagnostic: false,
        doorRouted: false,
        dryParseSafe: true,
        effect: "local-state",
        parseRejectIsIoFree: true,
      },
      list: {
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
