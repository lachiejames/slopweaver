import { describe, expect, it } from "vitest";

import {
  isCloudflareZoneAnalyticsDetailOf,
  projectCloudflareDnsQueriesGroups,
  projectCloudflareHttpRequestsGroups,
} from "../../../../../atlas/cloudflare/projection/zoneAnalytics.js";

const AT = "2026-01-01T00:00:00.000Z";
const ACCOUNT_ID = "a".repeat(32);
const ZONE_ID = "z".repeat(32);
const WINDOW_START = "2025-12-31T00:00:00.000Z";
const WINDOW_END = "2026-01-01T00:00:00.000Z";

describe("projectCloudflareHttpRequestsGroups", () => {
  it("projects every row field", () => {
    const entity = projectCloudflareHttpRequestsGroups({
      accountId: ACCOUNT_ID,
      at: AT,
      rows: [
        {
          avg: { edgeTimeToFirstByteMs: 42, sampleInterval: 1.5 },
          count: 10,
          dimensions: {
            clientCountryName: "AU",
            clientRequestHTTPHost: "app.example.test",
            datetimeHour: "2026-01-01T00:00:00Z",
            edgeResponseStatus: 200,
          },
          sum: { edgeResponseBytes: 4096 },
        },
      ],
      windowEnd: WINDOW_END,
      windowStart: WINDOW_START,
      zoneId: ZONE_ID,
    });
    expect(entity.providerId).toBe("http-requests");
    expect(entity.detail).toEqual({
      kind: "zone-analytics",
      rows: [
        {
          clientCountryName: "AU",
          clientRequestHost: "app.example.test",
          count: 10,
          datetimeHour: "2026-01-01T00:00:00Z",
          edgeResponseBytes: 4096,
          edgeResponseStatus: 200,
          edgeTimeToFirstByteMs: 42,
          sampleInterval: 1.5,
        },
      ],
      subtype: "http-requests",
      windowEnd: WINDOW_END,
      windowStart: WINDOW_START,
    });
  });

  it("defaults every missing dimension/sum/avg field to null, and empty rows to an empty array", () => {
    const entity = projectCloudflareHttpRequestsGroups({
      accountId: ACCOUNT_ID,
      at: AT,
      rows: [{ count: 3 }],
      windowEnd: WINDOW_END,
      windowStart: WINDOW_START,
      zoneId: ZONE_ID,
    });
    expect(entity.detail).toEqual({
      kind: "zone-analytics",
      rows: [
        {
          clientCountryName: null,
          clientRequestHost: null,
          count: 3,
          datetimeHour: null,
          edgeResponseBytes: null,
          edgeResponseStatus: null,
          edgeTimeToFirstByteMs: null,
          sampleInterval: null,
        },
      ],
      subtype: "http-requests",
      windowEnd: WINDOW_END,
      windowStart: WINDOW_START,
    });

    const empty = projectCloudflareHttpRequestsGroups({
      accountId: ACCOUNT_ID,
      at: AT,
      rows: [],
      windowEnd: WINDOW_END,
      windowStart: WINDOW_START,
      zoneId: ZONE_ID,
    });
    expect(empty.detail).toEqual({
      kind: "zone-analytics",
      rows: [],
      subtype: "http-requests",
      windowEnd: WINDOW_END,
      windowStart: WINDOW_START,
    });
  });
});

describe("projectCloudflareDnsQueriesGroups", () => {
  it("projects every row field", () => {
    const entity = projectCloudflareDnsQueriesGroups({
      accountId: ACCOUNT_ID,
      at: AT,
      rows: [
        {
          avg: { sampleInterval: 1 },
          count: 250,
          dimensions: { queryName: "www.example.test", queryType: "A", responseCode: "NOERROR" },
        },
      ],
      windowEnd: WINDOW_END,
      windowStart: WINDOW_START,
      zoneId: ZONE_ID,
    });
    expect(entity.providerId).toBe("dns-queries");
    expect(entity.detail).toEqual({
      kind: "zone-analytics",
      rows: [{ count: 250, queryName: "www.example.test", queryType: "A", responseCode: "NOERROR", sampleInterval: 1 }],
      subtype: "dns-queries",
      windowEnd: WINDOW_END,
      windowStart: WINDOW_START,
    });
  });

  it("defaults every missing dimension/avg field to null", () => {
    const entity = projectCloudflareDnsQueriesGroups({
      accountId: ACCOUNT_ID,
      at: AT,
      rows: [{ count: 1 }],
      windowEnd: WINDOW_END,
      windowStart: WINDOW_START,
      zoneId: ZONE_ID,
    });
    expect(entity.detail).toEqual({
      kind: "zone-analytics",
      rows: [{ count: 1, queryName: null, queryType: null, responseCode: null, sampleInterval: null }],
      subtype: "dns-queries",
      windowEnd: WINDOW_END,
      windowStart: WINDOW_START,
    });
  });
});

describe("isCloudflareZoneAnalyticsDetailOf", () => {
  it("matches a detail of the exact requested subtype", () => {
    const entity = projectCloudflareHttpRequestsGroups({
      accountId: ACCOUNT_ID,
      at: AT,
      rows: [],
      windowEnd: WINDOW_END,
      windowStart: WINDOW_START,
      zoneId: ZONE_ID,
    });
    expect(isCloudflareZoneAnalyticsDetailOf({ subtype: "http-requests", value: entity.detail })).toBe(true);
  });

  it("rejects a detail of a different subtype", () => {
    const entity = projectCloudflareHttpRequestsGroups({
      accountId: ACCOUNT_ID,
      at: AT,
      rows: [],
      windowEnd: WINDOW_END,
      windowStart: WINDOW_START,
      zoneId: ZONE_ID,
    });
    expect(isCloudflareZoneAnalyticsDetailOf({ subtype: "dns-queries", value: entity.detail })).toBe(false);
  });

  it("rejects a value that is not a record", () => {
    expect(isCloudflareZoneAnalyticsDetailOf({ subtype: "http-requests", value: "not-a-record" })).toBe(false);
  });
});
