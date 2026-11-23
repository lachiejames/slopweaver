import { describe, expect, it } from "vitest";

import { projectCloudflareNotificationPolicy } from "../../../../../atlas/cloudflare/projection/notificationPolicy.js";

const AT = "2026-01-01T00:00:00.000Z";
const ACCOUNT_ID = "a".repeat(32);

describe("projectCloudflareNotificationPolicy", () => {
  it("projects every field, keyed by the policy id", () => {
    const entity = projectCloudflareNotificationPolicy({
      accountId: ACCOUNT_ID,
      at: AT,
      policy: {
        alert_interval: "1h",
        alert_type: "universal_ssl_event_type",
        created: "2026-01-01T00:00:00Z",
        description: "SSL alerts",
        enabled: true,
        filters: { zones: ["z1"] },
        id: "policy-1",
        mechanisms: { email: [{ id: "a@example.test" }] },
        modified: "2026-01-02T00:00:00Z",
        name: "SSL Notification Event Policy",
      },
    });
    expect(entity.providerId).toBe("policy-1");
    expect(entity.detail).toEqual({
      alertInterval: "1h",
      alertType: "universal_ssl_event_type",
      created: "2026-01-01T00:00:00Z",
      description: "SSL alerts",
      enabled: true,
      filters: { zones: ["z1"] },
      kind: "notification-policy",
      mechanisms: { email: [{ id: "a@example.test" }] },
      modified: "2026-01-02T00:00:00Z",
      name: "SSL Notification Event Policy",
    });
  });

  it("defaults every missing field to null, and name to an empty string", () => {
    const entity = projectCloudflareNotificationPolicy({ accountId: ACCOUNT_ID, at: AT, policy: { id: "policy-1" } });
    expect(entity.detail).toEqual({
      alertInterval: null,
      alertType: null,
      created: null,
      description: null,
      enabled: null,
      filters: null,
      kind: "notification-policy",
      mechanisms: null,
      modified: null,
      name: "",
    });
  });
});
