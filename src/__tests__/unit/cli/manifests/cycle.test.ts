/**
 * The `cycle` noun's manifest in `cli/manifests/cycle.ts`: pins the verb set (the bare noun and `reconcile` share one
 * handler) and that both are `local-state`. `--post` is not a write: `reconcileRun.ts` refuses a non-dry-run post and
 * only emits a form, but `--write` publishes the report under the home, and one meta covers every form. Neither is
 * dry-parse safe, because a bare run is the whole pass. The usage is inline and not copied here.
 */
import { describe, expect, it } from "vitest";

import { DEFAULT_VERB } from "../../../../cli/manifest.js";
import { cycleManifest } from "../../../../cli/manifests/cycle.js";
import { classificationsOf } from "./_classification.js";

describe("cycleManifest", () => {
  it("declares exactly the bare noun and reconcile", () => {
    expect(Object.keys(cycleManifest).toSorted()).toEqual([DEFAULT_VERB, "reconcile"]);
  });

  it("classifies both verbs as non-diagnostic local state", () => {
    expect(classificationsOf({ manifest: cycleManifest })).toEqual({
      "": {
        createsWorkItem: false,
        diagnostic: false,
        doorRouted: false,
        dryParseSafe: false,
        effect: "local-state",
        parseRejectIsIoFree: true,
      },
      reconcile: {
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
