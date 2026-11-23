import { describe, expect, it } from "vitest";

import { projectCloudflareWorkerDomain } from "../../../../../atlas/cloudflare/projection/workerDomain.js";

const AT = "2026-01-01T00:00:00.000Z";
const ACCOUNT_ID = "a".repeat(32);

describe("projectCloudflareWorkerDomain", () => {
  it("projects a domain's present fields", () => {
    const entity = projectCloudflareWorkerDomain({
      accountId: ACCOUNT_ID,
      at: AT,
      domain: {
        cert_id: "cert-1",
        hostname: "app.example.test",
        id: "dom-1",
        service: "my-worker",
        zone_id: "zone-1",
        zone_name: "example.test",
      },
    });
    expect(entity.providerId).toBe("dom-1");
    expect(entity.scope.zoneId).toBe("zone-1");
    expect(entity.detail).toEqual({
      certificateId: "cert-1",
      hostname: "app.example.test",
      kind: "worker-domain",
      service: "my-worker",
      zoneId: "zone-1",
      zoneName: "example.test",
    });
  });

  it("defaults missing optional fields to null", () => {
    const entity = projectCloudflareWorkerDomain({
      accountId: ACCOUNT_ID,
      at: AT,
      domain: { hostname: "app.example.test", id: "dom-1" },
    });
    expect(entity.scope.zoneId).toBeNull();
    expect(entity.detail).toEqual({
      certificateId: null,
      hostname: "app.example.test",
      kind: "worker-domain",
      service: null,
      zoneId: null,
      zoneName: null,
    });
  });
});
