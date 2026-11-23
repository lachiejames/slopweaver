import { describe, expect, it } from "vitest";
import {
  foldLinearRequest,
  type HeaderBag,
  headerValue,
  type LinearRawRequest,
  makeLinearTransport,
  parseLinearCost,
  resetSharedLinearTransports,
  sharedLinearTransport,
  ZERO_LINEAR_STATS,
} from "../../../../corpus/linear/transport.js";
import type { RateScheduler } from "../../../../lib/resilience.js";
import { ok } from "../../../../lib/result.js";

/** A pass-through scheduler: no pacing, so a request-count test runs in no wall time. */
const passthrough: RateScheduler = (task) => task();

/** A raw seam returning one fixed payload + headers, recording every query it was asked for. */
function fakeRaw({
  calls,
  data,
  headers,
}: {
  calls: string[];
  data: unknown;
  headers?: Readonly<Record<string, string>>;
}): LinearRawRequest {
  return async ({ query }) => {
    calls.push(query);
    return { data, ...(headers !== undefined ? { headers } : {}) };
  };
}

/** A monotonic fake clock advancing a fixed step per reading, so a latency total is exact. */
function fakeClock({ stepMs }: { stepMs: number }): () => number {
  let value = 0;
  return () => {
    value += stepMs;
    return value;
  };
}

describe("headerValue (pure — both header shapes)", () => {
  it("reads a Headers-like bag via get", () => {
    // Annotated so the fake INHERITS `HeaderBag` instead of restating `get`'s shape.
    const bag: HeaderBag = { get: (name) => (name === "x-complexity" ? "474" : null) };
    expect(headerValue({ headers: bag, name: "x-complexity" })).toBe("474");
  });

  it("returns undefined when a Headers-like bag has no such header", () => {
    const bag = { get: () => null };
    expect(headerValue({ headers: bag, name: "x-complexity" })).toBeUndefined();
  });

  it("reads a plain record case-insensitively, so a canonically-spelled fixture is not invisible", () => {
    expect(headerValue({ headers: { "X-Complexity": "1154" }, name: "x-complexity" })).toBe("1154");
  });

  it("returns undefined for absent headers and for an empty value", () => {
    expect(headerValue({ headers: undefined, name: "x-complexity" })).toBeUndefined();
    expect(headerValue({ headers: { "x-complexity": "" }, name: "x-complexity" })).toBeUndefined();
  });
});

describe("parseLinearCost (pure)", () => {
  it("reads the reported complexity and both remaining budgets", () => {
    expect(
      parseLinearCost({
        headers: {
          "x-complexity": "474",
          "x-ratelimit-complexity-remaining": "2999526",
          "x-ratelimit-requests-remaining": "2499",
        },
      }),
    ).toEqual({ complexity: 474, complexityRemaining: 2_999_526, requestsRemaining: 2499 });
  });

  it("reports an absent x-complexity as absent, NOT as a free query", () => {
    expect(parseLinearCost({ headers: { "x-ratelimit-requests-remaining": "10" } })).toEqual({
      requestsRemaining: 10,
    });
  });

  it("drops an unparseable or negative reading rather than recording a nonsense number", () => {
    expect(parseLinearCost({ headers: { "x-complexity": "unknown" } })).toEqual({});
    expect(parseLinearCost({ headers: { "x-complexity": "-5" } })).toEqual({});
  });
});

