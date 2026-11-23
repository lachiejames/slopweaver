/**
 * Two JumpCloud refusals asserted as the whole line they print: a kind file carrying another kind's
 * entities, and a generation that cannot be serialised at all.
 *
 * The misfiled case holds six so the line's count and its five-id cap are both falsifiable; the
 * serialisation case holds a `BigInt`, which `JSON.stringify` refuses outright rather than for size.
 */
import { describe, expect, it } from "vitest";

import { assembleJumpcloudKindFile, type JumpcloudEntity } from "../../../../atlas/jumpcloud/entities.js";
import { admitJumpcloudGeneration } from "../../../../atlas/jumpcloud/sensitivity.js";
import { unwrapErr } from "../../../../lib/result.js";

const AT = "2026-09-04T10:00:00.000Z";

/** One policy entity under the given id. */
function policy({ id }: { id: string }): JumpcloudEntity {
  return {
    channels: {
      "admin-console": null,
      "directory-api": { detail: { a: 1 }, firstSeenAt: AT, lastSeenAt: AT, source: null, state: "observed" },
    },
    id,
    kind: "policies",
    providerId: `p-${id}`,
  };
}

describe("assembleJumpcloudKindFile", () => {
  it("counts every misfiled entity and names only the first five", () => {
    const entities = ["m1", "m2", "m3", "m4", "m5", "m6"].map((id) => policy({ id }));
    const assembled = assembleJumpcloudKindFile({
      at: AT,
      coverage: [],
      entities,
      gaps: [],
      kind: "systems",
      readEpoch: null,
    });
    expect(unwrapErr(assembled)).toEqual([
      "the systems file this run assembled carries 6 entity/entities of another kind: m1, m2, m3, m4, m5",
    ]);
  });
});

describe("admitJumpcloudGeneration", () => {
  it("refuses a generation it cannot serialise with one line naming why", () => {
    expect(unwrapErr(admitJumpcloudGeneration({ document: { held: 1n } }))).toEqual([
      "refusing the whole generation: it cannot be serialised, so nothing can say what would be written — Do not know how to serialize a BigInt",
    ]);
  });
});
