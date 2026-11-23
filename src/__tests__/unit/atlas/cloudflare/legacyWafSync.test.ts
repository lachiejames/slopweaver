import { describe, expect, it } from "vitest";

import { createCloudflareClient } from "../../../../atlas/cloudflare/client.js";
import { type CloudflareGapCondition, openCloudflareGap } from "../../../../atlas/cloudflare/gaps.js";
import { cloudflareGapId, cloudflareZoneEntityId } from "../../../../atlas/cloudflare/identity.js";
import { syncLegacyWafKind } from "../../../../atlas/cloudflare/legacyWafSync.js";
import {
  CLOUDFLARE_VISIBILITY_SCOPE,
  type CloudflareEntity,
  type CloudflareGap,
  type CloudflareKindFile,
  emptyCloudflareKindFile,
} from "../../../../atlas/cloudflare/model.js";
import {
  type CloudflareLegacyWafRawChildItem,
  type CloudflareRawWafOverride,
  type CloudflareRawWafPackage,
  normalizeCloudflareLegacyWafChildItem,
  projectCloudflareWafOverride,
  projectCloudflareWafPackage,
} from "../../../../atlas/cloudflare/projection/legacyWaf.js";
import { unwrap } from "../../../../lib/result.js";
import { requestedPage } from "./requestedPage.js";

const AT = "2026-02-01T00:00:00.000Z";
const OLD = "2026-01-01T00:00:00.000Z";
const ACCOUNT_ID = "a".repeat(32);
const ZONE_ID = "z".repeat(32);
const OTHER_ZONE_ID = "y".repeat(32);
const KIND_SCOPE = `zone/${ZONE_ID}/legacy-waf`;
const PACKAGES_SCOPE = `zone/${ZONE_ID}/legacy-waf/packages`;
const OVERRIDES_SCOPE = `zone/${ZONE_ID}/legacy-waf/overrides`;
const WAF_BASE = `/client/v4/zones/${ZONE_ID}/firewall/waf`;
const PACKAGES_PATH = `${WAF_BASE}/packages`;
const OVERRIDES_PATH = `${WAF_BASE}/overrides`;

/** The remedy text every permission-only boundary carries (`kindFold.ts`'s `CLOUDFLARE_TOKEN_REMEDY`). */
const TOKEN_REMEDY =
  "an API token scoped to read this surface — the account holds it and the configured token may not see it," +
  " so widening the token's permissions at Cloudflare is what would fill this kind";

/** The typed client error's message for a 403 carrying `{ message: "denied" }` on one named operation. */
function deniedMessage({ operation }: { operation: string }): string {
  return (
    `cloudflare ${operation}: permission denied (403) — the configured token cannot see this surface: ` +
    '403 {"errors":[{"message":"denied"}],"success":false}'
  );
}

const PACKAGES_DENIED = deniedMessage({ operation: "legacy-waf-packages-list" });
const OVERRIDES_DENIED = deniedMessage({ operation: "legacy-waf-overrides-list" });
const GROUPS_DENIED = deniedMessage({ operation: "legacy-waf-package-groups-list" });

/** One routed response: a refusal at `status`, or the first page's `result` (every later page is empty). */
type Route = { readonly status: number } | { readonly result: readonly unknown[] };

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

/** The groups path of one package in the configured zone. */
function groupsPath({ packageId }: { packageId: string }): string {
  return `${PACKAGES_PATH}/${packageId}/groups`;
}

/** The rules path of one package in the configured zone. */
function rulesPath({ packageId }: { packageId: string }): string {
  return `${PACKAGES_PATH}/${packageId}/rules`;
}

/** The two request keys a page-paginated list that served items costs: its data page, then the empty page that ends it. */
function pagedKeys({ path }: { path: string }): string[] {
  return [`${path}@1`, `${path}@2`];
}