describe("foldLinearRequest (pure accounting)", () => {
  it("counts the request and sums bytes, latency and complexity", () => {
    const folded = foldLinearRequest({
      observed: { bytes: 120, complexity: 474, latencyMs: 30 },
      stats: ZERO_LINEAR_STATS,
    });
    expect(folded).toEqual({
      bytes: 120,
      complexity: 474,
      latencyMs: 30,
      requests: 1,
      unpricedResponses: 0,
    });
  });

  it("counts an unpriced response so a zero complexity total cannot pass as a free crawl", () => {
    const folded = foldLinearRequest({ observed: { bytes: 10, latencyMs: 1 }, stats: ZERO_LINEAR_STATS });
    expect(folded.complexity).toBe(0);
    expect(folded.unpricedResponses).toBe(1);
  });

  it("leaves a running complexity total where it was when a later response is unpriced", () => {
    const priced = foldLinearRequest({
      observed: { bytes: 1, complexity: 474, latencyMs: 1 },
      stats: ZERO_LINEAR_STATS,
    });
    const unpriced = foldLinearRequest({ observed: { bytes: 1, latencyMs: 1 }, stats: priced });
    expect(unpriced.complexity).toBe(474);
    expect(unpriced.unpricedResponses).toBe(1);
    expect(
      foldLinearRequest({ observed: { bytes: 1, complexity: 26, latencyMs: 1 }, stats: unpriced }).complexity,
    ).toBe(500);
  });

  it("takes the LATEST remaining-budget reading rather than summing snapshots", () => {
    const first = foldLinearRequest({
      observed: { bytes: 1, latencyMs: 1, requestsRemaining: 2499 },
      stats: ZERO_LINEAR_STATS,
    });
    const second = foldLinearRequest({ observed: { bytes: 1, latencyMs: 1, requestsRemaining: 2498 }, stats: first });
    expect(second.requestsRemaining).toBe(2498);
    expect(second.requests).toBe(2);
  });

  it("keeps the last known remaining reading when a later response omits it", () => {
    const first = foldLinearRequest({
      observed: { bytes: 1, complexityRemaining: 500, latencyMs: 1 },
      stats: ZERO_LINEAR_STATS,
    });
    const second = foldLinearRequest({ observed: { bytes: 1, latencyMs: 1 }, stats: first });
    expect(second.complexityRemaining).toBe(500);
  });
});

describe("makeLinearTransport (the one gated + observed seam)", () => {
  it("returns the response data and observes the request's real cost", async () => {
    const calls: string[] = [];
    const transport = makeLinearTransport({
      now: fakeClock({ stepMs: 7 }),
      raw: fakeRaw({ calls, data: { issues: { nodes: [] } }, headers: { "x-complexity": "474" } }),
      scheduler: passthrough,
      token: "t",
    });
    const data = await transport.request({ query: "query Issues { issues { nodes { id } } }", variables: {} });
    expect(data).toEqual({ issues: { nodes: [] } });
    expect(calls.length).toBe(1);
    const stats = transport.stats();
    expect(stats.requests).toBe(1);
    expect(stats.complexity).toBe(474);
    expect(stats.latencyMs).toBe(7);
    expect(stats.bytes).toBe(JSON.stringify({ issues: { nodes: [] } }).length);
  });

  it("accumulates across requests, so a crawl's whole spend is one reading", async () => {
    const calls: string[] = [];
    const transport = makeLinearTransport({
      now: fakeClock({ stepMs: 5 }),
      raw: fakeRaw({ calls, data: ok(undefined), headers: { "x-complexity": "100" } }),
      scheduler: passthrough,
      token: "t",
    });
    await transport.request({ query: "a", variables: {} });
    await transport.request({ query: "b", variables: {} });
    await transport.request({ query: "c", variables: {} });
    const stats = transport.stats();
    expect(stats.requests).toBe(3);
    expect(stats.complexity).toBe(300);
    expect(stats.latencyMs).toBe(15);
  });

  it("starts at zero before any request", () => {
    const transport = makeLinearTransport({
      raw: fakeRaw({ calls: [], data: {} }),
      scheduler: passthrough,
      token: "t",
    });
    expect(transport.stats()).toEqual(ZERO_LINEAR_STATS);
  });
});

describe("sharedLinearTransport (one transport per token, structurally)", () => {
  it("hands the SAME transport back for one token, so one scheduler holds the whole budget", () => {
    resetSharedLinearTransports();
    const first = sharedLinearTransport({ token: "same-token" });
    const second = sharedLinearTransport({ token: "same-token" });
    expect(second).toBe(first);
    resetSharedLinearTransports();
  });

  it("keeps two tokens apart — a shared quota is not a shared client", () => {
    resetSharedLinearTransports();
    const a = sharedLinearTransport({ token: "token-a" });
    const b = sharedLinearTransport({ token: "token-b" });
    expect(b === a).toBe(false);
    resetSharedLinearTransports();
  });

  it("rebuilds after a reset", () => {
    resetSharedLinearTransports();
    const before = sharedLinearTransport({ token: "t" });
    resetSharedLinearTransports();
    const after = sharedLinearTransport({ token: "t" });
    expect(after === before).toBe(false);
    resetSharedLinearTransports();
  });
});
