/**
 * The rate-limit registry. Pure data plus two pure lookups, so the assertions are on exact numbers.
 *
 * The tests that matter are the ones that pin the SAFE DIRECTION: an unclassified operation must be paced
 * as the tightest class rather than the fastest, and `chat.postMessage` must not inherit `chat.update`'s
 * tier — the two differ in quota and, more importantly, in reversibility.
 */
import { describe, expect, it } from "vitest";

import { OPERATION_ENDPOINT_CLASS } from "../../../lib/operationEndpointClass.js";
import {
  effectiveRatePerSec,
  endpointClassFor,
  PROVIDER_RATE_LIMITS,
  unverifiedQuotas,
} from "../../../lib/rateLimits.js";

describe("the registry as data", () => {
  it("records Slack's scope as per-workspace, which is what a shared block keys on", () => {
    expect(PROVIDER_RATE_LIMITS["slack"]!.scope).toBe("per-workspace");
  });

  it("records GitHub and Notion as per-token, so two workspaces never share their block", () => {
    expect(PROVIDER_RATE_LIMITS["github"]!.scope).toBe("per-token");
    expect(PROVIDER_RATE_LIMITS["notion"]!.scope).toBe("per-token");
  });

  // Linear says the budget follows the person, not the key: several keys owned by one user share one quota.
  it("records Linear as per-user, because several of one person's keys share a budget", () => {
    expect(PROVIDER_RATE_LIMITS["linear"]!.scope).toBe("per-user");
  });

  it("derates every quota rather than running at the documented limit, KnowBe4's shared account further", () => {
    const factors = Object.entries(PROVIDER_RATE_LIMITS).flatMap(([provider, limits]) =>
      Object.values(limits.endpointClasses).map((quota) => [provider, quota.safetyFactor] as const),
    );
    expect(factors.length).toBeGreaterThan(0);
    expect(factors.filter(([, factor]) => factor !== 0.8)).toEqual([["knowbe4", 0.3]]);
  });

  it("carries a date and a method for every single quota, so no number is folklore", () => {
    // The date is asserted as a real ISO DAY rather than one literal. Pinning a single date made the test
    // fail the first time a quota was recorded on a different day, which pushed toward back-dating the new
    // entry to match — the exact folklore this test exists to prevent. The shape is what carries the intent.
    for (const limits of Object.values(PROVIDER_RATE_LIMITS)) {
      for (const quota of Object.values(limits.endpointClasses)) {
        expect(/^\d{4}-\d{2}-\d{2}$/.test(quota.verification.onIso)).toBe(true);
        expect(Number.isNaN(Date.parse(quota.verification.onIso))).toBe(false);
        expect(quota.verification.method.length).toBeGreaterThan(20);
      }
    }
  });

  it("names each provider's fallback class as one it actually defines", () => {
    for (const limits of Object.values(PROVIDER_RATE_LIMITS)) {
      expect(Object.keys(limits.endpointClasses)).toContain(limits.fallbackClass);
    }
  });

  it("uses Slack's TIGHTEST tier as its fallback", () => {
    const slack = PROVIDER_RATE_LIMITS["slack"]!;
    const rates = Object.entries(slack.endpointClasses).map(([name, quota]) => ({
      name,
      perSec: quota.documentedLimit / quota.intervalMs,
    }));
    const slowest = rates.toSorted((left, right) => left.perSec - right.perSec)[0]!;
    expect(slack.fallbackClass).toBe(slowest.name);
  });
});

describe("unverifiedQuotas", () => {
  // Linear's READ class is now the one measured quota in the registry — asked of the live API
  // rather than transcribed from docs. Everything else is still documented-only, and this
  // assertion is written as "all but one" so converting the next one fails here and has to be stated.
  it("reports every quota as unverified EXCEPT Linear read, the one that has been measured", () => {
    const unverified = unverifiedQuotas();
    const total = Object.values(PROVIDER_RATE_LIMITS).reduce(
      (count, limits) => count + Object.keys(limits.endpointClasses).length,
      0,
    );

    expect(unverified).toHaveLength(total - 1);
    expect(unverified.filter((q) => q.provider === "linear" && q.endpointClass === "read")).toEqual([]);
  });

  it("names the provider and class of each, so a diagnostic can list what needs measuring", () => {
    const slackEntries = unverifiedQuotas().filter((entry) => entry.provider === "slack");
    expect(slackEntries.map((entry) => entry.endpointClass).toSorted()).toEqual([
      "assistant-status",
      "chat-post",
      "tier1",
      "tier2",
      "tier3",
      "tier4",
    ]);
  });
});

describe("endpointClassFor", () => {
  it("classifies chat.postMessage into its OWN class, never chat.update's tier", () => {
    expect(endpointClassFor({ operation: "slack.chat.postMessage", provider: "slack" })).toEqual({
      classified: true,
      endpointClass: "chat-post",
    });
    expect(endpointClassFor({ operation: "slack.chat.update", provider: "slack" })).toEqual({
      classified: true,
      endpointClass: "tier3",
    });
  });

  it("classifies both derived post operations the same as the base one", () => {
    expect(endpointClassFor({ operation: "slack.chat.postMessage.drip", provider: "slack" }).endpointClass).toBe(
      "chat-post",
    );
    expect(endpointClassFor({ operation: "slack.chat.postMessage.progress", provider: "slack" }).endpointClass).toBe(
      "chat-post",
    );
  });

  it("falls back to the tightest class for an operation nobody registered, and SAYS it fell back", () => {
    expect(endpointClassFor({ operation: "slack.something.brandNew", provider: "slack" })).toEqual({
      classified: false,
      endpointClass: "tier1",
    });
  });

  it("does not match by prefix, which is how a post would inherit an update's tier", () => {
    // `slack.chat.` is a prefix of both, and they are deliberately in different classes.
    expect(endpointClassFor({ operation: "slack.chat.", provider: "slack" }).classified).toBe(false);
  });

  it("reports an unknown provider without inventing a class", () => {
    expect(endpointClassFor({ operation: "whatever", provider: "notaprovider" })).toEqual({
      classified: false,
      endpointClass: "unknown",
    });
  });
});

describe("effectiveRatePerSec", () => {
  it("derates Slack's tier 3 from 50/min to 40/min", () => {
    expect(effectiveRatePerSec({ operation: "slack.conversations.history", provider: "slack" })).toBeCloseTo(0.6667, 3);
  });

  it("gives chat.postMessage its documented ~1/sec, derated", () => {
    expect(effectiveRatePerSec({ operation: "slack.chat.postMessage", provider: "slack" })).toBeCloseTo(0.8, 5);
  });

  it("paces an unregistered Slack operation at tier 1, which is 80% of one per minute", () => {
    expect(effectiveRatePerSec({ operation: "slack.brand.new", provider: "slack" })).toBeCloseTo(0.01333, 4);
  });

  it("returns undefined for a provider with no registry entry rather than guessing a rate", () => {
    expect(effectiveRatePerSec({ operation: "x", provider: "notaprovider" })).toBeUndefined();
  });
});

describe("the operation map", () => {
  it("maps every operation to a class its provider defines", () => {
    for (const [operation, endpointClass] of Object.entries(OPERATION_ENDPOINT_CLASS)) {
      const provider = operation.split(".")[0]!;
      expect(Object.keys(PROVIDER_RATE_LIMITS[provider]!.endpointClasses)).toContain(endpointClass);
    }
  });
});
