/**
 * The `fleet` noun's manifest: the readers (`burn`, `ceiling`, `history`, `landed`, `why`) are effect-free
 * diagnostics, `status` alone reaches a remote (external-read), `health` is a local-state diagnostic because its
 * console line files a fetch claim under the home, `configure` and `resume` write local state, and `restore-policy`
 * is a local-state diagnostic (its read mode exits 3 on a finding). Every verb but `configure` acts on a bare run
 * (a read of the home, a ledger or a remote), so only `configure` is dry-parse safe. That the manifest imports nothing
 * heavier is `../manifestBarrelClosure.test.ts`'s job.
 */
import { describe, expect, it } from "vitest";

import { fleetManifest } from "../../../../cli/manifests/fleet.js";

import { classificationsOf } from "./_classification.js";

describe("fleetManifest", () => {
  it("declares exactly the ten fleet verbs", () => {
    expect(Object.keys(fleetManifest).toSorted()).toEqual([
      "burn",
      "ceiling",
      "configure",
      "health",
      "history",
      "landed",
      "restore-policy",
      "resume",
      "status",
      "why",
    ]);
  });

  it("classifies each verb by what it reads or writes and whether it is a diagnostic", () => {
    expect(classificationsOf({ manifest: fleetManifest })).toEqual({
      burn: {
        createsWorkItem: false,
        diagnostic: true,
        doorRouted: false,
        dryParseSafe: false,
        effect: "none",
        parseRejectIsIoFree: true,
      },
      ceiling: {
        createsWorkItem: false,
        diagnostic: true,
        doorRouted: false,
        dryParseSafe: false,
        effect: "local-state",
        parseRejectIsIoFree: true,
      },
      configure: {
        createsWorkItem: false,
        diagnostic: false,
        doorRouted: false,
        dryParseSafe: true,
        effect: "local-state",
        parseRejectIsIoFree: true,
      },
      health: {
        createsWorkItem: false,
        diagnostic: true,
        doorRouted: false,
        dryParseSafe: false,
        effect: "local-state",
        parseRejectIsIoFree: true,
      },
      history: {
        createsWorkItem: false,
        diagnostic: true,
        doorRouted: false,
        dryParseSafe: false,
        effect: "none",
        parseRejectIsIoFree: true,
      },
      landed: {
        createsWorkItem: false,
        diagnostic: true,
        doorRouted: false,
        dryParseSafe: false,
        effect: "none",
        parseRejectIsIoFree: true,
      },
      "restore-policy": {
        createsWorkItem: false,
        diagnostic: true,
        doorRouted: false,
        dryParseSafe: false,
        effect: "local-state",
        parseRejectIsIoFree: true,
      },
      resume: {
        createsWorkItem: false,
        diagnostic: false,
        doorRouted: false,
        dryParseSafe: false,
        effect: "local-state",
        parseRejectIsIoFree: true,
      },
      status: {
        createsWorkItem: false,
        diagnostic: true,
        doorRouted: false,
        dryParseSafe: false,
        effect: "external-read",
        parseRejectIsIoFree: true,
      },
      why: {
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
