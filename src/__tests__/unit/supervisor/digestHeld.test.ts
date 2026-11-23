/**
 * The digest's `held:` line, read directly: it says what the board holds beside the ready count, and says
 * UNKNOWN, never nothing, when the reconciliation will not read.
 */
import { describe, expect, it } from "vitest";

import { heldLines } from "../../../supervisor/digestHeld.js";
import type { DigestInputs, DigestReading } from "../../../supervisor/digestRead.js";

/** Digest inputs over the given readings, with nothing held by a previous pass. */
const inputsOf = ({ readings }: { readings: ReadonlyMap<string, DigestReading> }): DigestInputs => ({
  openPagesAgeMinutes: undefined,
  priorHolds: { kind: "none" },
  readings,
  recipeFixCheckout: { kind: "resolved", path: "/c/slopweaver" },
  runAgeMinutes: undefined,
});

describe("heldLines", () => {
  it("says what the board holds beside the ready count — shrunk", () => {
    const reconcile: DigestReading = {
      kind: "json",
      value: {
        held: [
          { id: "land-acme-1", standing: "blocked" },
          { id: "land-acme-2", standing: "blocked" },
          { id: "ask-acme-3", standing: "waiting-on-owner" },
          { id: "run-acme-4", standing: "in-flight" },
        ],
        rankedCount: 6,
        ready: [{ id: "fix-acme-5" }, { id: "fix-acme-6" }],
        repolessRows: ["land-acme-1", "land-acme-2"],
        trunkMovedRows: [],
      },
    };

    expect(heldLines({ inputs: inputsOf({ readings: new Map([["reconcile", reconcile]]) }) })).toEqual([
      "held: 6 open: 2 ready, 2 held only for naming no repo: (handover set-repo <slug> --repo <dir>), 1 waiting on " +
        "the owner, 1 in flight",
    ]);
  });

  it("says UNKNOWN, never nothing, when reconcile is missing or carries no counts", () => {
    const countless: DigestReading = { kind: "json", value: { held: [], ready: [] } };

    expect([
      heldLines({ inputs: inputsOf({ readings: new Map() }) }),
      heldLines({ inputs: inputsOf({ readings: new Map([["reconcile", countless]]) }) }),
    ]).toEqual([
      ["held: UNKNOWN — reconcile: not captured this tick"],
      ["held: UNKNOWN — the reconciliation carries no `rankedCount`"],
    ]);
  });
});
