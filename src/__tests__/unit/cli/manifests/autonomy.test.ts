/**
 * The `autonomy` noun's manifest in `cli/manifests/autonomy.ts`: pins the verb set and each verb's six classification
 * fields. Five verbs write the ledger and are `local-state`; `list` only reads it back and is `none`. Every usage is
 * inline, so there is no independent constant to compare it with and none is copied here.
 */
import { describe, expect, it } from "vitest";

import { autonomyManifest } from "../../../../cli/manifests/autonomy.js";
import { classificationsOf } from "./_classification.js";

describe("autonomyManifest", () => {
  it("declares exactly these verbs", () => {
    expect(Object.keys(autonomyManifest).toSorted()).toEqual([
      "adopt",
      "list",
      "qualify",
      "record",
      "steer",
      "steer-class",
    ]);
  });

  it("classifies the five ledger writers local-state and the read-only list none", () => {
    expect(classificationsOf({ manifest: autonomyManifest })).toEqual({
      adopt: {
        createsWorkItem: false,
        diagnostic: false,
        doorRouted: false,
        dryParseSafe: false,
        effect: "local-state",
        parseRejectIsIoFree: true,
      },
      list: {
        createsWorkItem: false,
        diagnostic: false,
        doorRouted: false,
        dryParseSafe: false,
        effect: "none",
        parseRejectIsIoFree: true,
      },
      qualify: {
        createsWorkItem: false,
        diagnostic: false,
        doorRouted: false,
        dryParseSafe: true,
        effect: "local-state",
        parseRejectIsIoFree: true,
      },
      record: {
        createsWorkItem: false,
        diagnostic: false,
        doorRouted: false,
        dryParseSafe: true,
        effect: "local-state",
        parseRejectIsIoFree: true,
      },
      steer: {
        createsWorkItem: false,
        diagnostic: false,
        doorRouted: false,
        dryParseSafe: true,
        effect: "local-state",
        parseRejectIsIoFree: true,
      },
      "steer-class": {
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
