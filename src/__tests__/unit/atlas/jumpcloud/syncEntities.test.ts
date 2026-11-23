import { describe, expect, it } from "vitest";

import { planJumpcloudKind } from "../../../../atlas/jumpcloud/plan.js";
import { observeJumpcloudRecords, reprojectStoredEntities } from "../../../../atlas/jumpcloud/syncEntities.js";

const AT = "2026-09-04T10:00:00.000Z";

const rootOperation = () =>
  planJumpcloudKind({ kind: "systems" }).roots.find((op) => op.row.name === "v1-systems-list")!;
const fanoutOperation = () =>
  planJumpcloudKind({ kind: "systems" }).fanouts.find((op) => op.row.path.endsWith("/policystatuses"))!;

describe("observeJumpcloudRecords", () => {
  it("identifies a root record by the operation that returned it, plus the record's own id", () => {
    const observed = observeJumpcloudRecords({
      at: AT,
      endpoint: "/api/systems",
      isRoot: true,
      operation: rootOperation(),
      records: [{ _id: "6512", hostname: "laptop" }],
    });
    expect(observed.entities[0]!.providerId).toBe("v1-systems-list#6512");
    expect(observed.providerIds).toEqual(["6512"]);
  });

  it("identifies a fan-out row by the BOUND PATH too, so one parent's copy cannot collide with another's", () => {
    const observed = observeJumpcloudRecords({
      at: AT,
      endpoint: "/api/v2/systems/6512/policystatuses",
      isRoot: false,
      operation: fanoutOperation(),
      records: [{ id: "6512" }],
    });
    expect(observed.entities[0]!.providerId).toBe(
      `${fanoutOperation().row.name}:/api/v2/systems/6512/policystatuses#6512`,
    );
    expect(observed.providerIds).toEqual([]);
  });

  it("gives a record with no id of its own a stable identity from its position in the walk", () => {
    const observed = observeJumpcloudRecords({
      at: AT,
      endpoint: "/api/systems",
      isRoot: true,
      operation: rootOperation(),
      records: [{ hostname: "laptop" }],
    });
    expect(observed.entities[0]!.providerId).toBe("v1-systems-list#at-0");
  });

  it("drops a denied field at the boundary and reports the removal beside the value it came from", () => {
    const observed = observeJumpcloudRecords({
      at: AT,
      endpoint: "/api/systems",
      isRoot: true,
      operation: rootOperation(),
      records: [{ _id: "a", idpPrivateKey: "-----BEGIN PRIVATE KEY-----", displayName: "laptop" }],
    });
    expect(observed.entities[0]!.channels["directory-api"]!.detail).toEqual({ _id: "a", displayName: "laptop" });
    expect(observed.projections[0]!.dropped.map((drop) => drop.reason)).toEqual(["secret-material"]);
  });

  it("records provenance as the operation and the bound path, never a constructed console URL", () => {
    const observed = observeJumpcloudRecords({
      at: AT,
      endpoint: "/api/systems",
      isRoot: true,
      operation: rootOperation(),
      records: [{ _id: "a" }],
    });
    const source = observed.entities[0]!.channels["directory-api"]!.source!;
    expect(source.deepLink).toBe(null);
    expect(source.deepLinkStatus).toBe("unverified");
    expect(source.endpoint).toBe("v1-systems-list /api/systems");
    expect(source.surface).toBe("directory-api");
  });

  it("leaves the browser channel untouched, because the API did not look there", () => {
    const observed = observeJumpcloudRecords({
      at: AT,
      endpoint: "/api/systems",
      isRoot: true,
      operation: rootOperation(),
      records: [{ _id: "a" }],
    });
    expect(observed.entities[0]!.channels["admin-console"]).toBe(null);
  });

  it("never gives two parents' copies of one record the same identity — the live walk's own defect", () => {
    const operation = fanoutOperation();
    const first = observeJumpcloudRecords({
      at: AT,
      endpoint: "/api/v2/systems/A/policystatuses",
      isRoot: false,
      operation,
      records: [{ id: "shared" }],
    });
    const second = observeJumpcloudRecords({
      at: AT,
      endpoint: "/api/v2/systems/B/policystatuses",
      isRoot: false,
      operation,
      records: [{ id: "shared" }],
    });
    expect(first.entities[0]!.id === second.entities[0]!.id).toBe(false);
  });

  it("takes the identity from the PROJECTED record, so a denied field can never become an id", () => {
    const observed = observeJumpcloudRecords({
      at: AT,
      endpoint: "/api/systems",
      isRoot: true,
      operation: rootOperation(),
      records: [{ credential: "should-never-be-an-id", hostname: "laptop" }],
    });
    expect(observed.entities[0]!.providerId).toBe("v1-systems-list#at-0");
  });

  it("keeps one record per id when a walk returns the same id twice", () => {
    const observed = observeJumpcloudRecords({
      at: AT,
      endpoint: "/api/systems",
      isRoot: true,
      operation: rootOperation(),
      records: [{ _id: "a" }, { _id: "a" }],
    });
    expect(observed.entities.length).toBe(1);
  });
});

describe("reprojectStoredEntities", () => {
  it("applies TODAY's denial rules to a document an older generation already stored", () => {
    const stored = {
      channels: {
        "admin-console": null,
        "directory-api": {
          detail: { hostname: "old", nextPageToken: "cursor-123" },
          firstSeenAt: AT,
          lastSeenAt: AT,
          source: null,
          state: "stale" as const,
        },
      },
      id: "id-1",
      kind: "systems" as const,
      providerId: "v1-systems-list#old",
    };
    const carried = reprojectStoredEntities({ stored: [stored] });
    expect(carried.entities[0]!.channels["directory-api"]!.detail).toEqual({ hostname: "old" });
    expect(carried.projections[0]!.dropped.map((drop) => drop.reason)).toEqual(["ephemeral-token"]);
  });

  it("leaves a channel that has never looked as null rather than inventing an observation for it", () => {
    const stored = {
      channels: { "admin-console": null, "directory-api": null },
      id: "id-1",
      kind: "systems" as const,
      providerId: "v1-systems-list#old",
    };
    expect(reprojectStoredEntities({ stored: [stored] }).entities[0]!.channels["admin-console"]).toBe(null);
  });

  it("reports nothing when there was nothing to withhold, so coverage does not invent a removal", () => {
    const stored = {
      channels: {
        "admin-console": null,
        "directory-api": {
          detail: { hostname: "ok" },
          firstSeenAt: AT,
          lastSeenAt: AT,
          source: null,
          state: "observed" as const,
        },
      },
      id: "id-1",
      kind: "systems" as const,
      providerId: "v1-systems-list#ok",
    };
    expect(reprojectStoredEntities({ stored: [stored] }).projections).toEqual([]);
  });
});
