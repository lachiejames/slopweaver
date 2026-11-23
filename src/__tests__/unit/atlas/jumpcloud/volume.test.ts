/**
 * The JumpCloud verdicts, and the two tables the walk derives from them.
 *
 * The assertion that matters most is the last one: `systeminsights` is the per-device telemetry family that
 * must be shape-indexed, and this file fails if it ever stops being so.
 */
import { describe, expect, it } from "vitest";

import type { JumpcloudEntity } from "../../../../atlas/jumpcloud/entities.js";
import {
  JUMPCLOUD_SHAPE_INDEXED,
  JUMPCLOUD_SHAPE_INDEXED_OPERATIONS,
  planJumpcloudKind,
} from "../../../../atlas/jumpcloud/plan.js";
import { reprojectStoredEntities } from "../../../../atlas/jumpcloud/syncEntities.js";
import { JUMPCLOUD_KIND_VOLUMES, jumpcloudRowOperation } from "../../../../atlas/jumpcloud/volume.js";

describe("jumpcloudRowOperation", () => {
  it("reads the operation off a ROOT collection's provider id", () => {
    expect(
      jumpcloudRowOperation({
        row: { id: "abc", providerId: "v1-systems-list#sys-1" },
      }),
    ).toBe("v1-systems-list");
  });

  it("reads it off a BOUND path's provider id, where the endpoint sits between", () => {
    expect(
      jumpcloudRowOperation({
        row: {
          providerId: "v2-policyresults-list:/api/v2/policies/65b5bf5b/policyresults#6a20e248",
        },
      }),
    ).toBe("v2-policyresults-list");
  });

  it("answers null rather than guessing when the provider id carries no operation", () => {
    expect(jumpcloudRowOperation({ row: { id: "abc", providerId: "sys-1" } })).toBe(null);
  });

  it("answers null rather than an empty string when the id opens with the separator", () => {
    expect(jumpcloudRowOperation({ row: { id: "abc", providerId: "#sys-1" } })).toBe(null);
  });
});

describe("the declared verdicts", () => {
  it("shape-indexes the per-device telemetry family", () => {
    const verdict = JUMPCLOUD_KIND_VOLUMES.verdicts.find((row) => row.kind === "systeminsights")!;
    expect(verdict.disposition).toBe("shape-index");
    expect(JUMPCLOUD_SHAPE_INDEXED["systeminsights"]).toContain("the owner's volume ruling");
    expect(JUMPCLOUD_SHAPE_INDEXED["systeminsights"]).toContain(
      "the live per-operation row tally in the published `systeminsights.jsonl`",
    );
  });

  it("shape-indexes the policy-result reports as a whole kind and as an operation inside `policies`", () => {
    expect(Object.hasOwn(JUMPCLOUD_SHAPE_INDEXED, "policyresults")).toBe(true);
    expect(Object.hasOwn(JUMPCLOUD_SHAPE_INDEXED_OPERATIONS, "v2-policyresults-list")).toBe(true);
    expect(Object.hasOwn(JUMPCLOUD_SHAPE_INDEXED, "policies")).toBe(false);
  });

  it("keeps the device-asset entities while shape-indexing their history", () => {
    expect(Object.hasOwn(JUMPCLOUD_SHAPE_INDEXED, "assets")).toBe(false);
    expect(Object.hasOwn(JUMPCLOUD_SHAPE_INDEXED_OPERATIONS, "v2-list-device-asset-history")).toBe(true);
  });

  it("holds the graph traversals as bulk entities, because an association is configuration", () => {
    const systems = JUMPCLOUD_KIND_VOLUMES.verdicts.find((row) => row.kind === "systems")!;
    expect(systems.disposition).toBe("bulk-entity");
  });

  it("every measured shape-index verdict carries a magnitude and the command that re-establishes it", () => {
    const measured = JUMPCLOUD_KIND_VOLUMES.verdicts.filter(
      (row) => row.disposition === "shape-index" && row.volume.basis === "measured",
    );
    expect(measured.length).toBe(5);
    expect(
      measured.every(
        (row) =>
          row.disposition === "shape-index" && row.volume.basis === "measured" && row.volume.establishedBy.length > 0,
      ),
    ).toBe(true);
  });
});

describe("the plan those verdicts drive", () => {
  it("refuses to walk the shape-indexed operation inside `policies`, naming it rather than dropping it", () => {
    const plan = planJumpcloudKind({ kind: "policies" });
    const refused = plan.unrunnable.find((row) => row.operation.row.name === "v2-policyresults-list")!;
    expect(refused.reason).toBe("shape-indexed");
    expect(plan.roots.some((row) => row.row.name === "v2-policyresults-list")).toBe(false);
    expect(plan.fanouts.some((row) => row.row.name === "v2-policyresults-list")).toBe(false);
  });

  it("still walks the policies an administrator authored", () => {
    const plan = planJumpcloudKind({ kind: "policies" });
    expect(plan.roots.some((row) => row.row.name === "v2-policies-list")).toBe(true);
  });

  it("refuses to walk the asset HISTORY while still walking the device assets", () => {
    const plan = planJumpcloudKind({ kind: "assets" });
    expect(plan.unrunnable.find((row) => row.operation.row.name === "v2-list-device-asset-history")!.reason).toBe(
      "shape-indexed",
    );
    expect(plan.roots.some((row) => row.row.name === "v2-list-device-assets")).toBe(true);
  });
});

describe("a stored row from a shape-indexed operation does not survive into the next generation", () => {
  /** One stored entity, in the shape a previous generation wrote. */
  const storedRow = ({ providerId }: { providerId: string }): JumpcloudEntity => ({
    channels: {
      "admin-console": null,
      "directory-api": {
        detail: { state: "SUCCESS" },
        firstSeenAt: "2026-09-06T12:00:00.000Z",
        lastSeenAt: "2026-09-06T14:00:00.000Z",
        source: {
          artifacts: [],
          deepLink: null,
          deepLinkStatus: "unverified",
          endpoint: "e",
          observedAt: "2026-09-06T14:00:00.000Z",
          surface: "directory-api",
        },
        state: "observed",
      },
    },
    id: providerId,
    kind: "policies",
    providerId,
  });

  it("drops the telemetry half and keeps the configuration half, counting what it dropped", () => {
    const reprojected = reprojectStoredEntities({
      stored: [
        storedRow({ providerId: "v2-policies-list#pol-1" }),
        storedRow({ providerId: "v2-policyresults-list:/api/v2/policies/pol-1/policyresults#r-1" }),
        storedRow({ providerId: "v2-policyresults-list:/api/v2/policies/pol-1/policyresults#r-2" }),
      ],
    });
    expect(reprojected.shapeIndexedDrops).toBe(2);
    expect(reprojected.entities.length).toBe(1);
    expect(reprojected.entities[0]!.providerId).toBe("v2-policies-list#pol-1");
  });

  it("drops nothing at all when every stored row came from an entity operation", () => {
    const reprojected = reprojectStoredEntities({
      stored: [
        storedRow({ providerId: "v2-policies-list#pol-1" }),
        storedRow({ providerId: "v2-policies-list#pol-2" }),
      ],
    });
    expect(reprojected.shapeIndexedDrops).toBe(0);
    expect(reprojected.entities.length).toBe(2);
  });
});
