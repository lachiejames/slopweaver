/**
 * What this atlas declares it does not hold, and on what ground.
 *
 * The property under test is the one `docs/atlas-intent/09-volume.md` makes load-bearing: an exclusion carries a GROUND
 * a gate can read, so "we looked and chose not to store every row" is machine-distinguishable from "we never
 * called this" — and a `shape-index` claim cannot exist without a volume basis behind it.
 */
import { describe, expect, it } from "vitest";

import { isRefusedExclusion, withholdsRecords } from "../../../../atlas/kit/contract.js";
import { WORKOS_EXCLUSIONS } from "../../../../atlas/workos/exclusions.js";

describe("WORKOS_EXCLUSIONS", () => {
  it("grounds the audit log as shape-index rather than as a bare exclusion", () => {
    const auditLog = WORKOS_EXCLUSIONS.find((exclusion) => exclusion.because.startsWith("audit log events"))!;
    expect(auditLog.ground).toBe("shape-index");
  });

  it("carries a volume basis on every shape-index ground, since that is the only admissible one", () => {
    const shapeIndexed = WORKOS_EXCLUSIONS.filter((exclusion) => exclusion.ground === "shape-index");
    expect(shapeIndexed.length).toBe(3);
    expect(shapeIndexed.map((exclusion) => exclusion.volume.basis)).toEqual(["unmeasured", "unmeasured", "unmeasured"]);
  });

  it("grounds every write as never-acted, because the probe sends no body and the reader is GET-only", () => {
    const writes = WORKOS_EXCLUSIONS.find((exclusion) => exclusion.because.startsWith("every authenticated write"))!;
    expect(writes.ground).toBe("never-acted");
    expect(withholdsRecords({ exclusion: writes })).toBe(false);
  });

  it("declares each family exactly once", () => {
    const families = WORKOS_EXCLUSIONS.map((exclusion) => exclusion.because.split(" — ")[0]);
    expect(new Set(families).size).toBe(families.length);
  });

  it("is refused by the coverage gate on exactly its three unmeasured volume claims", () => {
    const refused = WORKOS_EXCLUSIONS.filter((exclusion) => isRefusedExclusion({ exclusion }));
    expect(refused.length).toBe(3);
  });
});
