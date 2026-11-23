/**
 * The `gold` noun's manifest: `owe` and `settle` append to the gold-debt ledger (local-state) while `debts` only reads
 * it back (`effect: "none"`) — `readGoldDebtLedger` never creates the file. That the manifest imports nothing heavier
 * is `../manifestBarrelClosure.test.ts`'s job.
 */
import { describe, expect, it } from "vitest";

import { goldManifest } from "../../../../cli/manifests/gold.js";

import { classificationsOf } from "./_classification.js";

describe("goldManifest", () => {
  it("declares exactly `debts`, `owe` and `settle`", () => {
    expect(Object.keys(goldManifest).toSorted()).toEqual(["debts", "owe", "settle"]);
  });

  it("classifies the two ledger writers as local-state and the reader as effect-free", () => {
    expect(classificationsOf({ manifest: goldManifest })).toEqual({
      debts: {
        createsWorkItem: false,
        diagnostic: false,
        doorRouted: false,
        dryParseSafe: false,
        effect: "none",
        parseRejectIsIoFree: true,
      },
      owe: {
        createsWorkItem: false,
        diagnostic: false,
        doorRouted: false,
        dryParseSafe: true,
        effect: "local-state",
        parseRejectIsIoFree: true,
      },
      settle: {
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
