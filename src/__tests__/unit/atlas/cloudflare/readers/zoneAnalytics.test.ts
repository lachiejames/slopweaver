import { describe, expect, it } from "vitest";

import { createCloudflareClient } from "../../../../../atlas/cloudflare/client.js";
import {
  readCloudflareDnsQueriesAnalytics,
  readCloudflareHttpRequestsAnalytics,
} from "../../../../../atlas/cloudflare/readers/zoneAnalytics.js";
import { unwrap, unwrapErr } from "../../../../../lib/result.js";

const AT = "2026-01-01T00:00:00.000Z";
const ACCOUNT_ID = "a".repeat(32);
const ZONE_ID = "z".repeat(32);

function jsonResponse({ status, body }: { status: number; body: unknown }): Response {
  return new Response(JSON.stringify(body), { headers: { "content-type": "application/json" }, status });
}

describe("readCloudflareHttpRequestsAnalytics", () => {
  it("reads the trailing-24h window into one entity", async () => {
    const client = createCloudflareClient({
      apiToken: "t",
      fetchImpl: async () =>
        jsonResponse({
          body: {
            data: {
              viewer: {
                zones: [
                  {
                    httpRequestsAdaptiveGroups: [{ count: 5, dimensions: { datetimeHour: "2026-01-01T00:00:00Z" } }],
                  },
                ],
              },
            },
            errors: null,
          },
          status: 200,
        }),
      maxRetries: 0,
    });
    const entities = unwrap(
      await readCloudflareHttpRequestsAnalytics({ accountId: ACCOUNT_ID, at: AT, client, zoneId: ZONE_ID }),
    );
    expect(entities.map((entity) => entity.providerId)).toEqual(["http-requests"]);
    expect(entities[0]!.detail).toMatchObject({ rows: [{ count: 5, datetimeHour: "2026-01-01T00:00:00Z" }] });
  });

  it("treats an empty zones array as zero rows rather than throwing", async () => {
    const client = createCloudflareClient({
      apiToken: "t",
      fetchImpl: async () => jsonResponse({ body: { data: { viewer: { zones: [] } }, errors: null }, status: 200 }),
      maxRetries: 0,
    });
    const entities = unwrap(
      await readCloudflareHttpRequestsAnalytics({ accountId: ACCOUNT_ID, at: AT, client, zoneId: ZONE_ID }),
    );
    expect(entities[0]!.detail).toMatchObject({ rows: [] });
  });

  it("reads a listed zone whose dataset is null as zero rows, the reading it always had", async () => {
    const client = createCloudflareClient({
      apiToken: "t",
      fetchImpl: async () =>
        jsonResponse({
          body: { data: { viewer: { zones: [{ httpRequestsAdaptiveGroups: null }] } }, errors: null },
          status: 200,
        }),
      maxRetries: 0,
    });
    const entities = unwrap(
      await readCloudflareHttpRequestsAnalytics({ accountId: ACCOUNT_ID, at: AT, client, zoneId: ZONE_ID }),
    );
    expect(entities.map((entity) => entity.providerId)).toEqual(["http-requests"]);
    expect(entities[0]!.detail).toMatchObject({ rows: [] });
  });

  it("maps a 200-OK graphql errors array to a graphql-error result, never a false success", async () => {
    const client = createCloudflareClient({
      apiToken: "t",
      fetchImpl: async () =>
        jsonResponse({ body: { data: null, errors: [{ message: 'unknown field "x"' }] }, status: 200 }),
      maxRetries: 0,
    });
    const result = await readCloudflareHttpRequestsAnalytics({
      accountId: ACCOUNT_ID,
      at: AT,
      client,
      zoneId: ZONE_ID,
    });
    expect(unwrapErr(result).kind).toBe("graphql-error");
  });

  it("maps an HTTP error to the typed client error", async () => {
    const client = createCloudflareClient({
      apiToken: "t",
      fetchImpl: async () => jsonResponse({ body: { errors: [{ message: "denied" }], success: false }, status: 403 }),
      maxRetries: 0,
    });
    const result = await readCloudflareHttpRequestsAnalytics({
      accountId: ACCOUNT_ID,
      at: AT,
      client,
      zoneId: ZONE_ID,
    });
    expect(unwrapErr(result).kind).toBe("permission");
  });
});

