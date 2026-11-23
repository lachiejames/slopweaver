/*
 * What the sync tests of a zone-scoped kind read one endpoint per subtype for share, whichever kind it is: the
 * real Cloudflare client over a routing fetch that serves each subtype case's path, refuses the subtypes it is
 * told to and answers 404 for anything unrouted; the identity-and-freshness view of one zone's entities; and
 * each gap's lifecycle. A suite passes its own subtype cases in, so the kind string and the subtype union stay
 * that suite's. A plain module, not a `*.test.ts`, so no test registers twice. It holds the one copy of what
 * the zone certificate and API Gateway sync suites had each written out, which the `duplicate-windows` gate
 * counts as a duplicate file pair.
 */
import type Cloudflare from "cloudflare";

import { createCloudflareClient } from "../../../../../atlas/cloudflare/client.js";
import type { CloudflareEntity, CloudflareGap, CloudflareKindFile } from "../../../../../atlas/cloudflare/model.js";
import { isRecord } from "../../../../../lib/parsers.js";
import { jsonResponse, requestUrl } from "./httpResponses.js";

/** One entity as `zoneView` reads it, and as a suite's expected view spells it: identity, freshness and marker value. */
export interface ZoneViewRow {
  readonly firstSeenAt: string;
  readonly lastSeenAt: string;
  readonly marker: unknown;
  readonly observedAt: string;
  readonly providerId: string;
  readonly subtype: unknown;
}

/** What the view reads of one subtype case: its subtype, and the one detail field that tells stored from fresh. */
interface MarkedCase {
  readonly subtype: string;
  readonly markerField: string;
}

function deniedResponse(): Response {
  return jsonResponse({ body: { errors: [{ message: "denied" }], success: false }, status: 403 });
}

/**
 * A real client over a routing fetch serving each case's endpoint. Any subtype named in `denied` answers 403;
 * every other routed case is answered by `respond`. An unrouted path answers 404 naming it, so a wrongly-wired
 * endpoint fails loudly. Every requested pathname is pushed onto `requests`.
 *
 * @param cases the suite's subtype cases, each naming the path it is served at
 * @param respond the success response for one routed, unrefused case and the URL it was asked at
 * @returns the client, and the list every requested pathname is pushed onto
 */
export function routedSubtypeClient<Case extends { readonly path: string; readonly subtype: string }>({
  cases,
  denied,
  respond,
}: {
  cases: readonly Case[];
  denied: readonly Case["subtype"][];
  respond: (args: { served: Case; url: URL }) => Response;
}): { client: Cloudflare; requests: string[] } {
  const requests: string[] = [];
  const client = createCloudflareClient({
    apiToken: "t",
    fetchImpl: async (input) => {
      const url = requestUrl({ input });
      requests.push(url.pathname);
      const served = cases.find((candidate) => candidate.path === url.pathname);
      if (served === undefined) {
        return jsonResponse({
          body: { errors: [{ message: `unrouted ${url.pathname}` }], success: false },
          status: 404,
        });
      }
      if (denied.includes(served.subtype)) {
        return deniedResponse();
      }
      return respond({ served, url });
    },
    maxRetries: 0,
  });
  return { client, requests };
}

/** An entity's `detail` as a record; throws when the stored shape is not one. */
function detailOf({ entity }: { entity: CloudflareEntity }): Readonly<Record<string, unknown>> {
  if (!isRecord(entity.detail)) {
    throw new Error(`entity ${entity.providerId} carries a non-record detail`);
  }
  return entity.detail;
}

/** The case a stored entity's detail names by its subtype. */
function caseOfEntity({ cases, entity }: { cases: readonly MarkedCase[]; entity: CloudflareEntity }): MarkedCase {
  const subtype = detailOf({ entity })["subtype"];
  return cases.find((candidate) => candidate.subtype === subtype)!;
}

/**
 * The identity-and-freshness view of one zone's entities, ordered by provider id.
 *
 * @param cases the suite's subtype cases, which name each subtype's marker field
 * @returns one row per entity in that zone, sorted by provider id
 */
export function zoneView({
  cases,
  entities,
  zoneId,
}: {
  cases: readonly MarkedCase[];
  entities: readonly CloudflareEntity[];
  zoneId: string;
}): readonly ZoneViewRow[] {
  return entities
    .filter((entity) => entity.scope.zoneId === zoneId)
    .toSorted((left, right) => left.providerId.localeCompare(right.providerId))
    .map((entity) => ({
      firstSeenAt: entity.firstSeenAt,
      lastSeenAt: entity.lastSeenAt,
      marker: detailOf({ entity })[caseOfEntity({ cases, entity }).markerField],
      observedAt: entity.source.observedAt,
      providerId: entity.providerId,
      subtype: detailOf({ entity })["subtype"],
    }));
}

/**
 * Every gap as `{ condition, scope, status, lastCheckedAt }`, in a fixed order, for lifecycle assertions.
 *
 * @returns one entry per gap, sorted by scope then condition
 */
export function gapLifecycle({ file }: { file: CloudflareKindFile }): readonly {
  condition: string;
  lastCheckedAt: string | null;
  scope: string;
  status: CloudflareGap["status"];
}[] {
  return file.gaps
    .map((gap) => ({
      condition: gap.condition,
      lastCheckedAt: gap.lastCheckedAt,
      scope: gap.scope,
      status: gap.status,
    }))
    .toSorted((left, right) => `${left.scope}/${left.condition}`.localeCompare(`${right.scope}/${right.condition}`));
}
