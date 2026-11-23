/*
 * The full reconcile of `syncApiGatewayKind` with nothing refused: every declared subtype's endpoint is read,
 * the zone's entities are replaced, a vanished one is pruned, the kind scope reads synced and a seeded subtype
 * gap closes. It was split out when the API Gateway sync suite became one file per behaviour.
 */
import { describe, expect, it } from "vitest";

import { syncApiGatewayKind } from "../../../../../atlas/cloudflare/apiGatewaySync.js";
import { CLOUDFLARE_VISIBILITY_SCOPE } from "../../../../../atlas/cloudflare/model.js";
import { projectCloudflareApiGatewayOperation } from "../../../../../atlas/cloudflare/projection/apiGateway.js";
import { unwrap } from "../../../../../lib/result.js";
import { gapLifecycle } from "../sync/zoneSubtypeKind.js";
import { ACCOUNT_ID, ALL_CASES, AT, KIND_SCOPE, STORED_AT, ZONE_ID } from "./harness.js";
import { servedClient } from "./servedClient.js";
import { storedFile, storedGap, zoneView } from "./zoneView.js";

describe("syncApiGatewayKind", () => {
  it("reads every declared subtype's endpoint, replaces the zone's entities, prunes a vanished one and closes a seeded subtype gap", async () => {
    const { client, requests } = servedClient({});
    const stored = storedFile({
      entities: [
        // Gone from the provider now: a successful operation read must prune it.
        projectCloudflareApiGatewayOperation({
          accountId: ACCOUNT_ID,
          at: STORED_AT,
          raw: { endpoint: "/gone", operation_id: "op-gone" },
          zoneId: ZONE_ID,
        }),
      ],
      gaps: [storedGap({ condition: "permission-refused", subtype: "label" })],
    });

    const folded = unwrap(await syncApiGatewayKind({ accountId: ACCOUNT_ID, at: AT, client, stored, zoneId: ZONE_ID }));

    expect([...new Set(requests)].toSorted()).toEqual(ALL_CASES.map((served) => served.path).toSorted());
    expect(ALL_CASES.length).toBe(8);
    expect(zoneView({ entities: folded.file.entities, zoneId: ZONE_ID })).toEqual([
      {
        firstSeenAt: AT,
        lastSeenAt: AT,
        marker: [{ name: "authorization", type: "header" }],
        observedAt: AT,
        providerId: "configuration",
        subtype: "configuration",
      },
      {
        firstSeenAt: AT,
        lastSeenAt: AT,
        marker: "/discovered/new",
        observedAt: AT,
        providerId: "discovery-operation:disc-1",
        subtype: "discovery-operation",
      },
      {
        firstSeenAt: AT,
        lastSeenAt: AT,
        marker: "2026-02-01T00:00:00Z",
        observedAt: AT,
        providerId: "discovery-schema",
        subtype: "discovery-schema",
      },
      {
        firstSeenAt: AT,
        lastSeenAt: AT,
        marker: "fresh label",
        observedAt: AT,
        providerId: "label:public",
        subtype: "label",
      },
      {
        firstSeenAt: AT,
        lastSeenAt: AT,
        marker: "/orders/new",
        observedAt: AT,
        providerId: "operation:op-1",
        subtype: "operation",
      },
      {
        firstSeenAt: AT,
        lastSeenAt: AT,
        marker: "2026-02-01T00:00:00Z",
        observedAt: AT,
        providerId: "schema",
        subtype: "schema",
      },
      {
        firstSeenAt: AT,
        lastSeenAt: AT,
        marker: "log",
        observedAt: AT,
        providerId: "settings",
        subtype: "settings",
      },
      {
        firstSeenAt: AT,
        lastSeenAt: AT,
        marker: "orders-v2.json",
        observedAt: AT,
        providerId: "user-schema:sch-1",
        subtype: "user-schema",
      },
    ]);
    expect(folded.outcome).toEqual({ complete: true, entityCount: 8, kind: "api-gateway", reasons: [] });
    expect(folded.file.coverage).toEqual([
      {
        lastSuccessAt: AT,
        latestAttemptFailed: false,
        reason: "reconciled 8 API Gateway entities across all 8 subtypes",
        scope: KIND_SCOPE,
        state: "synced",
        unblockedBy: null,
        visibilityScope: CLOUDFLARE_VISIBILITY_SCOPE,
      },
    ]);
    expect(gapLifecycle({ file: folded.file })).toEqual([
      { condition: "permission-refused", lastCheckedAt: AT, scope: `${KIND_SCOPE}/label`, status: "closed" },
    ]);
  });
});
