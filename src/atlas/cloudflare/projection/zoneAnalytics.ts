/**
 * Pure projection for the `zone-analytics` kind — two independent GraphQL Analytics API datasets folded
 * into this one kind, the same "N independent collections, per-subtype partial credit" shape
 * `projection/apiGateway.ts`/`projection/zoneCertificate.ts` established. Each subtype is a whole
 * time-windowed row collection folded into ONE entity, the same bare-collection shape
 * `projectCloudflareDiscoverySchemaCollection` uses — a GraphQL analytics row has no stable per-row identity
 * to key an individual entity on, only a time bucket and dimension combination that changes every run.
 *
 * The pinned SDK exports no typed resource for this surface at all — it is reached entirely through the
 * base client's untyped `client.post("/graphql", ...)`, confirmed live to round-trip correctly (see
 * `readers/zoneAnalytics.ts`'s own header). Introspection on this endpoint returns anonymous (empty-name)
 * types throughout, so dataset and field names here were confirmed by direct trial query against the live
 * account rather than read from the schema — every field below is one this atlas has actually seen returned.
 */
import { unsetFieldAsNull } from "#lib/absent.js";
import { isRecord } from "../../../lib/parsers.js";
import { cloudflareZoneEntityId } from "../identity.js";
import type { CloudflareEntity } from "../model.js";

/** Every source surface `zone-analytics` folds together. */
export const CLOUDFLARE_ZONE_ANALYTICS_SUBTYPES = ["http-requests", "dns-queries"] as const;

export type CloudflareZoneAnalyticsSubtype = (typeof CLOUDFLARE_ZONE_ANALYTICS_SUBTYPES)[number];

/**
 * Narrow a stored entity's `detail` into this domain's shape and confirm its subtype.
 *
 * @param value the entity's `detail` field, read back from disk
 * @param subtype the subtype to require
 * @returns true when `value` is a genuine `CloudflareZoneAnalyticsDetail` of the given subtype
 */
export function isCloudflareZoneAnalyticsDetailOf({
  value,
  subtype,
}: {
  value: unknown;
  subtype: CloudflareZoneAnalyticsSubtype;
}): boolean {
  return isRecord(value) && value["kind"] === "zone-analytics" && value["subtype"] === subtype;
}

/** One `httpRequestsAdaptiveGroups` row, as the GraphQL Analytics API actually returns it. */
export interface CloudflareRawHttpRequestGroup {
  readonly count: number;
  readonly dimensions?: {
    readonly datetimeHour?: string;
    readonly clientCountryName?: string;
    readonly clientRequestHTTPHost?: string;
    readonly edgeResponseStatus?: number;
  };
  readonly sum?: { readonly edgeResponseBytes?: number };
  readonly avg?: { readonly edgeTimeToFirstByteMs?: number; readonly sampleInterval?: number };
}

/** One `dnsAnalyticsAdaptiveGroups` row, as the GraphQL Analytics API actually returns it. */
export interface CloudflareRawDnsQueryGroup {
  readonly count: number;
  readonly dimensions?: {
    readonly queryName?: string;
    readonly queryType?: string;
    readonly responseCode?: string;
  };
  readonly avg?: { readonly sampleInterval?: number };
}

/** One projected `httpRequestsAdaptiveGroups` row. */
interface CloudflareHttpRequestGroupRow {
  readonly count: number;
  readonly datetimeHour: string | null;
  readonly clientCountryName: string | null;
  readonly clientRequestHost: string | null;
  readonly edgeResponseStatus: number | null;
  readonly edgeResponseBytes: number | null;
  readonly edgeTimeToFirstByteMs: number | null;
  readonly sampleInterval: number | null;
}

/** One projected `dnsAnalyticsAdaptiveGroups` row. */
interface CloudflareDnsQueryGroupRow {
  readonly count: number;
  readonly queryName: string | null;
  readonly queryType: string | null;
  readonly responseCode: string | null;
  readonly sampleInterval: number | null;
}

/** The detail this atlas stores for the `zone-analytics` kind — one variant per subtype. */
type CloudflareZoneAnalyticsDetail =
  | {
      readonly kind: "zone-analytics";
      readonly subtype: "http-requests";
      readonly windowStart: string;
      readonly windowEnd: string;
      readonly rows: readonly CloudflareHttpRequestGroupRow[];
    }
  | {
      readonly kind: "zone-analytics";
      readonly subtype: "dns-queries";
      readonly windowStart: string;
      readonly windowEnd: string;
      readonly rows: readonly CloudflareDnsQueryGroupRow[];
    };

