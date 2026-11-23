/** The open-ready count a reconcile reading carries: ready rows no placement is on. */
import { describe, expect, it } from "vitest";

import { openReadyCountOf } from "../../../../supervisor/tickReconcileObservation.js";

describe("openReadyCountOf", () => {
  /** A reconcile reading over the given ready ids and placements. */
  const reading = ({ ready, aligned }: { ready: readonly string[]; aligned: readonly string[] }) => ({
    aligned: aligned.map((id) => ({ row: { id } })),
    fleet: "observed" as const,
    headline: "h",
    intakeClause: "i",
    misaligned: [],
    rankedCount: ready.length,
    ready: ready.map((id) => ({ id })),
    staleAsks: [],
    starving: [],
    unprioritised: [],
    unregistered: [],
  });

  it("counts the ready rows no placement is on", () => {
    expect(openReadyCountOf({ report: reading({ aligned: ["a"], ready: ["a", "b", "c"] }) })).toBe(2);
  });

  it("is undefined, never zero, when the fleet was not observed", () => {
    const report = { ...reading({ aligned: [], ready: ["a"] }), fleet: "unavailable" as const };

    expect(openReadyCountOf({ report })).toBe(undefined);
  });
});
