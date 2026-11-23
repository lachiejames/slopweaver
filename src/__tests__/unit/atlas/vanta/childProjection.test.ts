import { describe, expect, it } from "vitest";

import { VANTA_CHILD_FAMILIES } from "../../../../atlas/vanta/childCensus.js";
import { projectVantaChildRow } from "../../../../atlas/vanta/childProjection.js";

const AT = "2026-09-10T00:00:00.000Z";

/**
 * One control row, which is what three of the four pairing surfaces actually return — `/frameworks/{id}/
 * controls` and `/documents/{id}/controls` answer the `/controls` shape exactly.
 */
const control = ({ id }: { id: string }) => ({
  creationDate: null,
  customFields: [],
  description: "d",
  domains: [],
  externalId: null,
  id,
  modificationDate: null,
  name: "n",
  owner: null,
  role: null,
  source: "Vanta" as const,
});

describe("projectVantaChildRow", () => {
  it("keys a child by BOTH ends, so the same child under two parents is two entities", () => {
    const family = VANTA_CHILD_FAMILIES["framework-control-link"];
    const surface = family.surfaces[0]!;
    const row = control({ id: "c1" });
    const first = projectVantaChildRow({ at: AT, dto: row, family, parentId: "f1", surface });
    const second = projectVantaChildRow({ at: AT, dto: row, family, parentId: "f2", surface });
    expect(first.providerId).toBe("f1:c1");
    expect(second.providerId).toBe("f2:c1");
    expect(first.id === second.id).toBe(false);
  });

  it("stores a PAIRING rather than the row, for a family whose row another kind already holds", () => {
    const family = VANTA_CHILD_FAMILIES["framework-control-link"];
    const surface = family.surfaces[0]!;
    const entity = projectVantaChildRow({ at: AT, dto: control({ id: "c1" }), family, parentId: "f1", surface });
    expect(entity.channels["manage-api"]!.detail).toEqual({
      childId: "c1",
      parentId: "f1",
      parentKind: "framework",
      witnessedBy: "framework-controls",
    });
  });

  it("stores the row unchanged for an object family, with the parent it was read under beside it", () => {
    const family = VANTA_CHILD_FAMILIES["document-link"];
    const surface = family.surfaces[0]!;
    const dto = {
      creationDate: AT,
      description: "the signed copy",
      effectiveDate: null,
      id: "l1",
      title: "Agreement",
      url: "https://example.invalid/a",
    };
    const entity = projectVantaChildRow({ at: AT, dto, family, parentId: "d1", surface });
    expect(entity.channels["manage-api"]!.detail).toEqual({ ...dto, parentId: "d1" });
  });

  it("marks a family carrying staff identity for care, and leaves the rest unmarked", () => {
    const careful = VANTA_CHILD_FAMILIES["group-member"];
    const plain = VANTA_CHILD_FAMILIES["document-link"];
    const carefulEntity = projectVantaChildRow({
      at: AT,
      dto: control({ id: "p1" }),
      family: careful,
      parentId: "g1",
      surface: careful.surfaces[0]!,
    });
    const plainEntity = projectVantaChildRow({
      at: AT,
      dto: control({ id: "x" }),
      family: plain,
      parentId: "d1",
      surface: plain.surfaces[0]!,
    });
    expect(carefulEntity.sensitivity).toEqual({ handleWithCare: true, providerMarkedSensitive: null });
    expect(plainEntity.sensitivity).toBe(null);
  });
});
