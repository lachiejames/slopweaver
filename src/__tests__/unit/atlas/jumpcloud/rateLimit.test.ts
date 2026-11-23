import { describe, expect, it } from "vitest";

import { effectiveRatePerSec, endpointClassFor, PROVIDER_RATE_LIMITS } from "../../../../lib/rateLimits.js";

describe("JumpCloud is registered, so a full sync's every request is paced", () => {
  it("resolves an endpoint class instead of falling through to unknown", () => {
    const resolved = endpointClassFor({ operation: "jumpcloud.systems.list", provider: "jumpcloud" });
    expect(resolved.endpointClass).toBe("read");
  });

  it("returns a real requests-per-second ceiling rather than undefined", () => {
    const rate = effectiveRatePerSec({ operation: "jumpcloud.systems.list", provider: "jumpcloud" });
    expect(rate).toBeGreaterThan(0);
  });

  it("paces per token, because a JumpCloud key belongs to one administrator", () => {
    expect(PROVIDER_RATE_LIMITS["jumpcloud"]!.scope).toBe("per-token");
  });

  it("declares ONE class, because this atlas issues no writes", () => {
    expect(Object.keys(PROVIDER_RATE_LIMITS["jumpcloud"]!.endpointClasses)).toStrictEqual(["read"]);
  });

  it("files its ceiling as self-imposed, never as a vendor allowance that does not exist", () => {
    expect(PROVIDER_RATE_LIMITS["jumpcloud"]!.endpointClasses["read"]!.verification.status).toBe("self-imposed");
  });

  it("contrasts with an unregistered provider, which gets no pacing at all", () => {
    expect(endpointClassFor({ operation: "nowhere.list", provider: "not-a-provider" }).endpointClass).toBe("unknown");
    expect(effectiveRatePerSec({ operation: "nowhere.list", provider: "not-a-provider" })).toBe(undefined);
  });
});
