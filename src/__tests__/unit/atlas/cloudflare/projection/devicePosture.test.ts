import { describe, expect, it } from "vitest";

import { projectCloudflareDevicePostureRule } from "../../../../../atlas/cloudflare/projection/devicePosture.js";

const AT = "2026-01-01T00:00:00.000Z";
const ACCOUNT_ID = "a".repeat(32);

describe("projectCloudflareDevicePostureRule", () => {
  it("projects every stable field", () => {
    const entity = projectCloudflareDevicePostureRule({
      accountId: ACCOUNT_ID,
      at: AT,
      rule: {
        description: "Requires WARP",
        expiration: "24h",
        id: "rule-1",
        input: { require_all: true },
        match: [{ platform: "mac" }],
        name: "WARP check",
        schedule: "5m",
        type: "warp",
      },
    });
    expect(entity.kind).toBe("device-posture-rule");
    expect(entity.providerId).toBe("rule-1");
    expect(entity.detail).toEqual({
      description: "Requires WARP",
      expiration: "24h",
      input: { require_all: true },
      kind: "device-posture-rule",
      match: [{ platform: "mac" }],
      name: "WARP check",
      schedule: "5m",
      type: "warp",
    });
  });

  it("defaults every optional field to null when the SDK omits it", () => {
    const entity = projectCloudflareDevicePostureRule({ accountId: ACCOUNT_ID, at: AT, rule: { id: "rule-1" } });
    expect(entity.detail).toEqual({
      description: null,
      expiration: null,
      input: null,
      kind: "device-posture-rule",
      match: null,
      name: null,
      schedule: null,
      type: null,
    });
  });
});
