import { describe, expect, it } from "vitest";

import { createCloudflareClient } from "../../../../atlas/cloudflare/client.js";
import { openCloudflareGap } from "../../../../atlas/cloudflare/gaps.js";
import { cloudflareGapId } from "../../../../atlas/cloudflare/identity.js";
import {
  CLOUDFLARE_VISIBILITY_SCOPE,
  type CloudflareEntity,
  type CloudflareGap,
  type CloudflareKindFile,
  emptyCloudflareKindFile,
} from "../../../../atlas/cloudflare/model.js";
import {
  CLOUDFLARE_ZONE_ANALYTICS_SUBTYPES,
  type CloudflareZoneAnalyticsSubtype,
  projectCloudflareDnsQueriesGroups,
  projectCloudflareHttpRequestsGroups,
} from "../../../../atlas/cloudflare/projection/zoneAnalytics.js";
import { syncZoneAnalyticsKind } from "../../../../atlas/cloudflare/zoneAnalyticsSync.js";
import { unwrap } from "../../../../lib/result.js";

const AT = "2026-01-01T00:00:00.000Z";
const STORED_AT = "2025-12-01T00:00:00.000Z";
const WINDOW_START = "2025-12-31T00:00:00.000Z";
const STORED_WINDOW_START = "2025-11-30T00:00:00.000Z";
const ACCOUNT_ID = "a".repeat(32);
const ZONE_ID = "z".repeat(32);
const OTHER_ZONE_ID = "y".repeat(32);
const KIND_SCOPE = `zone/${ZONE_ID}/zone-analytics`;
const GRAPHQL_PATH = "/client/v4/graphql";

/** The rows a successful run reads per dataset, in the raw GraphQL shape. */
const FRESH_ROWS: Record<CloudflareZoneAnalyticsSubtype, readonly unknown[]> = {
  "dns-queries": [
    {
      avg: { sampleInterval: 1 },
      count: 42,
      dimensions: { queryName: "example.com", queryType: "A", responseCode: "NOERROR" },
    },
  ],
  "http-requests": [
    {
      avg: { edgeTimeToFirstByteMs: 12, sampleInterval: 1 },
      count: 5,
      dimensions: {
        clientCountryName: "AU",
        clientRequestHTTPHost: "example.com",
        datetimeHour: "2026-01-01T00:00:00Z",
        edgeResponseStatus: 200,
      },
      sum: { edgeResponseBytes: 100 },
    },
  ],
};

/** The detail a successful run stores per dataset for `FRESH_ROWS`, written out rather than projected. */
const FRESH_DETAIL: Record<CloudflareZoneAnalyticsSubtype, unknown> = {
  "dns-queries": {
    kind: "zone-analytics",
    rows: [{ count: 42, queryName: "example.com", queryType: "A", responseCode: "NOERROR", sampleInterval: 1 }],
    subtype: "dns-queries",
    windowEnd: AT,
    windowStart: WINDOW_START,
  },
  "http-requests": {
    kind: "zone-analytics",
    rows: [
      {
        clientCountryName: "AU",
        clientRequestHost: "example.com",
        count: 5,
        datetimeHour: "2026-01-01T00:00:00Z",
        edgeResponseBytes: 100,
        edgeResponseStatus: 200,
        edgeTimeToFirstByteMs: 12,
        sampleInterval: 1,
      },
    ],
    subtype: "http-requests",
    windowEnd: AT,
    windowStart: WINDOW_START,
  },
};

/** The message a 403 on one dataset's query maps to, exactly as the typed client error words it. */
function deniedMessage({ subtype }: { subtype: CloudflareZoneAnalyticsSubtype }): string {
  return `cloudflare zone-analytics-${subtype}-graphql: permission denied (403) — the configured token cannot see this surface: 403 {"errors":[{"message":"denied"}],"success":false}`;
}

/** A JSON response with the given status and body. */
function jsonResponse({ status, body }: { status: number; body: unknown }): Response {
  return new Response(JSON.stringify(body), { headers: { "content-type": "application/json" }, status });
}

/** The requested URL, however the SDK passed it. */
function requestUrl({ input }: { input: string | URL | Request }): URL {
  if (typeof input === "string") {
    return new URL(input);
  }
  return input instanceof URL ? input : new URL(input.url);
}

