import { describe, expect, it } from "vitest";

import { VANTA_CHILD_FAMILIES } from "../../../../atlas/vanta/childCensus.js";
import { type ChildRow, undeclaredShapeGaps } from "../../../../atlas/vanta/childShapeGaps.js";
import type { VantaChildDto, VantaChildSurface } from "../../../../atlas/vanta/childSurface.js";
import { openVantaGap } from "../../../../atlas/vanta/gaps.js";
import { emptyVantaKindFile } from "../../../../atlas/vanta/model.js";

const AT = "2026-10-18T00:00:00.000Z";
const family = VANTA_CHILD_FAMILIES["integration-resource"];
const resources = family.surfaces.find((surface) => surface.surface === "integration-resources")!;
const dto = {} as unknown as VantaChildDto;

/** The real resource surface with its shape reader replaced by a plain function that names fixed fields. */
function surfaceReading({ fields }: { fields: readonly string[] | null }): VantaChildSurface {
  return { ...resources, undeclaredShape: () => fields };
}

const rows: readonly ChildRow[] = [
  { dto, parentId: "gcp:role-b" },
  { dto, parentId: "gcp:role-a" },
];

describe("undeclaredShapeGaps", () => {
  it("opens one schema-drift gap per field set, naming the parents it was read under in order", () => {
    const { gaps } = undeclaredShapeGaps({
      at: AT,
      family,
      rows,
      stored: emptyVantaKindFile({ kind: family.kind, updatedAt: AT }),
      surface: surfaceReading({ fields: ["name", "arn"] }),
      walkedWhole: true,
    });
    expect(gaps.map((gap) => gap.scope)).toEqual(["integration-resources:undeclared-shape:name,arn"]);
    expect(gaps[0]!.reason).toBe(
      "2 integration-resources row(s) under gcp:role-a, gcp:role-b match no arm the published document declares; stored as returned. Their fields: name,arn",
    );
  });

  it("opens nothing for rows the document describes", () => {
    const result = undeclaredShapeGaps({
      at: AT,
      family,
      rows,
      stored: emptyVantaKindFile({ kind: family.kind, updatedAt: AT }),
      surface: surfaceReading({ fields: null }),
      walkedWhole: true,
    });
    expect(result).toEqual({ gaps: [], rechecks: [] });
  });

  it("opens nothing for a surface that declares no shape reader", () => {
    const assessments = VANTA_CHILD_FAMILIES["vendor-assessment"];
    const result = undeclaredShapeGaps({
      at: AT,
      family: assessments,
      rows,
      stored: emptyVantaKindFile({ kind: assessments.kind, updatedAt: AT }),
      surface: assessments.surfaces[0]!,
      walkedWhole: true,
    });
    expect(assessments.surfaces[0]!.undeclaredShape).toBeUndefined();
    expect(result).toEqual({ gaps: [], rechecks: [] });
  });

  describe("closing a stored gap the walk did not see again", () => {
    const staleGap = openVantaGap({
      at: AT,
      channel: "manage-api",
      condition: "schema-drift",
      kind: family.kind,
      reason: "an old shape",
      scope: "integration-resources:undeclared-shape:gone",
    });
    const stored = { ...emptyVantaKindFile({ kind: family.kind, updatedAt: AT }), gaps: [staleGap] };

    it("rechecks it as resolved after a complete walk", () => {
      const { rechecks } = undeclaredShapeGaps({
        at: AT,
        family,
        rows: [],
        stored,
        surface: surfaceReading({ fields: null }),
        walkedWhole: true,
      });
      expect(rechecks).toEqual([
        {
          condition: "schema-drift",
          resolved: true,
          scope: "integration-resources:undeclared-shape:gone",
        },
      ]);
    });

    it("leaves it open after a walk that was not whole", () => {
      const { rechecks } = undeclaredShapeGaps({
        at: AT,
        family,
        rows: [],
        stored,
        surface: surfaceReading({ fields: null }),
        walkedWhole: false,
      });
      expect(rechecks).toEqual([]);
    });
  });
});
