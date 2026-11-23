import { describe, expect, it } from "vitest";

import { createCloudflareClient } from "../../../../atlas/cloudflare/client.js";
import { syncFirewallServiceKind } from "../../../../atlas/cloudflare/firewallServiceSync.js";
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
  CLOUDFLARE_FIREWALL_SERVICE_SUBTYPES,
  type CloudflareFirewallServiceSubtype,
  projectCloudflareFirewallFilter,
  projectCloudflareFirewallRule,
  projectCloudflareIpAccessRule,
  projectCloudflareLockdown,
  projectCloudflareRateLimit,
  projectCloudflareUaRule,
} from "../../../../atlas/cloudflare/projection/firewallService.js";
import { unwrap } from "../../../../lib/result.js";
import { requestedPage } from "./requestedPage.js";

const AT = "2026-01-01T00:00:00.000Z";
const STORED_AT = "2025-12-01T00:00:00.000Z";
const ACCOUNT_ID = "a".repeat(32);
const ZONE_ID = "z".repeat(32);
const OTHER_ZONE_ID = "y".repeat(32);
const KIND_SCOPE = `zone/${ZONE_ID}/firewall-service`;

/** Each subtype's list endpoint and the operation label its typed client error carries. */
const ROUTES: Record<CloudflareFirewallServiceSubtype, { readonly path: string; readonly operation: string }> = {
  filter: { operation: "firewall-service-filters-list", path: `/client/v4/zones/${ZONE_ID}/filters` },
  "firewall-rule": {
    operation: "firewall-service-rules-list",
    path: `/client/v4/zones/${ZONE_ID}/firewall/rules`,
  },
  "ip-access-rule": {
    operation: "firewall-service-access-rules-list",
    path: `/client/v4/zones/${ZONE_ID}/firewall/access_rules/rules`,
  },
  lockdown: {
    operation: "firewall-service-lockdowns-list",
    path: `/client/v4/zones/${ZONE_ID}/firewall/lockdowns`,
  },
  "rate-limit": { operation: "firewall-service-rate-limits-list", path: `/client/v4/zones/${ZONE_ID}/rate_limits` },
  "ua-rule": {
    operation: "firewall-service-ua-rules-list",
    path: `/client/v4/zones/${ZONE_ID}/firewall/ua_rules`,
  },
};

/** What a successful run serves per subtype by default: one item whose id is `new`. */
const NEW_ITEMS: Record<CloudflareFirewallServiceSubtype, readonly unknown[]> = {
  filter: [{ id: "new" }],
  "firewall-rule": [{ id: "new" }],
  "ip-access-rule": [{ id: "new" }],
  lockdown: [{ id: "new" }],
  "rate-limit": [{ id: "new" }],
  "ua-rule": [{ id: "new" }],
};