/** Which dataset a GraphQL request body queries, read from the one connection field its query selects. */
function queriedDataset({ init }: { init: RequestInit | undefined }): CloudflareZoneAnalyticsSubtype {
  const body = init?.body;
  if (typeof body !== "string") {
    throw new Error("the GraphQL request carried no string body");
  }
  if (body.includes("httpRequestsAdaptiveGroups")) {
    return "http-requests";
  }
  if (body.includes("dnsAnalyticsAdaptiveGroups")) {
    return "dns-queries";
  }
  throw new Error("the GraphQL request queried neither analytics dataset");
}

/** The GraphQL `zones[0]` object a successful query for one dataset returns. */
function zoneWithRows({
  subtype,
  rows,
}: {
  subtype: CloudflareZoneAnalyticsSubtype;
  rows: readonly unknown[];
}): Record<string, readonly unknown[]> {
  if (subtype === "http-requests") {
    return { httpRequestsAdaptiveGroups: rows };
  }
  return { dnsAnalyticsAdaptiveGroups: rows };
}

/**
 * A client serving the GraphQL endpoint. A dataset named in `deniedSubtypes` answers 403, every other answers
 * `FRESH_ROWS`. Each request pushes `start:<dataset>`, yields one macrotask so a concurrent caller would
 * interleave, then pushes `end:<dataset>` — so `events` shows whether the datasets were read one after the
 * other. Any other path is a 500 naming it.
 */
function analyticsClient({
  events,
  deniedSubtypes = [],
}: {
  events: string[];
  deniedSubtypes?: readonly CloudflareZoneAnalyticsSubtype[];
}) {
  return createCloudflareClient({
    apiToken: "t",
    fetchImpl: async (input, init) => {
      const url = requestUrl({ input });
      if (url.pathname !== GRAPHQL_PATH) {
        return jsonResponse({
          body: { errors: [{ message: `unrouted path ${url.pathname}` }], success: false },
          status: 500,
        });
      }
      const subtype = queriedDataset({ init });
      events.push(`start:${subtype}`);
      await new Promise((resolve) => setTimeout(resolve, 0));
      events.push(`end:${subtype}`);
      if (deniedSubtypes.includes(subtype)) {
        return jsonResponse({ body: { errors: [{ message: "denied" }], success: false }, status: 403 });
      }
      return jsonResponse({
        body: {
          data: { viewer: { zones: [zoneWithRows({ rows: FRESH_ROWS[subtype], subtype })] } },
          errors: null,
        },
        status: 200,
      });
    },
    maxRetries: 0,
  });
}

/** The entity this module's own projection stores for one dataset, for an earlier window and the given zone. */
function storedEntity({
  subtype,
  zoneId,
}: {
  subtype: CloudflareZoneAnalyticsSubtype;
  zoneId: string;
}): CloudflareEntity {
  const common = {
    accountId: ACCOUNT_ID,
    at: STORED_AT,
    windowEnd: STORED_AT,
    windowStart: STORED_WINDOW_START,
    zoneId,
  };
  if (subtype === "http-requests") {
    return projectCloudflareHttpRequestsGroups({
      ...common,
      rows: [{ count: 1, dimensions: { datetimeHour: "2025-11-30T00:00:00Z" } }],
    });
  }
  return projectCloudflareDnsQueriesGroups({
    ...common,
    rows: [{ count: 1, dimensions: { queryName: "old.example" } }],
  });
}

/** A stored `zone-analytics` kind file holding exactly the given entities and gaps. */
function storedFile({
  entities,
  gaps = [],
}: {
  entities: readonly CloudflareEntity[];
  gaps?: readonly CloudflareGap[];
}): CloudflareKindFile {
  return {
    ...emptyCloudflareKindFile({ kind: "zone-analytics", updatedAt: STORED_AT }),
    entities: [...entities],
    gaps: [...gaps],
  };
}

/** One stored open gap, as a previous run would have left it at a dataset's scope. */
function storedGap({
  condition,
  subtype,
}: {
  condition: "permission-refused" | "pagination-incomplete";
  subtype: CloudflareZoneAnalyticsSubtype;
}): CloudflareGap {
  return openCloudflareGap({
    at: STORED_AT,
    condition,
    kind: "zone-analytics",
    reason: "stored",
    scope: `${KIND_SCOPE}/${subtype}`,
  });
}

