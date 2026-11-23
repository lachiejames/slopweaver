/**
 * One operation's answer assembled from its per-target walks — `src/atlas/jumpcloud/readMerge.ts`.
 *
 * Every flag must merge in the direction that claims LESS, so each case pairs a finished walk with one that
 * is not and asserts the merged read is not called finished.
 */
import { describe, expect, it } from "vitest";

import { mergeOperationReads } from "../../../../atlas/jumpcloud/readMerge.js";
import type { JumpcloudOperationRead } from "../../../../atlas/jumpcloud/syncRead.js";

/**
 * One finished walk, overridden where a case is about something else.
 *
 * @param over the fields this case is about
 * @returns the walk
 */
function walk({ over }: { over: Partial<JumpcloudOperationRead> }): JumpcloudOperationRead {
  return {
    complete: true,
    declaredTotal: 1,
    empty: false,
    endpoint: "/api/v2/systems/sys-1/associations",
    incompleteIsClearable: false,
    pagesExhausted: true,
    paginationDisagreed: false,
    pagingRefused: false,
    reason: "read to the end",
    records: [{ to: { id: "u" } }],
    unsorted: false,
    ...over,
  };
}

describe("mergeOperationReads", () => {
  it("returns a single walk unchanged, so an operation that is not split reads exactly as before", () => {
    const only = walk({ over: {} });
    expect(mergeOperationReads({ reads: [only] })).toBe(only);
  });

  it("concatenates records in the contract's order and sums the declared totals", () => {
    const merged = mergeOperationReads({
      reads: [walk({ over: { records: [{ to: { id: "a" } }] } }), walk({ over: { records: [{ to: { id: "b" } }] } })],
    });
    expect(merged.records).toEqual([{ to: { id: "a" } }, { to: { id: "b" } }]);
    expect(merged.declaredTotal).toBe(2);
  });

  it("is not complete when any walk was not, and carries a clearable shortfall from any walk", () => {
    const merged = mergeOperationReads({
      reads: [walk({ over: {} }), walk({ over: { complete: false, incompleteIsClearable: true } })],
    });
    expect(merged.complete).toBe(false);
    expect(merged.incompleteIsClearable).toBe(true);
  });

  it("declares no total when any walk declared none, rather than a sum that undercounts", () => {
    const merged = mergeOperationReads({ reads: [walk({ over: {} }), walk({ over: { declaredTotal: null } })] });
    expect(merged.declaredTotal).toBe(null);
  });

  it("is empty only when every walk was", () => {
    const merged = mergeOperationReads({
      reads: [walk({ over: { empty: true, records: [] } }), walk({ over: {} })],
    });
    expect(merged.empty).toBe(false);
  });

  it("answers no walks at all as an incomplete read that a later run could clear, never as a finished one", () => {
    const merged = mergeOperationReads({ reads: [] });
    expect(merged.complete).toBe(false);
    expect(merged.incompleteIsClearable).toBe(true);
  });
});
