import { describe, expect, it } from "vitest";

import type { ClaudeRotationError } from "../../../claude/errors.js";
import { probePlan } from "../../../claude/probeStore.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";

/**
 * The HTTP status off a CREDENTIAL_REJECTED error, so no assertion carries a conditional
 * (`.claude/rules/testing.md`). The caller asserts the code first; this narrows outside the `expect`.
 */
const rejectedStatus = ({ error }: { error: ClaudeRotationError }): number =>
  error.code === "CREDENTIAL_REJECTED" ? error.status : -1;

const NOW = "2026-09-12T06:00:00.000Z";
const STORE = "/stores/plan-two";

/** A credential document a probe can present, expired but holding a live grant. */
const LIVE_DOCUMENT = {
  claudeAiOauth: {
    accessToken: "the-token",
    expiresAt: 1_757_658_300_000,
    refreshToken: "the-grant",
    refreshTokenExpiresAt: 1_791_720_012_373,
  },
};

/** The headers a healthy gauge response carries. */
const GAUGE_HEADERS: Readonly<Record<string, string>> = {
  "anthropic-organization-id": "org-abc",
  "anthropic-ratelimit-unified-5h-reset": "1788459000",
  "anthropic-ratelimit-unified-5h-status": "allowed",
  "anthropic-ratelimit-unified-5h-utilization": "0.34",
  "anthropic-ratelimit-unified-7d-reset": "1788645600",
  "anthropic-ratelimit-unified-7d-status": "allowed",
  "anthropic-ratelimit-unified-7d-utilization": "0.34",
  "anthropic-ratelimit-unified-status": "allowed",
};

describe("probePlan carries a TYPED reading the gate can branch on", () => {
  it("reports a 401 as CREDENTIAL_REJECTED with the exact status, not as one flattened sentence", async () => {
    // The whole reason the typed reading travels beside the renderable one. A `401` and a dead network used to
    // arrive as two different `problem` strings, so the only way to tell them apart was to match text — and
    // they need opposite responses: one is repairable on demand, the other must attempt nothing at all.
    const result = await probePlan({
      alias: "plan-two",
      deps: { read: () => LIVE_DOCUMENT, request: async () => ({ headers: {}, status: 401 }) },
      nowIso: NOW,
      storeDir: STORE,
    });
    const error = unwrapErr(result.reading);
    expect(error.code).toBe("CREDENTIAL_REJECTED");
    expect(result.outcome.problem).toBe(error.message);
  });

  it("reports a 403 the same way, with its own status", async () => {
    const result = await probePlan({
      alias: "plan-two",
      deps: { read: () => LIVE_DOCUMENT, request: async () => ({ headers: {}, status: 403 }) },
      nowIso: NOW,
      storeDir: STORE,
    });
    const error = unwrapErr(result.reading);
    expect(error.code).toBe("CREDENTIAL_REJECTED");
    expect(rejectedStatus({ error })).toBe(403);
  });

  it("reports a thrown request as PROBE_TRANSPORT_FAILED, which earns no refresh", async () => {
    const result = await probePlan({
      alias: "plan-two",
      deps: {
        read: () => LIVE_DOCUMENT,
        request: async () => {
          throw new Error("fetch failed");
        },
      },
      nowIso: NOW,
      storeDir: STORE,
    });
    expect(unwrapErr(result.reading).code).toBe("PROBE_TRANSPORT_FAILED");
  });

  it("reports a malformed gauge as USAGE_SHAPE_CHANGED, which is neither a refusal nor the network", async () => {
    const result = await probePlan({
      alias: "plan-two",
      deps: { read: () => LIVE_DOCUMENT, request: async () => ({ headers: { "x-unrelated": "1" }, status: 200 }) },
      nowIso: NOW,
      storeDir: STORE,
    });
    expect(unwrapErr(result.reading).code).toBe("USAGE_SHAPE_CHANGED");
  });

  it("reports STORE_NOT_READY and makes NO request when the store holds no access token", async () => {
    let requests = 0;
    const result = await probePlan({
      alias: "plan-two",
      deps: {
        read: () => ({ claudeAiOauth: { accessToken: "", refreshToken: "" } }),
        request: async () => {
          requests += 1;
          return { headers: {}, status: 200 };
        },
      },
      nowIso: NOW,
      storeDir: STORE,
    });
    expect(unwrapErr(result.reading).code).toBe("STORE_NOT_READY");
    expect(requests).toBe(0);
  });

  it("reports a healthy response as a gauge, and renders the same conclusion", async () => {
    const result = await probePlan({
      alias: "plan-two",
      deps: { read: () => LIVE_DOCUMENT, request: async () => ({ headers: GAUGE_HEADERS, status: 200 }) },
      nowIso: NOW,
      storeDir: STORE,
    });
    expect(unwrap(result.reading).alias).toBe("plan-two");
    expect(result.outcome.gauge).toStrictEqual(unwrap(result.reading));
    expect(result.organizationId).toBe("org-abc");
  });
});

