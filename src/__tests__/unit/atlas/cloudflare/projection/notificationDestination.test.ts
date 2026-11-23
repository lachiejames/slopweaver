import { describe, expect, it } from "vitest";

import {
  projectCloudflareNotificationPagerduty,
  projectCloudflareNotificationWebhook,
} from "../../../../../atlas/cloudflare/projection/notificationDestination.js";

const AT = "2026-01-01T00:00:00.000Z";
const ACCOUNT_ID = "a".repeat(32);

describe("projectCloudflareNotificationWebhook", () => {
  it("projects every field, prefixing the provider id with the mechanism type", () => {
    const entity = projectCloudflareNotificationWebhook({
      accountId: ACCOUNT_ID,
      at: AT,
      webhook: {
        created_at: "2026-01-01T00:00:00Z",
        id: "hook-1",
        last_failure: "2026-01-02T00:00:00Z",
        last_success: "2026-01-03T00:00:00Z",
        name: "Slack Webhook",
        type: "slack",
        url: "https://hooks.slack.test/abc",
      },
    });
    expect(entity.providerId).toBe("webhook:hook-1");
    expect(entity.detail).toEqual({
      createdAt: "2026-01-01T00:00:00Z",
      kind: "notification-destination",
      lastFailure: "2026-01-02T00:00:00Z",
      lastSuccess: "2026-01-03T00:00:00Z",
      mechanismType: "webhook",
      name: "Slack Webhook",
      type: "slack",
      url: "https://hooks.slack.test/abc",
    });
  });

  it("defaults every missing field to null", () => {
    const entity = projectCloudflareNotificationWebhook({ accountId: ACCOUNT_ID, at: AT, webhook: { id: "hook-1" } });
    expect(entity.detail).toEqual({
      createdAt: null,
      kind: "notification-destination",
      lastFailure: null,
      lastSuccess: null,
      mechanismType: "webhook",
      name: null,
      type: null,
      url: null,
    });
  });
});

describe("projectCloudflareNotificationPagerduty", () => {
  it("projects the pagerduty service, prefixing the provider id with the mechanism type", () => {
    const entity = projectCloudflareNotificationPagerduty({
      accountId: ACCOUNT_ID,
      at: AT,
      pagerduty: { id: "pd-1", name: "On-call" },
    });
    expect(entity.providerId).toBe("pagerduty:pd-1");
    expect(entity.detail).toEqual({ kind: "notification-destination", mechanismType: "pagerduty", name: "On-call" });
  });

  it("keeps webhook and pagerduty provider ids distinct even when the raw ids collide", () => {
    const webhook = projectCloudflareNotificationWebhook({ accountId: ACCOUNT_ID, at: AT, webhook: { id: "x" } });
    const pagerduty = projectCloudflareNotificationPagerduty({ accountId: ACCOUNT_ID, at: AT, pagerduty: { id: "x" } });
    expect(webhook.providerId).not.toBe(pagerduty.providerId);
    expect(webhook.id).not.toBe(pagerduty.id);
  });
});
