/*
 * Merging the two edge sources: a declared edge wins over a generation edge for the same row, and a generation edge
 * for any other row survives the merge.
 */
import { describe, expect, it } from "vitest";

import { mergeSupersessionEdges } from "../../../../sweep/supersession.js";

describe("mergeSupersessionEdges", () => {
  it("lets a declared edge win over a generation edge for the same row", () => {
    const merged = mergeSupersessionEdges({
      declared: new Map([["old-row", { kind: "declared", newerSlug: "declarer" } as const]]),
      generated: new Map([
        [
          "old-row",
          {
            kind: "generation",
            newerSlug: "later-gen",
            recipe: "r",
            registeredIso: "2026-10-02T00:00:00.000Z",
          } as const,
        ],
        [
          "other-row",
          {
            kind: "generation",
            newerSlug: "later-gen",
            recipe: "r",
            registeredIso: "2026-10-02T00:00:00.000Z",
          } as const,
        ],
      ]),
    });
    expect(merged.get("old-row")).toEqual({ kind: "declared", newerSlug: "declarer" });
    expect(merged.get("other-row")!.newerSlug).toBe("later-gen");
    expect(merged.size).toBe(2);
  });
});