describe("probePlan carries what the probe COST, so the under-a-hundred-tokens exemption is measured", () => {
  const COST = { inputTokens: 22, outputTokens: 1 };

  it("puts a measured cost on both the typed result and the printable outcome", async () => {
    const result = await probePlan({
      alias: "plan-two",
      deps: { read: () => LIVE_DOCUMENT, request: async () => ({ cost: COST, headers: GAUGE_HEADERS, status: 200 }) },
      nowIso: NOW,
      storeDir: STORE,
    });
    expect(result.probeCost).toStrictEqual(COST);
    expect(result.outcome.probeCost).toStrictEqual(COST);
  });

  it("carries the cost of a REFUSED probe too, because a refusal still spent a request", async () => {
    const result = await probePlan({
      alias: "plan-two",
      deps: { read: () => LIVE_DOCUMENT, request: async () => ({ cost: COST, headers: {}, status: 401 }) },
      nowIso: NOW,
      storeDir: STORE,
    });
    expect(unwrapErr(result.reading).code).toBe("CREDENTIAL_REJECTED");
    expect(result.outcome.probeCost).toStrictEqual(COST);
  });

  it("carries a setup-token plan's cost through the token probe, not only a store's", async () => {
    const result = await probePlan({
      alias: "plan-two",
      deps: {
        read: () => LIVE_DOCUMENT,
        readToken: () => ({ kind: "token", token: "the-setup-token" }),
        request: async () => ({ cost: COST, headers: GAUGE_HEADERS, status: 200 }),
      },
      nowIso: NOW,
      storeDir: STORE,
    });
    expect(result.probeCost).toStrictEqual(COST);
    expect(result.outcome.probeCost).toStrictEqual(COST);
  });

  it("prints NO cost key when the response stated none — unmeasured is never zero", async () => {
    const result = await probePlan({
      alias: "plan-two",
      deps: { read: () => LIVE_DOCUMENT, request: async () => ({ headers: GAUGE_HEADERS, status: 200 }) },
      nowIso: NOW,
      storeDir: STORE,
    });
    expect(Object.keys(result.outcome).toSorted()).toStrictEqual(["alias", "gauge"]);
    expect(Object.keys(result).includes("probeCost")).toBe(false);
  });
});

describe("probePlan reads the store ONCE, and never refreshes", () => {
  // The "never refreshes" half is a property of the SHAPE rather than of an observable effect: this function
  // has no subprocess seam at all, so there is nothing a runtime assertion here could catch that typechecking
  // does not already refuse. A test that watched a local document for a write it cannot receive would report
  // clean whatever the code did, so it is deliberately absent rather than written weakly. What is asserted is
  // the falsifiable half: one read, and the metadata taken from it.
  it("takes the lifetime metadata and the presented token from the same single read", async () => {
    // A repair decision must be taken on the expiry of the credential that was actually refused. Two reads
    // could straddle a refresh by another process and have the gate judge a token nothing presented.
    let reads = 0;
    const result = await probePlan({
      alias: "plan-two",
      deps: {
        read: () => {
          reads += 1;
          return LIVE_DOCUMENT;
        },
        request: async () => ({ headers: {}, status: 401 }),
      },
      nowIso: NOW,
      storeDir: STORE,
    });
    expect(reads).toBe(1);
    expect(result.life).toStrictEqual({
      alias: "plan-two",
      expiresAtIso: "2025-09-12T06:25:00.000Z",
      hasCredential: true,
      hasRefreshToken: true,
      refreshExpiresAtIso: "2026-10-11T12:00:12.373Z",
    });
  });

  it("carries a store's lifetime even for a refusal, which is what makes the repair decision possible", async () => {
    const result = await probePlan({
      alias: "plan-two",
      deps: { read: () => LIVE_DOCUMENT, request: async () => ({ headers: {}, status: 401 }) },
      nowIso: NOW,
      storeDir: STORE,
    });
    expect(result.life.hasRefreshToken).toBe(true);
    expect(result.life.refreshExpiresAtIso).toBe("2026-10-11T12:00:12.373Z");
  });

  it("renders no organisation id into the printable outcome, which is a private identifier", async () => {
    const result = await probePlan({
      alias: "plan-two",
      deps: { read: () => LIVE_DOCUMENT, request: async () => ({ headers: GAUGE_HEADERS, status: 200 }) },
      nowIso: NOW,
      storeDir: STORE,
    });
    expect(JSON.stringify(result.outcome).includes("org-abc")).toBe(false);
  });

  it("presents no token in anything it returns", async () => {
    const result = await probePlan({
      alias: "plan-two",
      deps: { read: () => LIVE_DOCUMENT, request: async () => ({ headers: GAUGE_HEADERS, status: 200 }) },
      nowIso: NOW,
      storeDir: STORE,
    });
    const rendered = JSON.stringify(result);
    expect(rendered.includes("the-token")).toBe(false);
    expect(rendered.includes("the-grant")).toBe(false);
  });
});