/**
 * Project the zone's HTTP request analytics for one time window into a SINGLE `zone-analytics` entity — a
 * GraphQL analytics row has no stable per-row identity, only a time bucket and dimension combination that
 * changes every run, so the whole window is folded whole rather than split into per-row entities.
 *
 * @param rows every row the query returned, for the window `[windowStart, windowEnd]`
 * @param windowStart the query window's start, ISO-8601
 * @param windowEnd the query window's end, ISO-8601
 * @param accountId the selected account id
 * @param zoneId the configured deep zone id
 * @param at this run's ISO timestamp
 * @returns the projected entity
 */
export function projectCloudflareHttpRequestsGroups({
  rows,
  windowStart,
  windowEnd,
  accountId,
  zoneId,
  at,
}: {
  rows: readonly CloudflareRawHttpRequestGroup[];
  windowStart: string;
  windowEnd: string;
  accountId: string;
  zoneId: string;
  at: string;
}): CloudflareEntity {
  const providerId = "http-requests";
  const detail: CloudflareZoneAnalyticsDetail = {
    kind: "zone-analytics",
    rows: rows.map((row): CloudflareHttpRequestGroupRow => ({
      clientCountryName: unsetFieldAsNull({ key: "clientCountryName", record: row.dimensions }),
      clientRequestHost: unsetFieldAsNull({ key: "clientRequestHTTPHost", record: row.dimensions }),
      count: row.count,
      datetimeHour: unsetFieldAsNull({ key: "datetimeHour", record: row.dimensions }),
      edgeResponseBytes: unsetFieldAsNull({ key: "edgeResponseBytes", record: row.sum }),
      edgeResponseStatus: unsetFieldAsNull({ key: "edgeResponseStatus", record: row.dimensions }),
      edgeTimeToFirstByteMs: unsetFieldAsNull({ key: "edgeTimeToFirstByteMs", record: row.avg }),
      sampleInterval: unsetFieldAsNull({ key: "sampleInterval", record: row.avg }),
    })),
    subtype: "http-requests",
    windowEnd,
    windowStart,
  };
  return {
    detail,
    firstSeenAt: at,
    id: cloudflareZoneEntityId({ components: { accountId, providerId }, kind: "zone-analytics", zoneId }),
    kind: "zone-analytics",
    lastSeenAt: at,
    providerId,
    scope: { accountId, parentId: null, zoneId },
    source: { channel: "rest-api", observedAt: at, operation: "zone-analytics-http-requests-graphql" },
    state: "observed",
  };
}

/**
 * Project the zone's DNS query analytics for one time window into a SINGLE `zone-analytics` entity — the
 * same whole-window fold {@link projectCloudflareHttpRequestsGroups} uses.
 *
 * @param rows every row the query returned, for the window `[windowStart, windowEnd]`
 * @param windowStart the query window's start, ISO-8601
 * @param windowEnd the query window's end, ISO-8601
 * @param accountId the selected account id
 * @param zoneId the configured deep zone id
 * @param at this run's ISO timestamp
 * @returns the projected entity
 */
export function projectCloudflareDnsQueriesGroups({
  rows,
  windowStart,
  windowEnd,
  accountId,
  zoneId,
  at,
}: {
  rows: readonly CloudflareRawDnsQueryGroup[];
  windowStart: string;
  windowEnd: string;
  accountId: string;
  zoneId: string;
  at: string;
}): CloudflareEntity {
  const providerId = "dns-queries";
  const detail: CloudflareZoneAnalyticsDetail = {
    kind: "zone-analytics",
    rows: rows.map((row): CloudflareDnsQueryGroupRow => ({
      count: row.count,
      queryName: unsetFieldAsNull({ key: "queryName", record: row.dimensions }),
      queryType: unsetFieldAsNull({ key: "queryType", record: row.dimensions }),
      responseCode: unsetFieldAsNull({ key: "responseCode", record: row.dimensions }),
      sampleInterval: unsetFieldAsNull({ key: "sampleInterval", record: row.avg }),
    })),
    subtype: "dns-queries",
    windowEnd,
    windowStart,
  };
  return {
    detail,
    firstSeenAt: at,
    id: cloudflareZoneEntityId({ components: { accountId, providerId }, kind: "zone-analytics", zoneId }),
    kind: "zone-analytics",
    lastSeenAt: at,
    providerId,
    scope: { accountId, parentId: null, zoneId },
    source: { channel: "rest-api", observedAt: at, operation: "zone-analytics-dns-queries-graphql" },
    state: "observed",
  };
}
