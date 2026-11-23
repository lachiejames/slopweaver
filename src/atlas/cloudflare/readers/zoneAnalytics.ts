/**
 * The `zone-analytics` readers: two independent GraphQL Analytics API datasets, each returned as its OWN
 * `Result` — see `zoneAnalyticsSync.ts`'s header for why this kind needs per-subtype partial success rather
 * than an all-or-nothing combine, the same reasoning `readers/apiGateway.ts`/`readers/zoneCertificate.ts`
 * already established.
 *
 * The pinned SDK exports no typed resource for this surface — every query goes through the base client's
 * untyped `client.post("/graphql", ...)`, the same escape hatch `readers/zoneSetting.ts` uses for its
 * SDK-unwrapped list endpoint. Confirmed live: the endpoint round-trips a raw
 * GraphQL body correctly, an unknown field or bad argument comes back as HTTP 200 with `{ data: null,
 * errors: [...] }` (never a thrown HTTP error), and a real result comes back as `{ data: {...}, errors: null }`.
 * That in-band failure shape is not something a thrown-exception boundary can catch, so both readers check
 * `errors` explicitly before trusting `data`.
 *
 * Each read covers a fixed trailing 24-hour window ending at this run's own timestamp, so the read is a pure
 * function of `at` rather than the wall clock — the same reason `at` is threaded everywhere else in this
 * atlas. `limit: 1000` and `orderBy` keep each query to one page; Cloudflare's GraphQL Analytics API has no
 * cursor-based pagination to fan out over. Reads are sequential (one dataset, then the other) — no rate
 * scheduler, per the plan's own explicit constraint.
 */
import type Cloudflare from "cloudflare";

import { absentAsEmpty } from "#lib/absent.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { mapCloudflareError } from "../client.js";
import type { CloudflareClientError } from "../errors.js";
import { CloudflareClientErrors } from "../errors.js";
import type { CloudflareEntity } from "../model.js";
import {
  type CloudflareRawDnsQueryGroup,
  type CloudflareRawHttpRequestGroup,
  projectCloudflareDnsQueriesGroups,
  projectCloudflareHttpRequestsGroups,
} from "../projection/zoneAnalytics.js";

const ANALYTICS_WINDOW_MS = 24 * 60 * 60 * 1000;
const ANALYTICS_ROW_LIMIT = 1000;

interface CloudflareGraphqlResponse<T> {
  readonly data: T | null;
  readonly errors: readonly { readonly message: string }[] | null;
}

/**
 * The last 24 hours ending at `at`, as an ISO-8601 `[start, end]` pair — a pure function of `at` rather than
 * the wall clock.
 *
 * @param at this run's ISO timestamp
 * @returns the window's start and end, both ISO-8601
 */
function trailingWindow({ at }: { at: string }): { readonly start: string; readonly end: string } {
  return { end: at, start: new Date(new Date(at).getTime() - ANALYTICS_WINDOW_MS).toISOString() };
}

/**
 * Post one GraphQL query and unwrap its result, treating an in-band `errors` array as a failure even though
 * the HTTP call itself succeeded.
 *
 * @param client the constructed Cloudflare client
 * @param operation this call's operation label, for error messages
 * @param query the GraphQL query document
 * @param variables the query's variables
 * @returns the response's `data`, or the reason the query failed
 */
async function postGraphqlQuery<T>({
  client,
  operation,
  query,
  variables,
}: {
  client: Cloudflare;
  operation: string;
  query: string;
  variables: Record<string, unknown>;
}): Promise<Result<T, CloudflareClientError>> {
  try {
    const response = await client.post<CloudflareGraphqlResponse<T>>("/graphql", { body: { query, variables } });
    if (response.errors !== null && response.errors.length > 0) {
      return err(CloudflareClientErrors.graphqlError({ messages: response.errors.map((e) => e.message), operation }));
    }
    if (response.data === null) {
      return err(CloudflareClientErrors.schema({ cause: "graphql response had no data and no errors", operation }));
    }
    return ok(response.data);
  } catch (cause) {
    return err(mapCloudflareError({ cause, operation }));
  }
}