/** The message a 403 on one subtype's read maps to, exactly as the typed client error words it. */
function deniedMessage({ subtype }: { subtype: CloudflareFirewallServiceSubtype }): string {
  return `cloudflare ${ROUTES[subtype].operation}: permission denied (403) — the configured token cannot see this surface: 403 {"errors":[{"message":"denied"}],"success":false}`;
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

/**
 * A client serving the six classic firewall list endpoints. A subtype named in `deniedSubtypes` answers 403;
 * every other answers `itemsBySubtype` on page 1 and an empty page after, so the SDK's paginator terminates.
 * Every requested pathname is pushed onto `requests`, and any other path is a 500 naming it so a module
 * wiring the wrong endpoint fails loudly rather than reading an empty page.
 */
function firewallClient({
  itemsBySubtype,
  requests,
  deniedSubtypes = [],
}: {
  itemsBySubtype: Record<CloudflareFirewallServiceSubtype, readonly unknown[]>;
  requests: string[];
  deniedSubtypes?: readonly CloudflareFirewallServiceSubtype[];
}) {
  return createCloudflareClient({
    apiToken: "t",
    fetchImpl: async (input) => {
      const url = requestUrl({ input });
      requests.push(url.pathname);
      const subtype = CLOUDFLARE_FIREWALL_SERVICE_SUBTYPES.find((candidate) => ROUTES[candidate].path === url.pathname);
      if (subtype === undefined) {
        return jsonResponse({
          body: { errors: [{ message: `unrouted path ${url.pathname}` }], success: false },
          status: 500,
        });
      }
      if (deniedSubtypes.includes(subtype)) {
        return jsonResponse({ body: { errors: [{ message: "denied" }], success: false }, status: 403 });
      }
      const page = requestedPage({ url });
      const items = page === 1 ? itemsBySubtype[subtype] : [];
      return jsonResponse({
        body: { result: items, result_info: { count: items.length, page }, success: true },
        status: 200,
      });
    },
    maxRetries: 0,
  });
}

/** The entity this module's own projection stores for one raw `{ id }` of a subtype, at the earlier timestamp. */
function storedEntity({
  subtype,
  raw,
  zoneId,
}: {
  subtype: CloudflareFirewallServiceSubtype;
  raw: { readonly id: string; readonly [key: string]: unknown };
  zoneId: string;
}): CloudflareEntity {
  const common = { accountId: ACCOUNT_ID, at: STORED_AT, zoneId };
  switch (subtype) {
    case "filter":
      return projectCloudflareFirewallFilter({ ...common, raw });
    case "firewall-rule":
      return projectCloudflareFirewallRule({ ...common, raw });
    case "ip-access-rule":
      return projectCloudflareIpAccessRule({ ...common, raw });
    case "ua-rule":
      return projectCloudflareUaRule({ ...common, raw });
    case "lockdown":
      return projectCloudflareLockdown({ ...common, raw });
    case "rate-limit":
      return projectCloudflareRateLimit({ ...common, raw });
  }
}

/** A stored `firewall-service` kind file holding exactly the given entities and gaps. */
function storedFile({
  entities,
  gaps = [],
}: {
  entities: readonly CloudflareEntity[];
  gaps?: readonly CloudflareGap[];
}): CloudflareKindFile {
  return {
    ...emptyCloudflareKindFile({ kind: "firewall-service", updatedAt: STORED_AT }),
    entities: [...entities],
    gaps: [...gaps],
  };
}

/** One stored open gap, as a previous run would have left it at a subtype's scope. */
function storedGap({
  condition,
  subtype,
}: {
  condition: "permission-refused" | "pagination-incomplete";
  subtype: CloudflareFirewallServiceSubtype;
}): CloudflareGap {
  return openCloudflareGap({
    at: STORED_AT,
    condition,
    kind: "firewall-service",
    reason: "stored",
    scope: `${KIND_SCOPE}/${subtype}`,
  });
}

/** The subtype that follows the given one in the declared order, wrapping at the end. */
function followingSubtype({
  subtype,
}: {
  subtype: CloudflareFirewallServiceSubtype;
}): CloudflareFirewallServiceSubtype {
  const following =
    CLOUDFLARE_FIREWALL_SERVICE_SUBTYPES[
      (CLOUDFLARE_FIREWALL_SERVICE_SUBTYPES.indexOf(subtype) + 1) % CLOUDFLARE_FIREWALL_SERVICE_SUBTYPES.length
    ];
  if (following === undefined) {
    throw new Error("the subtype list is empty");
  }
  return following;
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

/** The view of an entity set without its detail, for checks that are about which entity survived. */
function survivorView({ entities }: { entities: readonly CloudflareEntity[] }) {
  return entities.map((entity) => ({
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

describe("syncFirewallServiceKind", () => {
  it("declares the six subtypes the matrix below runs over", () => {
    expect(CLOUDFLARE_FIREWALL_SERVICE_SUBTYPES).toEqual([
      "filter",
      "firewall-rule",
      "ip-access-rule",
      "ua-rule",
      "lockdown",
      "rate-limit",
    ]);
  });

  it("reads all six endpoints, replaces nothing with stale data, and closes the gaps of a fully successful run", async () => {
    const requests: string[] = [];
    const client = firewallClient({
      itemsBySubtype: {
        filter: [{ expression: "ip.src eq 1.1.1.1", id: "f1" }],
        "firewall-rule": [{ action: "block", filter: { id: "f1" }, id: "r1" }],
        "ip-access-rule": [{ configuration: { target: "ip", value: "1.1.1.1" }, id: "a1", mode: "block" }],
        lockdown: [{ id: "l1", urls: ["example.com/admin"] }],
        "rate-limit": [{ id: "rl1", period: 60, threshold: 10 }],
        "ua-rule": [{ configuration: { target: "ua", value: "bad-bot" }, id: "u1", mode: "challenge" }],
      },
      requests,
    });
    const stored = storedFile({
      entities: [],
      gaps: [
        storedGap({ condition: "permission-refused", subtype: "lockdown" }),
        storedGap({ condition: "pagination-incomplete", subtype: "rate-limit" }),
      ],
    });

    const folded = unwrap(
      await syncFirewallServiceKind({ accountId: ACCOUNT_ID, at: AT, client, stored, zoneId: ZONE_ID }),
    );

    expect([...new Set(requests)].toSorted()).toEqual(
      CLOUDFLARE_FIREWALL_SERVICE_SUBTYPES.map((subtype) => ROUTES[subtype].path).toSorted(),
    );
    expect(entityView({ entities: entitiesOfZone({ entities: folded.file.entities, zoneId: ZONE_ID }) })).toEqual([
      {
        detail: {
          description: null,
          expression: "ip.src eq 1.1.1.1",
          kind: "firewall-service",
          paused: null,
          ref: null,
          subtype: "filter",
        },
        firstSeenAt: AT,
        lastSeenAt: AT,
        providerId: "filter:f1",
      },
      {
        detail: {
          action: "block",
          description: null,
          filterId: "f1",
          kind: "firewall-service",
          paused: null,
          priority: null,
          products: [],
          ref: null,
          subtype: "firewall-rule",
        },
        firstSeenAt: AT,
        lastSeenAt: AT,
        providerId: "firewall-rule:r1",
      },
      {
        detail: {
          allowedModes: [],
          configuration: { target: "ip", value: "1.1.1.1" },
          createdOn: null,
          kind: "firewall-service",
          mode: "block",
          modifiedOn: null,
          notes: null,
          scopeType: null,
          subtype: "ip-access-rule",
        },
        firstSeenAt: AT,
        lastSeenAt: AT,
        providerId: "ip-access-rule:a1",
      },
      {
        detail: {
          configurations: [],
          createdOn: null,
          description: null,
          kind: "firewall-service",
          modifiedOn: null,
          paused: null,
          subtype: "lockdown",
          urls: ["example.com/admin"],
        },
        firstSeenAt: AT,
        lastSeenAt: AT,
        providerId: "lockdown:l1",
      },
      {
        detail: {
          action: {},
          bypass: [],
          description: null,
          disabled: null,
          kind: "firewall-service",
          match: {},
          period: 60,
          subtype: "rate-limit",
          threshold: 10,
        },
        firstSeenAt: AT,
        lastSeenAt: AT,
        providerId: "rate-limit:rl1",
      },
      {
        detail: {
          configuration: { target: "ua", value: "bad-bot" },
          description: null,
          kind: "firewall-service",
          mode: "challenge",
          paused: null,
          subtype: "ua-rule",
        },
        firstSeenAt: AT,
        lastSeenAt: AT,
        providerId: "ua-rule:u1",
      },
    ]);
    expect(folded.outcome).toEqual({ complete: true, entityCount: 6, kind: "firewall-service", reasons: [] });
    expect(folded.file.coverage).toEqual([
      syncedCoverageCell({ reason: "reconciled 6 classic firewall entities across all 6 subtypes" }),
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
      { condition: "permission-refused", lastCheckedAt: AT, scope: `${KIND_SCOPE}/lockdown`, status: "closed" },
      { condition: "pagination-incomplete", lastCheckedAt: AT, scope: `${KIND_SCOPE}/rate-limit`, status: "closed" },
    ]);
  });

  it.each([...CLOUDFLARE_FIREWALL_SERVICE_SUBTYPES])(
    "when only %s is refused, that subtype alone keeps its stored entity and every other subtype replaces its own",
    async (failed) => {
      const requests: string[] = [];
      const client = firewallClient({ deniedSubtypes: [failed], itemsBySubtype: NEW_ITEMS, requests });
      const thisZoneStored = CLOUDFLARE_FIREWALL_SERVICE_SUBTYPES.map((subtype) =>
        storedEntity({ raw: { id: "old" }, subtype, zoneId: ZONE_ID }),
      );
      // The same raw ids in another zone: an unfiltered lookup would resurrect or duplicate them.
      const otherZoneStored = CLOUDFLARE_FIREWALL_SERVICE_SUBTYPES.map((subtype) =>
        storedEntity({ raw: { id: "old" }, subtype, zoneId: OTHER_ZONE_ID }),
      );
      const succeededNeighbour = followingSubtype({ subtype: failed });
      const stored = storedFile({
        entities: [...otherZoneStored, ...thisZoneStored],
        gaps: [storedGap({ condition: "permission-refused", subtype: succeededNeighbour })],
      });
      const message = deniedMessage({ subtype: failed });
      const failedScope = `${KIND_SCOPE}/${failed}`;

      const folded = unwrap(
        await syncFirewallServiceKind({ accountId: ACCOUNT_ID, at: AT, client, stored, zoneId: ZONE_ID }),
      );

      // Every subtype was attempted, the refused one included.
      expect([...new Set(requests)].toSorted()).toEqual(
        CLOUDFLARE_FIREWALL_SERVICE_SUBTYPES.map((subtype) => ROUTES[subtype].path).toSorted(),
      );
      const thisZone = entitiesOfZone({ entities: folded.file.entities, zoneId: ZONE_ID });
      expect(survivorView({ entities: thisZone })).toEqual(
        CLOUDFLARE_FIREWALL_SERVICE_SUBTYPES.map((subtype) => {
          if (subtype === failed) {
            return { firstSeenAt: STORED_AT, lastSeenAt: STORED_AT, providerId: `${subtype}:old` };
          }
          return { firstSeenAt: AT, lastSeenAt: AT, providerId: `${subtype}:new` };
        }).toSorted((left, right) => left.providerId.localeCompare(right.providerId)),
      );
      expect(thisZone.filter((entity) => entity.providerId === `${failed}:old`)).toEqual(
        thisZoneStored.filter((entity) => entity.providerId === `${failed}:old`),
      );
      expect(entitiesOfZone({ entities: folded.file.entities, zoneId: OTHER_ZONE_ID })).toEqual(
        entitiesOfZone({ entities: otherZoneStored, zoneId: OTHER_ZONE_ID }),
      );
      expect(folded.outcome.complete).toBe(false);
      expect(folded.outcome.entityCount).toBe(12);
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
          kind: "firewall-service",
          lastCheckedAt: AT,
          lastDetectedAt: AT,
          reason: message,
          scope: failedScope,
          status: "open",
        },
      ]);
      // A refused sibling does not stop a succeeded subtype earning its own rechecks.
      expect(
        folded.file.gaps
          .filter((gap) => gap.status === "closed")
          .map((gap) => ({ condition: gap.condition, lastCheckedAt: gap.lastCheckedAt, scope: gap.scope })),
      ).toEqual([{ condition: "permission-refused", lastCheckedAt: AT, scope: `${KIND_SCOPE}/${succeededNeighbour}` }]);
      expect(folded.file.gaps.length).toBe(2);
    },
  );

  it("carries an already-stored entity's firstSeenAt through a refresh and reports the singular entity", async () => {
    const requests: string[] = [];
    const client = firewallClient({
      itemsBySubtype: {
        filter: [{ expression: "ip.src eq 2.2.2.2", id: "f1" }],
        "firewall-rule": [],
        "ip-access-rule": [],
        lockdown: [],
        "rate-limit": [],
        "ua-rule": [],
      },
      requests,
    });
    const stored = storedFile({
      entities: [
        storedEntity({ raw: { expression: "ip.src eq 1.1.1.1", id: "f1" }, subtype: "filter", zoneId: ZONE_ID }),
      ],
    });

    const folded = unwrap(
      await syncFirewallServiceKind({ accountId: ACCOUNT_ID, at: AT, client, stored, zoneId: ZONE_ID }),
    );

    expect(entityView({ entities: folded.file.entities })).toEqual([
      {
        detail: {
          description: null,
          expression: "ip.src eq 2.2.2.2",
          kind: "firewall-service",
          paused: null,
          ref: null,
          subtype: "filter",
        },
        firstSeenAt: STORED_AT,
        lastSeenAt: AT,
        providerId: "filter:f1",
      },
    ]);
    expect(folded.file.coverage).toEqual([
      syncedCoverageCell({ reason: "reconciled 1 classic firewall entity across all 6 subtypes" }),
    ]);
  });
});