/** The entities of one zone, ordered by provider id. */
function entitiesOfZone({
  entities,
  zoneId,
}: {
  entities: readonly CloudflareEntity[];
  zoneId: string;
}): readonly CloudflareEntity[] {
  return entities
    .filter((entity) => entity.scope.zoneId === zoneId)
    .toSorted((left, right) => left.providerId.localeCompare(right.providerId));
}

/** The identity-bearing view of a set of entities: provider id, both timestamps and detail. */
function entityView({ entities }: { entities: readonly CloudflareEntity[] }) {
  return entities.map((entity) => ({
    detail: entity.detail,
    firstSeenAt: entity.firstSeenAt,
    lastSeenAt: entity.lastSeenAt,
    providerId: entity.providerId,
  }));
}

/** The kind-scope coverage cell a fully successful run at `AT` writes, with the given reason. */
function syncedCoverageCell({ reason }: { reason: string }) {
  return {
    lastSuccessAt: AT,
    latestAttemptFailed: false,
    reason,
    scope: KIND_SCOPE,
    state: "synced",
    unblockedBy: null,
    visibilityScope: CLOUDFLARE_VISIBILITY_SCOPE,
  };
}

/** The events a sequential read of http-requests then dns-queries leaves, when both are attempted. */
const SEQUENTIAL_EVENTS = ["start:http-requests", "end:http-requests", "start:dns-queries", "end:dns-queries"];