describe("readCloudflareDnsQueriesAnalytics", () => {
  it("reads the trailing-24h window into one entity", async () => {
    const client = createCloudflareClient({
      apiToken: "t",
      fetchImpl: async () =>
        jsonResponse({
          body: {
            data: {
              viewer: {
                zones: [
                  {
                    dnsAnalyticsAdaptiveGroups: [
                      { avg: { sampleInterval: 1 }, count: 42, dimensions: { responseCode: "NOERROR" } },
                    ],
                  },
                ],
              },
            },
            errors: null,
          },
          status: 200,
        }),
      maxRetries: 0,
    });
    const entities = unwrap(
      await readCloudflareDnsQueriesAnalytics({ accountId: ACCOUNT_ID, at: AT, client, zoneId: ZONE_ID }),
    );
    expect(entities.map((entity) => entity.providerId)).toEqual(["dns-queries"]);
    expect(entities[0]!.detail).toMatchObject({ rows: [{ count: 42, responseCode: "NOERROR", sampleInterval: 1 }] });
  });

  it("reads a response listing no zone as zero rows — the assumed reading, not a proven contract", async () => {
    const client = createCloudflareClient({
      apiToken: "t",
      fetchImpl: async () => jsonResponse({ body: { data: { viewer: { zones: [] } }, errors: null }, status: 200 }),
      maxRetries: 0,
    });
    const entities = unwrap(
      await readCloudflareDnsQueriesAnalytics({ accountId: ACCOUNT_ID, at: AT, client, zoneId: ZONE_ID }),
    );
    expect(entities.map((entity) => entity.providerId)).toEqual(["dns-queries"]);
    expect(entities[0]!.detail).toMatchObject({ rows: [] });
  });

  it.each([
    { label: "null", zone: { dnsAnalyticsAdaptiveGroups: null } },
    { label: "missing", zone: {} },
  ])("reads a listed zone whose dataset is $label as zero rows, the reading it always had", async ({ zone }) => {
    const client = createCloudflareClient({
      apiToken: "t",
      fetchImpl: async () => jsonResponse({ body: { data: { viewer: { zones: [zone] } }, errors: null }, status: 200 }),
      maxRetries: 0,
    });
    const entities = unwrap(
      await readCloudflareDnsQueriesAnalytics({ accountId: ACCOUNT_ID, at: AT, client, zoneId: ZONE_ID }),
    );
    expect(entities.map((entity) => entity.providerId)).toEqual(["dns-queries"]);
    expect(entities[0]!.detail).toMatchObject({ rows: [] });
  });

  it("maps a 200-OK graphql errors array to a graphql-error result", async () => {
    const client = createCloudflareClient({
      apiToken: "t",
      fetchImpl: async () =>
        jsonResponse({ body: { data: null, errors: [{ message: "dns analytics not enabled" }] }, status: 200 }),
      maxRetries: 0,
    });
    const result = await readCloudflareDnsQueriesAnalytics({ accountId: ACCOUNT_ID, at: AT, client, zoneId: ZONE_ID });
    expect(unwrapErr(result).kind).toBe("graphql-error");
  });

  it("maps an HTTP error to the typed client error", async () => {
    const client = createCloudflareClient({
      apiToken: "t",
      fetchImpl: async () => jsonResponse({ body: { errors: [{ message: "denied" }], success: false }, status: 401 }),
      maxRetries: 0,
    });
    const result = await readCloudflareDnsQueriesAnalytics({ accountId: ACCOUNT_ID, at: AT, client, zoneId: ZONE_ID });
    expect(unwrapErr(result).kind).toBe("authentication");
  });
});
