import { describe, expect, it } from "vitest";

import { type GcpAuditError, GcpAuditErrors } from "../../../gcpAudit/errors.js";
import { cacheRoles, readAuditConfigs, readInventory } from "../../../gcpAudit/inventory.js";
import type { GcpAuditRequest } from "../../../gcpAudit/transport.js";
import { err, ok, type Result } from "../../../lib/result.js";

const forbidden = (): Result<unknown, GcpAuditError> =>
  err(GcpAuditErrors.transportFailed({ detail: "Permission denied", operation: "op", status: 403 }));

/** `projects/locked` refuses its sinks; every other container has one bucket and one disabled sink. */
function inventoryAnswer({ request }: { request: GcpAuditRequest }): Result<unknown, GcpAuditError> {
  if (request.kind === "list-buckets") {
    return ok({ buckets: [{ name: `${request.parent}/locations/global/buckets/_Default`, retentionDays: 30 }] });
  }
  if (request.kind === "list-sinks" && request.parent === "projects/locked") {
    return forbidden();
  }
  return ok({ sinks: [{ destination: "d", disabled: true, name: "s" }] });
}

describe("readInventory", () => {
  it("keeps each container's buckets and sinks, and records a refused list against its container", async () => {
    const inventory = await readInventory({
      containers: ["organizations/1", "projects/locked"],
      send: ({ request }) => Promise.resolve(inventoryAnswer({ request })),
    });
    expect(inventory.buckets.map((bucket) => [bucket.container, bucket.retentionDays, bucket.locked])).toEqual([
      ["organizations/1", 30, null],
      ["projects/locked", 30, null],
    ]);
    expect(inventory.sinks.map((sink) => [sink.container, sink.disabled, sink.filter])).toEqual([
      ["organizations/1", true, null],
    ]);
    expect(inventory.sinkRefusals.map((fact) => [fact.what, fact.status])).toEqual([["projects/locked", 403]]);
    expect(inventory.bucketRefusals).toEqual([]);
  });
});

describe("readAuditConfigs", () => {
  it("reads each service's configured log types off the organisation's policy", async () => {
    const read = await readAuditConfigs({
      org: "1",
      send: () =>
        Promise.resolve(
          ok({ auditConfigs: [{ auditLogConfigs: [{ logType: "DATA_READ" }], service: "allServices" }] }),
        ),
    });
    expect(read).toEqual({
      auditConfigs: [{ logTypes: ["DATA_READ"], resource: "organizations/1", service: "allServices" }],
      policyRefusals: [],
    });
  });

  it("answers no configuration and one refusal when the policy read is refused", async () => {
    const read = await readAuditConfigs({ org: "1", send: () => Promise.resolve(forbidden()) });
    expect(read.auditConfigs).toEqual([]);
    expect(read.policyRefusals.map((fact) => [fact.what, fact.status])).toEqual([["organizations/1", 403]]);
  });
});

describe("cacheRoles", () => {
  it("caches each readable role's sorted permissions and records each unreadable one", async () => {
    const read = await cacheRoles({
      roles: ["roles/viewer", "roles/gone"],
      send: ({ request }) =>
        Promise.resolve(
          request.kind === "get-role" && request.role === "roles/viewer"
            ? ok({ includedPermissions: ["b.two", "a.one"], name: "roles/viewer" })
            : forbidden(),
        ),
    });
    expect(read.cached).toEqual([{ name: "roles/viewer", permissions: ["a.one", "b.two"] }]);
    expect(read.roleFacts).toEqual([
      { deleted: null, etag: null, name: "roles/viewer", permissionCount: 2, stage: null, title: null },
    ]);
    expect(read.roleRefusals.map((fact) => fact.what)).toEqual(["roles/gone"]);
  });
});
