/**
 * The `checkout` noun's manifest in `cli/manifests/checkout.ts`: pins the verb set and each verb's six classification
 * fields — `console` fetches and files its fetch claim under the home, `status` is the one diagnostic and is local
 * state because `--fetch` moves remote-tracking refs, `sync` writes local state. Every verb acts on a bare run, so
 * none is dry-parse safe.
 * Usage strings are inline and not copied here.
 */
import { describe, expect, it } from "vitest";

import { checkoutManifest } from "../../../../cli/manifests/checkout.js";
import { classificationsOf } from "./_classification.js";

describe("checkoutManifest", () => {
  it("declares exactly these verbs", () => {
    expect(Object.keys(checkoutManifest).toSorted()).toEqual(["console", "status", "sync"]);
  });

  it("classifies each verb by its own effect and diagnostic fields", () => {
    expect(classificationsOf({ manifest: checkoutManifest })).toEqual({
      console: {
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
        effect: "local-state",
        parseRejectIsIoFree: true,
      },
      sync: {
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