describe("syncZoneAnalyticsKind", () => {
  it("declares the two datasets, http first, that the sequential read walks", () => {
    expect(CLOUDFLARE_ZONE_ANALYTICS_SUBTYPES).toEqual(["http-requests", "dns-queries"]);
  });

  it("reads both datasets one after the other, closes their gaps and leaves another zone's entities alone", async () => {
    const events: string[] = [];
    const client = analyticsClient({ events });
    const otherZoneStored = CLOUDFLARE_ZONE_ANALYTICS_SUBTYPES.map((subtype) =>
      storedEntity({ subtype, zoneId: OTHER_ZONE_ID }),
    );
    const stored = storedFile({
      entities: otherZoneStored,
      gaps: [
        storedGap({ condition: "permission-refused", subtype: "http-requests" }),
        storedGap({ condition: "pagination-incomplete", subtype: "dns-queries" }),
      ],
    });

    const folded = unwrap(
      await syncZoneAnalyticsKind({ accountId: ACCOUNT_ID, at: AT, client, stored, zoneId: ZONE_ID }),
    );

    expect(events).toEqual(SEQUENTIAL_EVENTS);
    expect(entityView({ entities: entitiesOfZone({ entities: folded.file.entities, zoneId: ZONE_ID }) })).toEqual([
      { detail: FRESH_DETAIL["dns-queries"], firstSeenAt: AT, lastSeenAt: AT, providerId: "dns-queries" },
      { detail: FRESH_DETAIL["http-requests"], firstSeenAt: AT, lastSeenAt: AT, providerId: "http-requests" },
    ]);
    expect(entitiesOfZone({ entities: folded.file.entities, zoneId: OTHER_ZONE_ID })).toEqual(
      entitiesOfZone({ entities: otherZoneStored, zoneId: OTHER_ZONE_ID }),
    );
    expect(folded.outcome).toEqual({ complete: true, entityCount: 4, kind: "zone-analytics", reasons: [] });
    expect(folded.file.coverage).toEqual([
      syncedCoverageCell({ reason: "reconciled 2 zone-analytics entities across both datasets" }),
    ]);
    expect(folded.file.gaps.filter((gap) => gap.status === "open")).toEqual([]);
    expect(
      folded.file.gaps
        .map((gap) => ({
          condition: gap.condition,
          lastCheckedAt: gap.lastCheckedAt,
          scope: gap.scope,
          status: gap.status,
        }))
        .toSorted((left, right) => left.scope.localeCompare(right.scope)),
    ).toEqual([
      { condition: "pagination-incomplete", lastCheckedAt: AT, scope: `${KIND_SCOPE}/dns-queries`, status: "closed" },
      { condition: "permission-refused", lastCheckedAt: AT, scope: `${KIND_SCOPE}/http-requests`, status: "closed" },
    ]);
  });

  it.each([...CLOUDFLARE_ZONE_ANALYTICS_SUBTYPES])(
    "when only %s is refused, it alone keeps its stored entity, the other dataset is still read and refreshed, and the order is http then dns",
    async (failed) => {
      const events: string[] = [];
      const client = analyticsClient({ deniedSubtypes: [failed], events });
      const thisZoneStored = CLOUDFLARE_ZONE_ANALYTICS_SUBTYPES.map((subtype) =>
        storedEntity({ subtype, zoneId: ZONE_ID }),
      );
      const otherZoneStored = CLOUDFLARE_ZONE_ANALYTICS_SUBTYPES.map((subtype) =>
        storedEntity({ subtype, zoneId: OTHER_ZONE_ID }),
      );
      const succeeded = failed === "http-requests" ? "dns-queries" : "http-requests";
      const stored = storedFile({
        entities: [...otherZoneStored, ...thisZoneStored],
        gaps: [storedGap({ condition: "permission-refused", subtype: succeeded })],
      });
      const message = deniedMessage({ subtype: failed });
      const failedScope = `${KIND_SCOPE}/${failed}`;

      const folded = unwrap(
        await syncZoneAnalyticsKind({ accountId: ACCOUNT_ID, at: AT, client, stored, zoneId: ZONE_ID }),
      );

      // Both datasets are attempted, strictly one after the other, whichever one is refused.
      expect(events).toEqual(SEQUENTIAL_EVENTS);
      const thisZone = entitiesOfZone({ entities: folded.file.entities, zoneId: ZONE_ID });
      expect(thisZone.filter((entity) => entity.providerId === failed)).toEqual(
        thisZoneStored.filter((entity) => entity.providerId === failed),
      );
      expect(entityView({ entities: thisZone.filter((entity) => entity.providerId === succeeded) })).toEqual([
        // The refreshed entity was already stored, so it keeps the instant it was first seen.
        { detail: FRESH_DETAIL[succeeded], firstSeenAt: STORED_AT, lastSeenAt: AT, providerId: succeeded },
      ]);
      expect(thisZone.length).toBe(2);
      expect(entitiesOfZone({ entities: folded.file.entities, zoneId: OTHER_ZONE_ID })).toEqual(
        entitiesOfZone({ entities: otherZoneStored, zoneId: OTHER_ZONE_ID }),
      );
      expect(folded.outcome.complete).toBe(false);
      expect(folded.outcome.entityCount).toBe(4);
      expect(folded.outcome.reasons).toEqual([`${failed}: ${message}`]);
      expect(folded.outcome.permissionBlocked!.detail).toBe(`${failedScope}: ${message}`);
      expect(
        folded.file.coverage.map((cell) => ({ reason: cell.reason, scope: cell.scope, state: cell.state })),
      ).toEqual([{ reason: `${failed}: ${message}`, scope: KIND_SCOPE, state: "unreadable" }]);
      expect(folded.file.gaps.filter((gap) => gap.status === "open")).toEqual([
        {
          condition: "permission-refused",
          firstDetectedAt: AT,
          id: cloudflareGapId({ condition: "permission-refused", scope: failedScope }),
          kind: "zone-analytics",
          lastCheckedAt: AT,
          lastDetectedAt: AT,
          reason: message,
          scope: failedScope,
          status: "open",
        },
      ]);
      // The refused dataset does not stop the other one earning its own rechecks.
      expect(
        folded.file.gaps
          .filter((gap) => gap.status === "closed")
          .map((gap) => ({ condition: gap.condition, lastCheckedAt: gap.lastCheckedAt, scope: gap.scope })),
      ).toEqual([{ condition: "permission-refused", lastCheckedAt: AT, scope: `${KIND_SCOPE}/${succeeded}` }]);
      expect(folded.file.gaps.length).toBe(2);
    },
  );

  it("carries an already-stored entity's firstSeenAt through a refresh while a new one starts at this run", async () => {
    const events: string[] = [];
    const client = analyticsClient({ events });
    const stored = storedFile({ entities: [storedEntity({ subtype: "http-requests", zoneId: ZONE_ID })] });

    const folded = unwrap(
      await syncZoneAnalyticsKind({ accountId: ACCOUNT_ID, at: AT, client, stored, zoneId: ZONE_ID }),
    );

    expect(entityView({ entities: entitiesOfZone({ entities: folded.file.entities, zoneId: ZONE_ID }) })).toEqual([
      { detail: FRESH_DETAIL["dns-queries"], firstSeenAt: AT, lastSeenAt: AT, providerId: "dns-queries" },
      { detail: FRESH_DETAIL["http-requests"], firstSeenAt: STORED_AT, lastSeenAt: AT, providerId: "http-requests" },
    ]);
  });
});