/**
 * A real client over a routing fetch. Routes are keyed by pathname; every request is recorded as
 * `<path>@<page>`. A routed list serves its `result` on page 1 and an empty page after, so the SDK's page
 * iterator terminates; a routed refusal answers its status. An unrouted path answers 404 naming the key, so
 * a wrongly-wired endpoint surfaces as a gap rather than an empty success.
 */
function servedClient({ routes }: { routes: Readonly<Record<string, Route>> }) {
  const requests: string[] = [];
  const client = createCloudflareClient({
    apiToken: "t",
    fetchImpl: async (input) => {
      const url = requestUrl({ input });
      const page = requestedPage({ url });
      const key = `${url.pathname}@${String(page)}`;
      requests.push(key);
      const route = routes[url.pathname];
      if (route === undefined) {
        return jsonResponse({ body: { errors: [{ message: `unrouted ${key}` }], success: false }, status: 404 });
      }
      if ("status" in route) {
        return jsonResponse({ body: { errors: [{ message: "denied" }], success: false }, status: route.status });
      }
      const result = page === 1 ? route.result : [];
      return jsonResponse({
        body: { result, result_info: { count: result.length, page }, success: true },
        status: 200,
      });
    },
    maxRetries: 0,
  });
  return { client, requests };
}

/** A stored package entity in `zoneId`, projected by the module's own projection at the earlier timestamp. */
function storedPackage({
  raw,
  children,
  zoneId = ZONE_ID,
}: {
  raw: CloudflareRawWafPackage;
  children: readonly CloudflareLegacyWafRawChildItem[];
  zoneId?: string;
}): CloudflareEntity {
  return projectCloudflareWafPackage({
    accountId: ACCOUNT_ID,
    at: OLD,
    children: children.map((child) => normalizeCloudflareLegacyWafChildItem({ raw: child })),
    raw,
    zoneId,
  });
}

/** A stored override entity in `zoneId`, projected by the module's own projection at the earlier timestamp. */
function storedOverride({
  raw,
  zoneId = ZONE_ID,
}: {
  raw: CloudflareRawWafOverride & { id: string };
  zoneId?: string;
}): CloudflareEntity {
  return projectCloudflareWafOverride({ accountId: ACCOUNT_ID, at: OLD, raw, zoneId });
}

/** A stored kind file holding the given entities and gaps, plus the kind's earlier synced coverage cell. */
function storedFile({
  entities,
  gaps = [],
}: {
  entities: readonly CloudflareEntity[];
  gaps?: readonly CloudflareGap[];
}): CloudflareKindFile {
  return {
    ...emptyCloudflareKindFile({ kind: "legacy-waf", updatedAt: OLD }),
    coverage: [
      {
        lastSuccessAt: OLD,
        latestAttemptFailed: false,
        reason: "reconciled earlier",
        scope: KIND_SCOPE,
        state: "synced",
        unblockedBy: null,
        visibilityScope: CLOUDFLARE_VISIBILITY_SCOPE,
      },
    ],
    entities: [...entities],
    gaps: [...gaps],
  };
}

/** One stored group detail, written out field by field: every field the raw group omitted is null or empty. */
function groupDetail({ id, name, mode }: { id: string; name: string; mode: string }) {
  return { allowedModes: [], description: null, id, mode, modifiedRulesCount: null, name, rulesCount: null };
}

/** One stored rule detail, written out field by field: every field the raw rule omitted is null or empty. */
function ruleDetail({ id, description, groupId }: { id: string; description: string; groupId: string }) {
  return {
    allowedModes: [],
    defaultMode: null,
    description,
    groupId,
    groupName: null,
    id,
    mode: "block",
    priority: null,
  };
}

