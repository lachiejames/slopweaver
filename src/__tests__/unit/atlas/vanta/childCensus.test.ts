import { describe, expect, it } from "vitest";

import {
  VANTA_CHILD_FAMILIES,
  VANTA_CHILD_FAMILY_LIST,
  VANTA_CHILD_SURFACE_LIST,
} from "../../../../atlas/vanta/childCensus.js";
import { VANTA_GET_ENDPOINTS } from "../../../../atlas/vanta/generated/getEndpoints.js";
import { VANTA_KINDS } from "../../../../atlas/vanta/model.js";

describe("the child table", () => {
  it("covers exactly these fan-out families — the SET rather than a count, so a swap cannot pass", () => {
    expect(VANTA_CHILD_FAMILY_LIST.map((family) => family.kind).toSorted()).toEqual([
      "control-document-link",
      "discovered-vendor-account",
      "document-link",
      "document-upload",
      "framework-control-link",
      "group-member",
      "integration-resource",
      "integration-resource-kind",
      "risk-control-link",
      "vendor-assessment",
      "vendor-document",
      "vendor-security-review",
    ]);
  });

  it("declares every fan-out whose parent is itself a fan-out AFTER that parent, so a run reads it first", () => {
    const order = VANTA_CHILD_FAMILY_LIST.map((family) => family.kind);
    const childParents = VANTA_CHILD_FAMILY_LIST.flatMap((family) =>
      family.surfaces
        .filter((surface) => order.some((kind) => kind === surface.parentKind))
        .map((surface) => ({ child: family.kind, parent: surface.parentKind })),
    );
    expect(childParents).toEqual([{ child: "integration-resource", parent: "integration-resource-kind" }]);
    expect(
      childParents.filter(({ child, parent }) => order.findIndex((kind) => kind === parent) > order.indexOf(child)),
    ).toEqual([]);
  });

  it("declares an undeclared-shape reader on exactly the resource surface, whose schema has the fallback", () => {
    expect(
      VANTA_CHILD_SURFACE_LIST.filter((surface) => surface.undeclaredShape !== undefined).map(
        (surface) => surface.surface,
      ),
    ).toEqual(["integration-resources"]);
  });

  it("declares every family's kind in the atlas's own vocabulary", () => {
    for (const family of VANTA_CHILD_FAMILY_LIST) {
      expect(VANTA_KINDS.includes(family.kind)).toBe(true);
    }
  });

  it("gives every surface a distinct name, so two cannot share a coverage cell", () => {
    const names = VANTA_CHILD_SURFACE_LIST.map((surface) => surface.surface);
    expect(new Set(names).size).toBe(names.length);
  });

  it("names only paths the published document actually declares, with its own /v1 removed", () => {
    const documented = new Set(VANTA_GET_ENDPOINTS.map((row) => row.path));
    const undocumented = VANTA_CHILD_SURFACE_LIST.map((surface) => surface.specPath.replace(/^\/v1/, "")).filter(
      (path) => !documented.has(path),
    );
    expect(undocumented).toEqual([]);
  });

  it("declares every fan-out path as one this atlas SYNCS, so the numerator cannot drift from the table", () => {
    const synced = new Set(VANTA_GET_ENDPOINTS.filter((row) => row.disposition === "synced").map((row) => row.path));
    const unsynced = VANTA_CHILD_SURFACE_LIST.map((surface) => surface.specPath.replace(/^\/v1/, "")).filter(
      (path) => !synced.has(path),
    );
    expect(unsynced).toEqual([]);
  });

  it("declares a parent ceiling on exactly the one surface it was MEASURED on", () => {
    const withCeiling = VANTA_CHILD_SURFACE_LIST.filter((surface) => surface.parentCeiling !== null);
    expect(withCeiling.map((surface) => surface.surface)).toEqual(["integration-resource-kinds"]);
    expect(withCeiling[0]!.parentCeiling!.status).toBe(422);
    expect(withCeiling[0]!.parentCeiling!.because).toContain("Connectors");
  });

  it("reads the pairing families' rows as a pairing and the rest as objects", () => {
    const pairings = VANTA_CHILD_FAMILY_LIST.filter((family) => family.payload === "pairing").map(
      (family) => family.kind,
    );
    expect(pairings.toSorted()).toEqual([
      "control-document-link",
      "framework-control-link",
      "group-member",
      "risk-control-link",
    ]);
  });

  it("reads both directions of the control-document relation, because Vanta serves it as two operations", () => {
    expect(VANTA_CHILD_FAMILIES["control-document-link"].surfaces.map((surface) => surface.specPath)).toEqual([
      "/v1/controls/{controlId}/documents",
      "/v1/documents/{documentId}/controls",
    ]);
  });
});
