import { describe, expect, it } from "vitest";

import { projectCloudflareNotificationHistory } from "../../../../../atlas/cloudflare/projection/notificationHistory.js";

const AT = "2026-01-01T00:00:00.000Z";
const ACCOUNT_ID = "a".repeat(32);

describe("projectCloudflareNotificationHistory", () => {
  it("projects every field, keyed by the history record id", () => {
    const entity = projectCloudflareNotificationHistory({
      accountId: ACCOUNT_ID,
      at: AT,
      record: {
        alert_body: "Certificate expiring in 7 days",
        alert_type: "universal_ssl_event_type",
        description: "SSL alerts",
        id: "history-1",
        mechanism: "a@example.test",
        mechanism_type: "email",
        name: "SSL Notification Event Policy",
        policy_id: "policy-1",
        sent: "2026-01-01T00:00:00Z",
      },
    });
    expect(entity.providerId).toBe("history-1");
    expect(entity.detail).toEqual({
      alertBody: "Certificate expiring in 7 days",
      alertType: "universal_ssl_event_type",
      description: "SSL alerts",
      kind: "notification-history",
      mechanism: "a@example.test",
      mechanismType: "email",
      name: "SSL Notification Event Policy",
      policyId: "policy-1",
      sent: "2026-01-01T00:00:00Z",
    });
  });

  it("defaults every missing field to null", () => {
    const entity = projectCloudflareNotificationHistory({ accountId: ACCOUNT_ID, at: AT, record: { id: "history-1" } });
    expect(entity.detail).toEqual({
      alertBody: null,
      alertType: null,
      description: null,
      kind: "notification-history",
      mechanism: null,
      mechanismType: null,
      name: null,
      policyId: null,
      sent: null,
    });
  });
});