/**
 * Read the zone's HTTP request analytics for the trailing 24-hour window ending at `at`.
 *
 * @param client the constructed Cloudflare client
 * @param accountId the selected account id
 * @param zoneId the configured deep zone id
 * @param at this run's ISO timestamp
 * @returns the window's entity, or the reason the read failed
 */
export async function readCloudflareHttpRequestsAnalytics({
  client,
  accountId,
  zoneId,
  at,
}: {
  client: Cloudflare;
  accountId: string;
  zoneId: string;
  at: string;
}): Promise<Result<readonly CloudflareEntity[], CloudflareClientError>> {
  const window = trailingWindow({ at });
  const operation = "zone-analytics-http-requests-graphql";
  const result = await postGraphqlQuery<{
    viewer: { zones: readonly { httpRequestsAdaptiveGroups: readonly CloudflareRawHttpRequestGroup[] }[] };
  }>({
    client,
    operation,
    query: `
      query ($zoneTag: string!, $since: string!, $until: string!) {
        viewer {
          zones(filter: { zoneTag: $zoneTag }) {
            httpRequestsAdaptiveGroups(
              limit: ${String(ANALYTICS_ROW_LIMIT)}
              filter: { datetime_geq: $since, datetime_leq: $until }
              orderBy: [datetimeHour_DESC]
            ) {
              count
              dimensions { datetimeHour clientCountryName clientRequestHTTPHost edgeResponseStatus }
              sum { edgeResponseBytes }
              avg { edgeTimeToFirstByteMs sampleInterval }
            }
          }
        }
      }
    `,
    variables: { since: window.start, until: window.end, zoneTag: zoneId },
  });
  if (result.isErr()) {
    return err(result.error);
  }
  const rows = absentAsEmpty({ value: result.value.viewer.zones[0]?.httpRequestsAdaptiveGroups });
  return ok([
    projectCloudflareHttpRequestsGroups({
      accountId,
      at,
      rows,
      windowEnd: window.end,
      windowStart: window.start,
      zoneId,
    }),
  ]);
}

/**
 * Read the zone's DNS query analytics for the trailing 24-hour window ending at `at`.
 *
 * @param client the constructed Cloudflare client
 * @param accountId the selected account id
 * @param zoneId the configured deep zone id
 * @param at this run's ISO timestamp
 * @returns the window's entity, or the reason the read failed
 */
export async function readCloudflareDnsQueriesAnalytics({
  client,
  accountId,
  zoneId,
  at,
}: {
  client: Cloudflare;
  accountId: string;
  zoneId: string;
  at: string;
}): Promise<Result<readonly CloudflareEntity[], CloudflareClientError>> {
  const window = trailingWindow({ at });
  const operation = "zone-analytics-dns-queries-graphql";
  const result = await postGraphqlQuery<{
    viewer: { zones: readonly { dnsAnalyticsAdaptiveGroups: readonly CloudflareRawDnsQueryGroup[] }[] };
  }>({
    client,
    operation,
    query: `
      query ($zoneTag: string!, $since: string!, $until: string!) {
        viewer {
          zones(filter: { zoneTag: $zoneTag }) {
            dnsAnalyticsAdaptiveGroups(
              limit: ${String(ANALYTICS_ROW_LIMIT)}
              filter: { datetime_geq: $since, datetime_leq: $until }
              orderBy: [count_DESC]
            ) {
              count
              dimensions { queryName queryType responseCode }
              avg { sampleInterval }
            }
          }
        }
      }
    `,
    variables: { since: window.start, until: window.end, zoneTag: zoneId },
  });
  if (result.isErr()) {
    return err(result.error);
  }
  const rows = absentAsEmpty({ value: result.value.viewer.zones[0]?.dnsAnalyticsAdaptiveGroups });
  return ok([
    projectCloudflareDnsQueriesGroups({
      accountId,
      at,
      rows,
      windowEnd: window.end,
      windowStart: window.start,
      zoneId,
    }),
  ]);
}