/** The package entity this run is expected to publish in the configured zone, written out rather than projected. */
function expectedPackage({
  packageId,
  config,
  groups,
  rules,
  firstSeenAt,
}: {
  packageId: string;
  config: Record<string, unknown>;
  groups: readonly unknown[];
  rules: readonly unknown[];
  /** `OLD` for a package already stored, `AT` for one first seen this run. */
  firstSeenAt: string;
}) {
  const providerId = `package:${packageId}`;
  return {
    detail: { config, groups, itemKind: "package", kind: "legacy-waf", rules },
    firstSeenAt,
    id: cloudflareZoneEntityId({
      components: { accountId: ACCOUNT_ID, providerId },
      kind: "legacy-waf",
      zoneId: ZONE_ID,
    }),
    kind: "legacy-waf",
    lastSeenAt: AT,
    providerId,
    scope: { accountId: ACCOUNT_ID, parentId: null, zoneId: ZONE_ID },
    source: { channel: "rest-api", observedAt: AT, operation: "legacy-waf-packages-fanout" },
    state: "observed",
  };
}

/** The override entity this run is expected to publish in the configured zone, written out rather than projected. */
function expectedOverride({
  overrideId,
  description,
  urls,
  firstSeenAt,
}: {
  overrideId: string;
  description: string;
  urls: readonly string[];
  /** `OLD` for an override already stored, `AT` for one first seen this run. */
  firstSeenAt: string;
}) {
  const providerId = `override:${overrideId}`;
  return {
    detail: {
      description,
      groupActions: {},
      itemKind: "override",
      kind: "legacy-waf",
      paused: false,
      priority: 1,
      rewriteAction: null,
      ruleActions: {},
      urls,
    },
    firstSeenAt,
    id: cloudflareZoneEntityId({
      components: { accountId: ACCOUNT_ID, providerId },
      kind: "legacy-waf",
      zoneId: ZONE_ID,
    }),
    kind: "legacy-waf",
    lastSeenAt: AT,
    providerId,
    scope: { accountId: ACCOUNT_ID, parentId: null, zoneId: ZONE_ID },
    source: { channel: "rest-api", observedAt: AT, operation: "legacy-waf-overrides-list" },
    state: "observed",
  };
}

/** The published entities belonging to `zoneId`, ordered by provider id (`override:` sorts before `package:`). */
function entitiesOfZone({ file, zoneId }: { file: CloudflareKindFile; zoneId: string }): readonly CloudflareEntity[] {
  return file.entities
    .filter((entity) => entity.scope.zoneId === zoneId)
    .toSorted((left, right) => left.providerId.localeCompare(right.providerId));
}

/** The open permission-refused gap this run is expected to publish at `scope`, written out field by field. */
function openPermissionGap({ scope, reason }: { scope: string; reason: string }) {
  return {
    condition: "permission-refused",
    firstDetectedAt: AT,
    id: cloudflareGapId({ condition: "permission-refused", scope }),
    kind: "legacy-waf",
    lastCheckedAt: AT,
    lastDetectedAt: AT,
    reason,
    scope,
    status: "open",
  };
}

/** A gap a previous run opened at `scope` under `condition`, stamped with the earlier timestamp. */
function storedGap({ condition, scope }: { condition: CloudflareGapCondition; scope: string }): CloudflareGap {
  return openCloudflareGap({ at: OLD, condition, kind: "legacy-waf", reason: "stored", scope });
}

/** Every gap as `{ condition, scope, status, lastCheckedAt }`, ordered by scope, for lifecycle assertions. */
function gapLifecycle({ file }: { file: CloudflareKindFile }) {
  return file.gaps
    .map((gap) => ({
      condition: gap.condition,
      lastCheckedAt: gap.lastCheckedAt,
      scope: gap.scope,
      status: gap.status,
    }))
    .toSorted((left, right) => left.scope.localeCompare(right.scope));
}

/** The kind's own coverage cell after a failed run that had previously synced at `OLD`. */
function failedKindCell({ reason }: { reason: string }) {
  return {
    lastSuccessAt: OLD,
    latestAttemptFailed: true,
    reason,
    scope: KIND_SCOPE,
    state: "unreadable",
    unblockedBy: null,
    visibilityScope: CLOUDFLARE_VISIBILITY_SCOPE,
  };
}

