/**
 * Which surfaces a production read pages — `src/atlas/jumpcloud/pagedSurfaces.ts`, the denominator every
 * response boundary is counted against.
 */
import { describe, expect, it } from "vitest";

import { JUMPCLOUD_AUTH_EVENTS_SURFACE } from "../../../../atlas/jumpcloud/authEvents.js";
import { jumpcloudPagedSurfaceNames, planJumpcloudWalk } from "../../../../atlas/jumpcloud/pagedSurfaces.js";
import { isShapeIndexedKind, planJumpcloudSync } from "../../../../atlas/jumpcloud/plan.js";

describe("planJumpcloudWalk", () => {
  it("plans every declared kind but the shape-indexed ones, in kind order", () => {
    const walked = planJumpcloudWalk().map((plan) => plan.kind);
    const expected = planJumpcloudSync()
      .map((plan) => plan.kind)
      .filter((kind) => !isShapeIndexedKind({ kind }));

    expect(walked.length).toBeGreaterThan(0);
    expect(walked).toEqual(expected);
  });
});

describe("jumpcloudPagedSurfaceNames", () => {
  const names = jumpcloudPagedSurfaceNames();

  // MEASURED off the checked-in registry: 111 roots and 263 fan-outs across the walked kinds, plus the
  // auth-event read. A registry regeneration that moves it is a change every response boundary has to follow.
  it("counts the surfaces a production read pages", () => {
    expect(names.length).toBe(375);
  });

  it("is sorted and distinct, so a boundary table can be compared to it as a set", () => {
    expect(names).toEqual([...new Set(names)].toSorted());
  });

  it("carries the auth-event read, which pages outside the sync, and both decoded-file surfaces", () => {
    expect(
      names.filter((name) =>
        [JUMPCLOUD_AUTH_EVENTS_SURFACE, "v2-applemdms-csrget", "v2-applemdms-depkeyget"].includes(name),
      ),
    ).toEqual([JUMPCLOUD_AUTH_EVENTS_SURFACE, "v2-applemdms-csrget", "v2-applemdms-depkeyget"]);
  });

  it("carries no surface of a shape-indexed kind, which a sync never walks", () => {
    const shapeIndexed = planJumpcloudSync()
      .filter((plan) => isShapeIndexedKind({ kind: plan.kind }))
      .flatMap((plan) => [...plan.roots, ...plan.fanouts].map((operation) => operation.row.name));

    expect(shapeIndexed.length).toBeGreaterThan(0);
    expect(shapeIndexed.filter((name) => names.includes(name))).toEqual([]);
  });
});
