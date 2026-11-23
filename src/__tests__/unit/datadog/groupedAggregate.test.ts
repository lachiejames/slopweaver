import type { v2 } from "@datadog/datadog-api-client";
import { describe, expect, it } from "vitest";

import { bucketsFromResponse, groupedAggregateFrom } from "../../../datadog/groupedAggregate.js";

describe("groupedAggregateFrom — truncation is judged on what came back, not what was kept", () => {
  const readable = Array.from({ length: 19 }, (_unused, index) => ({
    by: { service: `svc-${index}` },
    computes: { c0: 5 },
  }));

  it("calls a limit-sized answer truncated even when one bucket's count was unreadable and dropped", () => {
    const response: v2.LogsAggregateResponse = {
      data: { buckets: [...readable, { by: { service: "unreadable" }, computes: {} }] },
    };
    const read = groupedAggregateFrom({ facetCount: 1, limit: 20, response });
    expect(read.buckets).toHaveLength(19);
    expect(read.truncated).toBe(true);
  });

  it("calls a short answer complete", () => {
    const response: v2.LogsAggregateResponse = { data: { buckets: readable } };
    expect(groupedAggregateFrom({ facetCount: 1, limit: 20, response }).truncated).toBe(false);
  });

  it("raises the ceiling to the limit per facet, so a two-facet answer of 20 is not full", () => {
    const response: v2.LogsAggregateResponse = { data: { buckets: [...readable, readable[0]!] } };
    expect(groupedAggregateFrom({ facetCount: 2, limit: 20, response }).truncated).toBe(false);
  });
});

describe("bucketsFromResponse — reading a grouped aggregate", () => {
  it("reads a numeric c0 per bucket, and the by facet values as strings", () => {
    const response: v2.LogsAggregateResponse = {
      data: {
        buckets: [
          { by: { env: "production" }, computes: { c0: 900 } },
          { by: { env: "staging" }, computes: { c0: 100 } },
        ],
      },
    };
    expect(bucketsFromResponse({ response })).toEqual([
      { by: { env: "production" }, count: 900 },
      { by: { env: "staging" }, count: 100 },
    ]);
  });

  it("reads a count that arrived as a string, the same shape logsCount.ts guards against", () => {
    const response: v2.LogsAggregateResponse = { data: { buckets: [{ by: { env: "prod" }, computes: { c0: "42" } }] } };
    expect(bucketsFromResponse({ response })).toEqual([{ by: { env: "prod" }, count: 42 }]);
  });

  it("reads a differently-named facet the same way, since the reader is facet-agnostic", () => {
    const response: v2.LogsAggregateResponse = {
      data: { buckets: [{ by: { focusType: "Invoice" }, computes: { c0: 7 } }] },
    };
    expect(bucketsFromResponse({ response })).toEqual([{ by: { focusType: "Invoice" }, count: 7 }]);
  });

  it("maps an undefined by-value to null, the untagged encoding classifyEnvFacet expects", () => {
    const response: v2.LogsAggregateResponse = { data: { buckets: [{ by: {}, computes: { c0: 5 } }] } };
    expect(bucketsFromResponse({ response })).toEqual([{ by: {}, count: 5 }]);
  });

  it("reads a JSON null by record as no facets, since the SDK deserialiser passes a null through untouched", () => {
    const response: v2.LogsAggregateResponse = JSON.parse('{"data":{"buckets":[{"by":null,"computes":{"c0":5}}]}}');
    expect(bucketsFromResponse({ response })).toEqual([{ by: {}, count: 5 }]);
  });

  it("drops a bucket with no c0 compute rather than reading it as zero", () => {
    const response: v2.LogsAggregateResponse = { data: { buckets: [{ by: { env: "prod" }, computes: {} }] } };
    expect(bucketsFromResponse({ response })).toEqual([]);
  });

  it("drops a bucket whose count is not a number, rather than coercing NaN into zero", () => {
    const response: v2.LogsAggregateResponse = {
      data: { buckets: [{ by: { env: "prod" }, computes: { c0: "lots" } }] },
    };
    expect(bucketsFromResponse({ response })).toEqual([]);
  });

  it("reads an empty bucket list as no buckets, not a thrown error", () => {
    expect(bucketsFromResponse({ response: { data: { buckets: [] } } })).toEqual([]);
  });

  it("reads a wholly absent buckets field as no buckets", () => {
    expect(bucketsFromResponse({ response: {} })).toEqual([]);
  });
});