const OLD_GROUP = { group: { id: "g-old", mode: "off" as const, name: "Old group" }, itemKind: "group" as const };
const OLD_RULE = {
  itemKind: "rule" as const,
  rule: { description: "old rule", group: { id: "g-old" }, id: "r-old", mode: "block" },
};
const FRESH_OVERRIDE = { description: "fresh", id: "o-new", paused: false, priority: 1, urls: ["example.com/*"] };

describe("syncLegacyWafKind", () => {
  it("preserves only this zone's packages when the package inventory is refused, and still replaces the overrides", async () => {
    const zonePackage = storedPackage({ children: [OLD_GROUP, OLD_RULE], raw: { id: "pkg-1", name: "OWASP" } });
    const otherZone = [
      storedPackage({ children: [OLD_GROUP], raw: { id: "pkg-x", name: "Elsewhere" }, zoneId: OTHER_ZONE_ID }),
      storedOverride({ raw: { description: "other zone", id: "o-x" }, zoneId: OTHER_ZONE_ID }),
    ];
    const stored = storedFile({
      entities: [...otherZone, zonePackage, storedOverride({ raw: { description: "stale", id: "o-old" } })],
    });
    const served = servedClient({
      routes: { [OVERRIDES_PATH]: { result: [FRESH_OVERRIDE] }, [PACKAGES_PATH]: { status: 403 } },
    });

    const folded = unwrap(
      await syncLegacyWafKind({ accountId: ACCOUNT_ID, at: AT, client: served.client, stored, zoneId: ZONE_ID }),
    );

    const reason = `packages: ${PACKAGES_DENIED}`;
    // No package's groups or rules are read when the inventory naming them was refused, and the retired
    // overrides list is one GET: the SDK no longer pages it.
    expect(served.requests.toSorted()).toEqual([`${OVERRIDES_PATH}@1`, `${PACKAGES_PATH}@1`].toSorted());
    expect(entitiesOfZone({ file: folded.file, zoneId: ZONE_ID })).toEqual([
      expectedOverride({ description: "fresh", firstSeenAt: AT, overrideId: "o-new", urls: ["example.com/*"] }),
      zonePackage,
    ]);
    expect(entitiesOfZone({ file: folded.file, zoneId: OTHER_ZONE_ID })).toEqual(
      otherZone.toSorted((left, right) => left.providerId.localeCompare(right.providerId)),
    );
    expect(folded.file.gaps).toEqual([openPermissionGap({ reason: PACKAGES_DENIED, scope: PACKAGES_SCOPE })]);
    expect(folded.file.coverage).toEqual([failedKindCell({ reason })]);
    expect(folded.outcome).toEqual({
      complete: false,
      entityCount: 4,
      kind: "legacy-waf",
      permissionBlocked: { detail: `${PACKAGES_SCOPE}: ${PACKAGES_DENIED}`, unblockedBy: TOKEN_REMEDY },
      reasons: [reason],
    });
  });

  it("refreshes the packages and preserves only this zone's old overrides when the overrides read is refused", async () => {
    const zoneOverride = storedOverride({ raw: { description: "kept", id: "o-old", paused: true } });
    const otherOverride = storedOverride({ raw: { description: "other zone", id: "o-x" }, zoneId: OTHER_ZONE_ID });
    const stored = storedFile({
      entities: [
        otherOverride,
        storedPackage({ children: [OLD_GROUP, OLD_RULE], raw: { id: "pkg-1", name: "OWASP" } }),
        zoneOverride,
      ],
    });
    const served = servedClient({
      routes: {
        [groupsPath({ packageId: "pkg-1" })]: { result: [{ id: "g-1", mode: "on", name: "SQLi" }] },
        [OVERRIDES_PATH]: { status: 403 },
        [PACKAGES_PATH]: { result: [{ id: "pkg-1", name: "OWASP v2" }] },
        [rulesPath({ packageId: "pkg-1" })]: {
          result: [{ description: "block sqli", group: { id: "g-1" }, id: "r-1", mode: "block" }],
        },
      },
    });

    const folded = unwrap(
      await syncLegacyWafKind({ accountId: ACCOUNT_ID, at: AT, client: served.client, stored, zoneId: ZONE_ID }),
    );

    const reason = `overrides: ${OVERRIDES_DENIED}`;
    expect(served.requests.toSorted()).toEqual(
      [
        `${OVERRIDES_PATH}@1`,
        ...pagedKeys({ path: PACKAGES_PATH }),
        ...pagedKeys({ path: groupsPath({ packageId: "pkg-1" }) }),
        ...pagedKeys({ path: rulesPath({ packageId: "pkg-1" }) }),
      ].toSorted(),
    );
    expect(entitiesOfZone({ file: folded.file, zoneId: ZONE_ID })).toEqual([
      zoneOverride,
      expectedPackage({
        config: { name: "OWASP v2" },
        firstSeenAt: OLD,
        groups: [groupDetail({ id: "g-1", mode: "on", name: "SQLi" })],
        packageId: "pkg-1",
        rules: [ruleDetail({ description: "block sqli", groupId: "g-1", id: "r-1" })],
      }),
    ]);
    expect(entitiesOfZone({ file: folded.file, zoneId: OTHER_ZONE_ID })).toEqual([otherOverride]);
    expect(folded.file.gaps).toEqual([openPermissionGap({ reason: OVERRIDES_DENIED, scope: OVERRIDES_SCOPE })]);
    expect(folded.file.coverage).toEqual([failedKindCell({ reason })]);
    expect(folded.outcome).toEqual({
      complete: false,
      entityCount: 3,
      kind: "legacy-waf",
      permissionBlocked: { detail: `${OVERRIDES_SCOPE}: ${OVERRIDES_DENIED}`, unblockedBy: TOKEN_REMEDY },
      reasons: [reason],
    });
  });

  it("keeps a refused package's stored groups and rules under fresh metadata, refreshes the other and prunes the absent one", async () => {
    const stored = storedFile({
      entities: [
        storedPackage({ children: [OLD_GROUP, OLD_RULE], raw: { id: "pkg-1", name: "OWASP" } }),
        storedPackage({ children: [OLD_GROUP], raw: { id: "pkg-2", name: "Cloudflare" } }),
        storedPackage({ children: [OLD_RULE], raw: { id: "pkg-gone", name: "Retired" } }),
      ],
    });
    const served = servedClient({
      routes: {
        [groupsPath({ packageId: "pkg-1" })]: { status: 403 },
        [groupsPath({ packageId: "pkg-2" })]: { result: [{ id: "g-2", mode: "on", name: "XSS" }] },
        [OVERRIDES_PATH]: { result: [] },
        [PACKAGES_PATH]: {
          result: [
            { id: "pkg-1", name: "OWASP renamed" },
            { id: "pkg-2", name: "Cloudflare" },
          ],
        },
        [rulesPath({ packageId: "pkg-2" })]: { result: [] },
      },
    });

    const folded = unwrap(
      await syncLegacyWafKind({ accountId: ACCOUNT_ID, at: AT, client: served.client, stored, zoneId: ZONE_ID }),
    );

    const parentScope = `account/${ACCOUNT_ID}/legacy-waf/pkg-1`;
    const reason = `pkg-1: ${GROUPS_DENIED}`;
    // The refused groups read ends pkg-1's combined read, so its rules are never asked for.
    expect(served.requests.toSorted()).toEqual(
      [
        `${OVERRIDES_PATH}@1`,
        ...pagedKeys({ path: PACKAGES_PATH }),
        `${groupsPath({ packageId: "pkg-1" })}@1`,
        ...pagedKeys({ path: groupsPath({ packageId: "pkg-2" }) }),
        `${rulesPath({ packageId: "pkg-2" })}@1`,
      ].toSorted(),
    );
    expect(entitiesOfZone({ file: folded.file, zoneId: ZONE_ID })).toEqual(
      [
        // Before this branch's fix, stored `package:pkg-1` never matched raw id `pkg-1`, so this was rebuilt EMPTY.
        expectedPackage({
          config: { name: "OWASP renamed" },
          firstSeenAt: OLD,
          groups: [groupDetail({ id: "g-old", mode: "off", name: "Old group" })],
          packageId: "pkg-1",
          rules: [ruleDetail({ description: "old rule", groupId: "g-old", id: "r-old" })],
        }),
        expectedPackage({
          config: { name: "Cloudflare" },
          firstSeenAt: OLD,
          groups: [groupDetail({ id: "g-2", mode: "on", name: "XSS" })],
          packageId: "pkg-2",
          rules: [],
        }),
      ].toSorted((left, right) => left.providerId.localeCompare(right.providerId)),
    );
    expect(folded.file.gaps).toEqual([openPermissionGap({ reason: GROUPS_DENIED, scope: parentScope })]);
    expect(folded.file.coverage).toEqual([failedKindCell({ reason })]);
    expect(folded.outcome).toEqual({
      complete: false,
      entityCount: 2,
      kind: "legacy-waf",
      permissionBlocked: { detail: `${parentScope}: ${GROUPS_DENIED}`, unblockedBy: TOKEN_REMEDY },
      reasons: [reason],
    });
  });

  it("closes the package-inventory, per-package and overrides gaps on a fully successful run", async () => {
    const pkg1Scope = `account/${ACCOUNT_ID}/legacy-waf/pkg-1`;
    const stored = storedFile({
      entities: [],
      gaps: [
        storedGap({ condition: "permission-refused", scope: PACKAGES_SCOPE }),
        storedGap({ condition: "permission-refused", scope: pkg1Scope }),
        storedGap({ condition: "provider-error", scope: OVERRIDES_SCOPE }),
      ],
    });
    const served = servedClient({
      routes: {
        [groupsPath({ packageId: "pkg-1" })]: { result: [{ id: "g-1", mode: "on", name: "SQLi" }] },
        [groupsPath({ packageId: "pkg-2" })]: { result: [] },
        [OVERRIDES_PATH]: { result: [FRESH_OVERRIDE] },
        [PACKAGES_PATH]: { result: [{ id: "pkg-1" }, { id: "pkg-2" }] },
        [rulesPath({ packageId: "pkg-1" })]: { result: [] },
        [rulesPath({ packageId: "pkg-2" })]: { result: [] },
      },
    });

    const folded = unwrap(
      await syncLegacyWafKind({ accountId: ACCOUNT_ID, at: AT, client: served.client, stored, zoneId: ZONE_ID }),
    );

    const reason = "reconciled 2 WAF package(s) and 1 override(s)";
    expect(gapLifecycle({ file: folded.file })).toEqual([
      { condition: "permission-refused", lastCheckedAt: AT, scope: pkg1Scope, status: "closed" },
      { condition: "provider-error", lastCheckedAt: AT, scope: OVERRIDES_SCOPE, status: "closed" },
      { condition: "permission-refused", lastCheckedAt: AT, scope: PACKAGES_SCOPE, status: "closed" },
    ]);
    expect(folded.file.coverage).toEqual([
      {
        lastSuccessAt: AT,
        latestAttemptFailed: false,
        reason,
        scope: KIND_SCOPE,
        state: "synced",
        unblockedBy: null,
        visibilityScope: CLOUDFLARE_VISIBILITY_SCOPE,
      },
    ]);
    expect(folded.outcome).toEqual({ complete: true, entityCount: 3, kind: "legacy-waf", reasons: [] });
    expect(entitiesOfZone({ file: folded.file, zoneId: ZONE_ID }).map((entity) => entity.providerId)).toEqual([
      "override:o-new",
      "package:pkg-1",
      "package:pkg-2",
    ]);
  });
});
