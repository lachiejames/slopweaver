/*
 * The walk's two ordering rules: a fan-out is bound from its own parent's ids, an empty planned parent is not
 * the pooled fallback, and one phase's calls run round-robin by slot then by kind.
 */
import { describe, expect, it } from "vitest";

import { planJumpcloudKind } from "../../../../atlas/jumpcloud/plan.js";
import { emptyJumpcloudAccumulator } from "../../../../atlas/jumpcloud/syncAccumulator.js";
import { idsForFanout, interleave } from "../../../../atlas/jumpcloud/syncOrder.js";

/** A real planned root collection, whose surface name keys what it yielded. */
function plannedRoot(): ReturnType<typeof planJumpcloudKind>["roots"][number] {
  return planJumpcloudKind({ kind: "approvalflows" }).roots[0]!;
}

describe("idsForFanout", () => {
  it("binds from the parent's own ids, deduplicated and sorted, never the pool", () => {
    const root = plannedRoot();
    const accumulator = emptyJumpcloudAccumulator();
    accumulator.providerIdsBySurface[root.row.name] = ["app-2", "app-1", "app-2"];

    expect(idsForFanout({ accumulator, pooled: ["other-1"], root })).toEqual(["app-1", "app-2"]);
  });

  it("binds nothing from a planned parent that yielded nothing, and the pool when there is no parent", () => {
    const accumulator = emptyJumpcloudAccumulator();

    expect(idsForFanout({ accumulator, pooled: ["pooled-1"], root: plannedRoot() })).toEqual([]);
    expect(idsForFanout({ accumulator, pooled: ["pooled-1"], root: null })).toEqual(["pooled-1"]);
  });
});

describe("interleave", () => {
  it("orders by slot, then by kind, across kinds of unequal length", () => {
    expect(interleave({ perKind: [["a1", "a2", "a3"], ["b1"], ["c1", "c2"]] })).toEqual([
      "a1",
      "b1",
      "c1",
      "a2",
      "c2",
      "a3",
    ]);
  });

  it("yields no calls for no kinds", () => {
    expect(interleave({ perKind: [] })).toEqual([]);
  });
});
