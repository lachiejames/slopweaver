import { describe, expect, it } from "vitest";

import { projectCloudflareNotificationSilence } from "../../../../../atlas/cloudflare/projection/notificationSilence.js";

const AT = "2026-01-01T00:00:00.000Z";
const ACCOUNT_ID = "a".repeat(32);

describe("projectCloudflareNotificationSilence", () => {
  it("projects every field, keyed by the silence id", () => {
    const entity = projectCloudflareNotificationSilence({
      accountId: ACCOUNT_ID,
      at: AT,
      silence: {
        created_at: "2026-01-01T00:00:00Z",
        end_time: "2026-01-02T00:00:00Z",
        id: "silence-1",
        policy_id: "policy-1",
        start_time: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-01T01:00:00Z",
      },
    });
    expect(entity.providerId).toBe("silence-1");
    expect(entity.detail).toEqual({
      createdAt: "2026-01-01T00:00:00Z",
      endTime: "2026-01-02T00:00:00Z",
      kind: "notification-silence",
      policyId: "policy-1",
      startTime: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T01:00:00Z",
    });
  });

  it("defaults every missing field to null", () => {
    const entity = projectCloudflareNotificationSilence({
      accountId: ACCOUNT_ID,
      at: AT,
      silence: { id: "silence-1" },
    });
    expect(entity.detail).toEqual({
      createdAt: null,
      endTime: null,
      kind: "notification-silence",
      policyId: null,
      startTime: null,
      updatedAt: null,
    });
  });
});
