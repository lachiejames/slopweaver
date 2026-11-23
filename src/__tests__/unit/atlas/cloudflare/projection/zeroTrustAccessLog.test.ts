import { describe, expect, it } from "vitest";

import { projectCloudflareAccessAuthenticationEvent } from "../../../../../atlas/cloudflare/projection/zeroTrustAccessLog.js";

// The keyed, full-row and SCIM cases live in `zeroTrustAccessAdmin.test.ts`, which reaches these projections
// through that module's re-export; this file holds what the move added.

const AT = "2026-01-01T00:00:00.000Z";
const ACCOUNT_ID = "a".repeat(32);

describe("projectCloudflareAccessAuthenticationEvent", () => {
  it("stores exactly null for each optional a minimal event omits", () => {
    const entity = projectCloudflareAccessAuthenticationEvent({
      accountId: ACCOUNT_ID,
      at: AT,
      event: { created_at: "2026-01-01T00:00:05Z", ray_id: "ray-min" },
    });
    expect(entity.providerId).toBe("auth:2026-01-01T00:00:05Z:ray-min");
    expect(entity.detail).toEqual({
      action: null,
      allowed: null,
      appDomain: null,
      appName: null,
      appType: null,
      appUid: null,
      connection: null,
      country: null,
      entryKind: "authentication",
      ipAddress: null,
      kind: "access-authentication-log",
      loggedAt: "2026-01-01T00:00:05Z",
      rayId: "ray-min",
      userEmail: null,
      userId: null,
    });
  });
});
