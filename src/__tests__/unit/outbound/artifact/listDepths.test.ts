import { describe, expect, it } from "vitest";
import { z } from "zod";

import { checkListDepths, listDepthsSchema } from "../../../../outbound/artifact/listDepths.js";
import type { OneListArtifact } from "../../../../outbound/artifact/types.js";

/** A one-list with one dot point per depth given, or none at all. */
function list({ count, depths }: { count: number; depths?: readonly (0 | 1)[] }): OneListArtifact {
  return {
    bullets: Array.from({ length: count }, (_, at) => [{ text: `point ${String(at)}`, type: "text" as const }]),
    depths,
    kind: "one-list",
    lead: [{ text: "lead", type: "text" }],
    trailing: [],
  };
}

/** Every message `checkListDepths` raises over one artifact, through a real Zod refinement. */
function issues({ artifact, maxBullets }: { artifact: OneListArtifact; maxBullets: number }): readonly string[] {
  const parsed = z
    .custom<OneListArtifact>()
    .superRefine((value, ctx) => {
      checkListDepths({ artifact: value, ctx, maxBullets });
    })
    .safeParse(artifact);
  return parsed.error === undefined ? [] : parsed.error.issues.map((issue) => issue.message);
}

describe("listDepthsSchema", () => {
  it("takes a headline and a sub-point, and no depths at all", () => {
    expect(listDepthsSchema.safeParse([0, 1]).success).toBe(true);
    expect(listDepthsSchema.safeParse(undefined).success).toBe(true);
  });

  it("refuses a second level of nesting", () => {
    expect(listDepthsSchema.safeParse([0, 2]).success).toBe(false);
  });
});

describe("checkListDepths", () => {
  it("passes four headlines with sub-points under a four-headline cap", () => {
    expect(issues({ artifact: list({ count: 8, depths: [0, 1, 0, 1, 0, 1, 0, 1] }), maxBullets: 4 })).toEqual([]);
  });

  it("refuses a fifth headline under a four-headline cap", () => {
    expect(issues({ artifact: list({ count: 5 }), maxBullets: 4 })[0]).toContain("a list holds 4 dot points");
  });

  it("refuses depths that do not run one for one with the dot points", () => {
    expect(issues({ artifact: list({ count: 3, depths: [0, 1] }), maxBullets: 10 })[0]).toContain(
      "depths carries 2 entries for 3 dot points",
    );
  });

  it("refuses a list that opens on a sub-point", () => {
    expect(issues({ artifact: list({ count: 2, depths: [1, 0] }), maxBullets: 10 })).toEqual([
      "the first dot point is a sub-point with no headline above it; make it depth 0",
    ]);
  });
});
