import { describe, expect, it } from "vitest";

import { projectCloudflareZone } from "../../../../../atlas/cloudflare/projection/zone.js";

const AT = "2026-01-01T00:00:00.000Z";

describe("projectCloudflareZone", () => {
  it("projects every light-inventory field", () => {
    const entity = projectCloudflareZone({
      accountId: "a".repeat(32),
      at: AT,
      zone: {
        id: "zone-1",
        name: "example.test",
        paused: false,
        plan: { name: "Enterprise" },
        status: "active",
        type: "full",
      },
    });
    expect(entity.kind).toBe("zone");
    expect(entity.providerId).toBe("zone-1");
    expect(entity.scope).toEqual({ accountId: "a".repeat(32), parentId: null, zoneId: "zone-1" });
    expect(entity.firstSeenAt).toBe(AT);
    expect(entity.lastSeenAt).toBe(AT);
    expect(entity.state).toBe("observed");
    expect(entity.source).toEqual({ channel: "rest-api", observedAt: AT, operation: "zones-list" });
    expect(entity.detail).toEqual({
      kind: "zone",
      name: "example.test",
      paused: false,
      planName: "Enterprise",
      status: "active",
      type: "full",
    });
  });

  it("defaults every optional field to null when the SDK omits it", () => {
    const entity = projectCloudflareZone({ accountId: "a", at: AT, zone: { id: "zone-1", name: "example.test" } });
    expect(entity.detail).toEqual({
      kind: "zone",
      name: "example.test",
      paused: null,
      planName: null,
      status: null,
      type: null,
    });
  });

  it("stores a null plan name when the SDK sends a plan without one", () => {
    const entity = projectCloudflareZone({
      accountId: "a",
      at: AT,
      zone: { id: "zone-1", name: "example.test", plan: {} },
    });
    expect((entity.detail as { planName: string | null }).planName).toBeNull();
  });

  it("produces the same stable id for the same account and provider id", () => {
    const first = projectCloudflareZone({ accountId: "a", at: AT, zone: { id: "zone-1", name: "example.test" } });
    const second = projectCloudflareZone({ accountId: "a", at: AT, zone: { id: "zone-1", name: "renamed.test" } });
    expect(first.id).toBe(second.id);
  });

  it("produces a different id for a different account, same provider id", () => {
    const first = projectCloudflareZone({ accountId: "a", at: AT, zone: { id: "zone-1", name: "example.test" } });
    const second = projectCloudflareZone({ accountId: "b", at: AT, zone: { id: "zone-1", name: "example.test" } });
    expect(first.id).not.toBe(second.id);
  });
});
