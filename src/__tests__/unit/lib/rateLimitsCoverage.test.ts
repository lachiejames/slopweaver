/**
 * The registry's SAFETY properties — the ones the `operation-labels` gate exists to protect.
 *
 * The gate proves label coverage mechanically over the real tree during `yarn lint`. What a unit test can
 * add is the other half of the argument: that an unmapped label is genuinely dangerous rather than merely
 * untidy, and that each provider's scope key matches the quota model the registry records. Those two facts
 * are what make the gate worth having, and neither is asserted anywhere else.
 */
import { describe, expect, it } from "vitest";
import { scopeIdForToken } from "../../../lib/providerCall.js";
import {
  effectiveRatePerSec,
  endpointClassFor,
  OPERATION_ENDPOINT_CLASS,
  PROVIDER_RATE_LIMITS,
  unverifiedQuotas,
} from "../../../lib/rateLimits.js";

describe("the unmapped-label trap the operation-labels gate guards", () => {
  it("falls an unknown Slack operation back to tier1", () => {
    const { endpointClass, classified } = endpointClassFor({ operation: "slack.not.mapped", provider: "slack" });
    expect(classified).toBe(false);
    expect(endpointClass).toBe("tier1");
  });

  it("makes that fallback a 75-SECOND interval — why an unmapped label is a hang, not a nuisance", () => {
    const rate = effectiveRatePerSec({ operation: "slack.not.mapped", provider: "slack" });
    // 1 call/min documented x 0.8 = 0.0133/s, and createRateScheduler's interval is round(1000 / rate).
    expect(rate).toBeCloseTo(0.013333, 6);
    expect(Math.round(1000 / rate!)).toBe(75_000);
  });

  it("classifies every label the registry DOES know, so a mapped label never reaches the fallback", () => {
    const unclassified = Object.keys(OPERATION_ENDPOINT_CLASS).filter(
      (operation) => !endpointClassFor({ operation, provider: operation.split(".")[0]! }).classified,
    );
    expect(unclassified).toEqual([]);
  });

  it("maps the two labels PR5.2.1b added, including both static write-lane literals", () => {
    expect(OPERATION_ENDPOINT_CLASS["slack.conversations.members"]).toBe("tier4");
    expect(OPERATION_ENDPOINT_CLASS["slack.auth.test.write.bot"]).toBe("tier4");
    expect(OPERATION_ENDPOINT_CLASS["slack.auth.test.write.user"]).toBe("tier4");
  });

  it("gives the thinking indicator its OWN class rather than borrowing chat-post", () => {
    expect(OPERATION_ENDPOINT_CLASS["slack.assistant.threads.setStatus"]).toBe("assistant-status");
    expect(PROVIDER_RATE_LIMITS["slack"]!.endpointClasses["assistant-status"]!.documentedLimit).toBe(600);
    expect(PROVIDER_RATE_LIMITS["slack"]!.endpointClasses["assistant-status"]).not.toBe(
      PROVIDER_RATE_LIMITS["slack"]!.endpointClasses["chat-post"],
    );
  });

  it("points every provider's fallback at a class that actually exists in that provider's table", () => {
    const missing = Object.entries(PROVIDER_RATE_LIMITS)
      .filter(([, limits]) => limits.endpointClasses[limits.fallbackClass] === undefined)
      .map(([provider]) => provider);
    expect(missing).toEqual([]);
  });

  it("makes each provider's fallback its TIGHTEST class, so an unknown label is slow and never dangerous", () => {
    const notTightest = Object.entries(PROVIDER_RATE_LIMITS)
      .filter(([, limits]) => {
        const rates = Object.entries(limits.endpointClasses).map(
          ([, q]) => (q.documentedLimit / q.intervalMs) * q.safetyFactor,
        );
        const fallback = limits.endpointClasses[limits.fallbackClass]!;
        const fallbackRate = (fallback.documentedLimit / fallback.intervalMs) * fallback.safetyFactor;
        return fallbackRate > Math.min(...rates);
      })
      .map(([provider]) => provider);
    expect(notTightest).toEqual([]);
  });
});

describe("scope model", () => {
  it("counts Slack per WORKSPACE, Linear per USER, and the other two per TOKEN", () => {
    expect(PROVIDER_RATE_LIMITS["slack"]!.scope).toBe("per-workspace");
    expect(PROVIDER_RATE_LIMITS["linear"]!.scope).toBe("per-user");
    expect(PROVIDER_RATE_LIMITS["github"]!.scope).toBe("per-token");
    expect(PROVIDER_RATE_LIMITS["notion"]!.scope).toBe("per-token");
  });

  it("gives one token one stable scope key, so repeated calls share a block", () => {
    expect(scopeIdForToken({ token: "xoxb-a" })).toBe(scopeIdForToken({ token: "xoxb-a" }));
  });

  it("gives two tokens different keys, so one workspace's 429 cannot block an unrelated one", () => {
    expect(scopeIdForToken({ token: "xoxb-a" })).not.toBe(scopeIdForToken({ token: "xoxb-b" }));
  });

  it("never leaks the token into the key — it lands in map keys and diagnostics", () => {
    // Deliberately NOT shaped like a real Slack token: the hygiene gate flags the SHAPE, not the origin, and
    // a fixture that trips it would be a reason to change the fixture rather than the gate.
    const token = "credential-with-a-distinctive-marker";
    const scopeId = scopeIdForToken({ token });
    expect(scopeId).not.toContain("marker");
    expect(scopeId).toHaveLength(16);
  });
});

describe("provenance honesty", () => {
  it("reports every quota as unverified except the one that was actually measured", () => {
    const unverified = unverifiedQuotas();
    // PR5.2.1b observed real Slack 429s but did not convert any entry to `measured`: an observation made
    // while the SDK was absorbing retries is not a measurement of the underlying quota. Linear read IS
    // converted, because `rateLimitStatus` was asked directly and answered 2,500/hour.
    expect(unverified.length).toBe(
      Object.values(PROVIDER_RATE_LIMITS).reduce((n, l) => n + Object.keys(l.endpointClasses).length, 0) - 1,
    );
    expect(unverified.every((q) => q.method.length > 0)).toBe(true);
  });
});
