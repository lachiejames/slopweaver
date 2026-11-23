import { describe, expect, it } from "vitest";

import { projectCloudflareAuditLog } from "../../../../../atlas/cloudflare/projection/auditLog.js";

const AT = "2026-01-01T00:00:00.000Z";
const ACCOUNT_ID = "a".repeat(32);

describe("projectCloudflareAuditLog", () => {
  it("projects every field, keyed by the log entry id", () => {
    const entity = projectCloudflareAuditLog({
      accountId: ACCOUNT_ID,
      at: AT,
      log: {
        action: { result: true, type: "add" },
        actor: { email: "a@example.test", id: "actor-1", ip: "10.0.0.1", type: "user" },
        id: "log-1",
        interface: "API",
        metadata: { key: "value" },
        newValue: "new",
        oldValue: "old",
        owner: { id: "owner-1" },
        resource: { id: "resource-1", type: "service_token" },
        when: "2026-01-01T00:00:00Z",
      },
    });
    expect(entity.providerId).toBe("log-1");
    expect(entity.detail).toEqual({
      actionResult: true,
      actionType: "add",
      actorEmail: "a@example.test",
      actorId: "actor-1",
      actorIp: "10.0.0.1",
      actorType: "user",
      kind: "audit-log",
      metadata: { key: "value" },
      newValue: "new",
      oldValue: "old",
      ownerId: "owner-1",
      resourceId: "resource-1",
      resourceType: "service_token",
      sourceInterface: "API",
      when: "2026-01-01T00:00:00Z",
    });
  });

  it("defaults every missing field to null", () => {
    const entity = projectCloudflareAuditLog({ accountId: ACCOUNT_ID, at: AT, log: { id: "log-1" } });
    expect(entity.detail).toEqual({
      actionResult: null,
      actionType: null,
      actorEmail: null,
      actorId: null,
      actorIp: null,
      actorType: null,
      kind: "audit-log",
      metadata: null,
      newValue: null,
      oldValue: null,
      ownerId: null,
      resourceId: null,
      resourceType: null,
      sourceInterface: null,
      when: null,
    });
  });
});
