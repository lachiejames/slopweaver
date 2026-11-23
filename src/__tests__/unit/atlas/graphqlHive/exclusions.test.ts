/**
 * What this atlas declares it does not hold, and on what ground.
 *
 * Hive is the sharpest demonstration of `docs/atlas-intent/09-volume.md`'s split: four of its six declared exclusions are
 * voluminous families and every one of them now has to carry a volume basis, so a reader can tell a family
 * that was weighed from one that was merely asserted to be too big.
 */
import { describe, expect, it } from "vitest";

import { HIVE_EXCLUSIONS } from "../../../../atlas/graphqlHive/exclusions.js";
import { isRefusedExclusion, withholdsRecords } from "../../../../atlas/kit/contract.js";

describe("HIVE_EXCLUSIONS", () => {
  it("grounds four families as shape-index, each carrying its own volume basis", () => {
    const shapeIndexed = HIVE_EXCLUSIONS.filter((exclusion) => exclusion.ground === "shape-index");
    expect(shapeIndexed.length).toBe(4);
    expect(shapeIndexed.map((exclusion) => exclusion.volume.basis)).toEqual([
      "unmeasured",
      "unmeasured",
      "unmeasured",
      "unmeasured",
    ]);
  });

  it("grounds the mutation refusal as never-acted, which withholds no record", () => {
    const mutations = HIVE_EXCLUSIONS.find((exclusion) => exclusion.because.startsWith("every mutation"))!;
    expect(mutations.ground).toBe("never-acted");
    expect(withholdsRecords({ exclusion: mutations })).toBe(false);
  });

  it("grounds the token half as secret-material rather than as a missing kind", () => {
    const token = HIVE_EXCLUSIONS.find((exclusion) => exclusion.because.startsWith("the secret half"))!;
    expect(token.ground).toBe("secret-material");
  });

  it("is refused by the coverage gate on exactly its four unmeasured volume claims", () => {
    const refused = HIVE_EXCLUSIONS.filter((exclusion) => isRefusedExclusion({ exclusion }));
    expect(refused.length).toBe(4);
  });
});
