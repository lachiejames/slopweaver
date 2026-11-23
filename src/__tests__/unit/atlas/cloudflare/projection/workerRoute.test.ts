import { describe, expect, it } from "vitest";

import { projectCloudflareWorkerRoute } from "../../../../../atlas/cloudflare/projection/workerRoute.js";

const AT = "2026-01-01T00:00:00.000Z";
const ACCOUNT_ID = "a".repeat(32);
const ZONE_ID = "z".repeat(32);

describe("projectCloudflareWorkerRoute", () => {
  it("projects every field, keyed by the route id", () => {
    const entity = projectCloudflareWorkerRoute({
      accountId: ACCOUNT_ID,
      at: AT,
      raw: { id: "route-1", pattern: "example.test/*", script: "my-worker" },
      zoneId: ZONE_ID,
    });
    expect(entity.providerId).toBe("route-1");
    expect(entity.detail).toEqual({ kind: "worker-route", pattern: "example.test/*", script: "my-worker" });
  });

  it("defaults every missing field to null", () => {
    const entity = projectCloudflareWorkerRoute({
      accountId: ACCOUNT_ID,
      at: AT,
      raw: { id: "route-1" },
      zoneId: ZONE_ID,
    });
    expect(entity.detail).toEqual({ kind: "worker-route", pattern: null, script: null });
  });
});
