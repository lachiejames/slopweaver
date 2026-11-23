import { describe, expect, it } from "vitest";

import { syncAccountFilterListKind } from "../../../../atlas/cloudflare/accountFilterListSync.js";
import { createCloudflareClient } from "../../../../atlas/cloudflare/client.js";
import { cloudflareEntityId, cloudflareGapId } from "../../../../atlas/cloudflare/identity.js";
import {
  CLOUDFLARE_VISIBILITY_SCOPE,
  type CloudflareEntity,
  type CloudflareKindFile,
  emptyCloudflareKindFile,
} from "../../../../atlas/cloudflare/model.js";
import {
  type CloudflareRawAccountFilterList,
  type CloudflareRawAccountFilterListItem,
  normalizeCloudflareAccountFilterListItem,
  projectCloudflareAccountFilterList,
} from "../../../../atlas/cloudflare/projection/accountFilterList.js";
import { unwrap } from "../../../../lib/result.js";
import { requestedCursor } from "./requestedPage.js";

const AT = "2026-02-01T00:00:00.000Z";
const OLD = "2026-01-01T00:00:00.000Z";
const ACCOUNT_ID = "a".repeat(32);
const SCOPE = `account/${ACCOUNT_ID}/account-filter-list`;
const BASE = `/client/v4/accounts/${ACCOUNT_ID}/rules/lists`;
const INVENTORY_KEY = `${BASE}@-`;

/** The remedy text every permission-only boundary carries (`kindFold.ts`'s `CLOUDFLARE_TOKEN_REMEDY`). */
const TOKEN_REMEDY =
  "an API token scoped to read this surface — the account holds it and the configured token may not see it," +
  " so widening the token's permissions at Cloudflare is what would fill this kind";

/** What the SDK's own error text says for a 403 carrying `{ message: "denied" }`, as the typed error wraps it. */
const INVENTORY_DENIED =
  "cloudflare account-filter-lists-list: permission denied (403) — the configured token cannot see this surface: " +
  '403 {"errors":[{"message":"denied"}],"success":false}';
const ITEMS_DENIED =
  "cloudflare account-filter-list-items-list: permission denied (403) — the configured token cannot see this surface: " +
  '403 {"errors":[{"message":"denied"}],"success":false}';

const LIST_A: CloudflareRawAccountFilterList = {
  description: "Office egress",
  id: "list-a",
  kind: "ip",
  name: "office ips",
  num_items: 2,
  num_referencing_filters: 1,
};
const LIST_B: CloudflareRawAccountFilterList = {
  id: "list-b",
  kind: "asn",
  name: "bad asns",
  num_items: 1,
  num_referencing_filters: 0,
};

/** One routed response: a refusal at `status`, or a page of `result` whose `cursorAfter` advertises a further page. */
type Route = { readonly status: number } | { readonly result: readonly unknown[]; readonly cursorAfter?: string };

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
 * A real client over a routing fetch. Routes are keyed `<path>@<cursor>` (`-` for no cursor); an unrouted
 * request answers 404 naming the key, so a wrongly-shaped request surfaces as a gap rather than a hang. Every
 * request key is recorded.
 */
function servedClient({ routes }: { routes: Readonly<Record<string, Route>> }) {
  const requests: string[] = [];
  const client = createCloudflareClient({
    apiToken: "t",
    fetchImpl: async (input) => {
      const url = requestUrl({ input });
      const cursor = requestedCursor({ url });
      const key = cursor === null ? `${url.pathname}@-` : `${url.pathname}@${cursor}`;
      requests.push(key);
      const route = routes[key];
      if (route === undefined) {
        return jsonResponse({ body: { errors: [{ message: `unrouted ${key}` }], success: false }, status: 404 });
      }
      if ("status" in route) {
        return jsonResponse({ body: { errors: [{ message: "denied" }], success: false }, status: route.status });
      }
      const resultInfo = route.cursorAfter === undefined ? {} : { cursors: { after: route.cursorAfter } };
      return jsonResponse({ body: { result: route.result, result_info: resultInfo, success: true }, status: 200 });
    },
    maxRetries: 0,
  });
  return { client, requests };
}

/** A stored entity, projected by the module's own projection at the earlier timestamp. */
function storedList({
  raw,
  items,
}: {
  raw: CloudflareRawAccountFilterList;
  items: readonly CloudflareRawAccountFilterListItem[];
}): CloudflareEntity {
  return projectCloudflareAccountFilterList({
    accountId: ACCOUNT_ID,
    at: OLD,
    items: items.map((item) => normalizeCloudflareAccountFilterListItem({ raw: item })),
    raw,
  });
}

/** A stored kind file holding the given entities and the kind's earlier synced coverage cell. */
function storedFile({ entities }: { entities: readonly CloudflareEntity[] }): CloudflareKindFile {
  return {
    ...emptyCloudflareKindFile({ kind: "account-filter-list", updatedAt: OLD }),
    coverage: [
      {
        lastSuccessAt: OLD,
        latestAttemptFailed: false,
        reason: "reconciled earlier",
        scope: SCOPE,
        state: "synced",
        unblockedBy: null,
        visibilityScope: CLOUDFLARE_VISIBILITY_SCOPE,
      },
    ],
    entities: [...entities],
  };
}

/**
 * The entity this run is expected to publish, written out field by field rather than projected. One already
 * stored keeps the `firstSeenAt` it was first stored with; a new one is first seen now.
 */
function expectedEntity({
  providerId,
  detail,
  firstSeenAt = AT,
}: {
  providerId: string;
  detail: Record<string, unknown>;
  firstSeenAt?: string;
}) {
  return {
    detail: { kind: "account-filter-list", ...detail },
    firstSeenAt,
    id: cloudflareEntityId({ components: { accountId: ACCOUNT_ID, providerId }, kind: "account-filter-list" }),
    kind: "account-filter-list",
    lastSeenAt: AT,
    providerId,
    scope: { accountId: ACCOUNT_ID, parentId: null, zoneId: null },
    source: { channel: "rest-api", observedAt: AT, operation: "account-filter-lists-fanout" },
    state: "observed",
  };
}

/** Sort as `reconcileParentFanout` does: by hashed entity id, not by inventory order. */
function byId<T extends { id: string }>({ entities }: { entities: readonly T[] }): readonly T[] {
  return entities.toSorted((left, right) => left.id.localeCompare(right.id));
}

function openPermissionGap({ scope, reason }: { scope: string; reason: string }) {
  return {
    condition: "permission-refused",
    firstDetectedAt: AT,
    id: cloudflareGapId({ condition: "permission-refused", scope }),
    kind: "account-filter-list",
    lastCheckedAt: AT,
    lastDetectedAt: AT,
    reason,
    scope,
    status: "open",
  };
}

describe("syncAccountFilterListKind", () => {
  it("keeps the stored entities, marks coverage unreadable and opens the permission gap when the inventory is refused", async () => {
    const stored = storedFile({
      entities: [
        storedList({ items: [{ id: "old-1", ip: "192.0.2.9" }], raw: LIST_A }),
        storedList({ items: [], raw: LIST_B }),
      ],
    });
    const served = servedClient({ routes: { [INVENTORY_KEY]: { status: 403 } } });

    const folded = unwrap(
      await syncAccountFilterListKind({ accountId: ACCOUNT_ID, at: AT, client: served.client, stored }),
    );

    expect(served.requests).toEqual([INVENTORY_KEY]);
    expect(folded.outcome).toEqual({
      complete: false,
      entityCount: 2,
      kind: "account-filter-list",
      permissionBlocked: { detail: INVENTORY_DENIED, unblockedBy: TOKEN_REMEDY },
      reasons: [INVENTORY_DENIED],
    });
    expect(folded.file.entities).toEqual(stored.entities);
    expect(folded.file.coverage).toEqual([
      {
        lastSuccessAt: OLD,
        latestAttemptFailed: true,
        reason: INVENTORY_DENIED,
        scope: SCOPE,
        state: "unreadable",
        unblockedBy: null,
        visibilityScope: CLOUDFLARE_VISIBILITY_SCOPE,
      },
    ]);
    expect(folded.file.gaps).toEqual([openPermissionGap({ reason: INVENTORY_DENIED, scope: SCOPE })]);
    expect(folded.file.updatedAt).toBe(AT);
  });

  it("embeds each list's normalized items, cursor-paging a list that spans two pages, and closes with synced coverage", async () => {
    const served = servedClient({
      routes: {
        [INVENTORY_KEY]: { result: [LIST_A, LIST_B] },
        [`${BASE}/list-a/items@-`]: {
          cursorAfter: "c1",
          result: [{ comment: "hq", id: "item-1", ip: "192.0.2.1" }],
        },
        [`${BASE}/list-a/items@c1`]: { result: [{ id: "item-2", ip: "192.0.2.2" }] },
        [`${BASE}/list-b/items@-`]: { result: [{ asn: 64500, id: "item-3" }] },
      },
    });
    const stored = emptyCloudflareKindFile({ kind: "account-filter-list", updatedAt: OLD });

    const folded = unwrap(
      await syncAccountFilterListKind({ accountId: ACCOUNT_ID, at: AT, client: served.client, stored }),
    );

    expect(served.requests.toSorted()).toEqual(
      [INVENTORY_KEY, `${BASE}/list-a/items@-`, `${BASE}/list-a/items@c1`, `${BASE}/list-b/items@-`].toSorted(),
    );
    expect(served.requests[0]).toBe(INVENTORY_KEY);
    expect(folded.outcome).toEqual({ complete: true, entityCount: 2, kind: "account-filter-list", reasons: [] });
    expect(folded.file.entities).toEqual(
      byId({
        entities: [
          expectedEntity({
            detail: {
              declaredNumItems: 2,
              description: "Office egress",
              items: [
                { comment: "hq", config: { ip: "192.0.2.1" }, id: "item-1" },
                { comment: null, config: { ip: "192.0.2.2" }, id: "item-2" },
              ],
              listKind: "ip",
              name: "office ips",
              numReferencingFilters: 1,
            },
            providerId: "list-a",
          }),
          expectedEntity({
            detail: {
              declaredNumItems: 1,
              description: null,
              items: [{ comment: null, config: { asn: 64500 }, id: "item-3" }],
              listKind: "asn",
              name: "bad asns",
              numReferencingFilters: 0,
            },
            providerId: "list-b",
          }),
        ],
      }),
    );
    expect(folded.file.coverage).toEqual([
      {
        lastSuccessAt: AT,
        latestAttemptFailed: false,
        reason: "reconciled 2 filter list(s)",
        scope: SCOPE,
        state: "synced",
        unblockedBy: null,
        visibilityScope: CLOUDFLARE_VISIBILITY_SCOPE,
      },
    ]);
    expect(folded.file.gaps).toEqual([]);
  });

  it("costs only the refused list its fresh items: it keeps its stored items under fresh metadata, the other list updates", async () => {
    const renamedB: CloudflareRawAccountFilterList = { ...LIST_B, name: "bad asns v2", num_items: 5 };
    const stored = storedFile({
      entities: [
        storedList({ items: [{ id: "old-a", ip: "192.0.2.9" }], raw: LIST_A }),
        storedList({ items: [{ id: "old-b", asn: 64501, comment: "kept" }], raw: LIST_B }),
      ],
    });
    const served = servedClient({
      routes: {
        [INVENTORY_KEY]: { result: [LIST_A, renamedB] },
        [`${BASE}/list-a/items@-`]: { result: [{ id: "fresh-a", ip: "192.0.2.50" }] },
        [`${BASE}/list-b/items@-`]: { status: 403 },
      },
    });

    const folded = unwrap(
      await syncAccountFilterListKind({ accountId: ACCOUNT_ID, at: AT, client: served.client, stored }),
    );

    const parentScope = `${SCOPE}/list-b`;
    const reason = `list-b: ${ITEMS_DENIED}`;
    expect(folded.outcome).toEqual({
      complete: false,
      entityCount: 2,
      kind: "account-filter-list",
      permissionBlocked: { detail: `${parentScope}: ${ITEMS_DENIED}`, unblockedBy: TOKEN_REMEDY },
      reasons: [reason],
    });
    expect(folded.file.entities).toEqual(
      byId({
        entities: [
          expectedEntity({
            detail: {
              declaredNumItems: 2,
              description: "Office egress",
              items: [{ comment: null, config: { ip: "192.0.2.50" }, id: "fresh-a" }],
              listKind: "ip",
              name: "office ips",
              numReferencingFilters: 1,
            },
            firstSeenAt: OLD,
            providerId: "list-a",
          }),
          expectedEntity({
            detail: {
              declaredNumItems: 5,
              description: null,
              items: [{ comment: "kept", config: { asn: 64501 }, id: "old-b" }],
              listKind: "asn",
              name: "bad asns v2",
              numReferencingFilters: 0,
            },
            firstSeenAt: OLD,
            providerId: "list-b",
          }),
        ],
      }),
    );
    expect(folded.file.coverage).toEqual([
      {
        lastSuccessAt: OLD,
        latestAttemptFailed: true,
        reason,
        scope: SCOPE,
        state: "unreadable",
        unblockedBy: null,
        visibilityScope: CLOUDFLARE_VISIBILITY_SCOPE,
      },
    ]);
    expect(folded.file.gaps).toEqual([openPermissionGap({ reason: ITEMS_DENIED, scope: parentScope })]);
  });

  it("prunes a stored list the successful inventory no longer carries", async () => {
    const stored = storedFile({
      entities: [
        storedList({ items: [], raw: LIST_A }),
        storedList({ items: [], raw: LIST_B }),
        storedList({ items: [], raw: { ...LIST_B, id: "list-gone", name: "deleted" } }),
      ],
    });
    const served = servedClient({
      routes: {
        [INVENTORY_KEY]: { result: [LIST_A, LIST_B] },
        [`${BASE}/list-a/items@-`]: { result: [] },
        [`${BASE}/list-b/items@-`]: { result: [] },
      },
    });

    const folded = unwrap(
      await syncAccountFilterListKind({ accountId: ACCOUNT_ID, at: AT, client: served.client, stored }),
    );

    expect(folded.file.entities.map((entity) => entity.providerId).toSorted()).toEqual(["list-a", "list-b"]);
    expect(folded.outcome).toEqual({ complete: true, entityCount: 2, kind: "account-filter-list", reasons: [] });
    expect(served.requests.toSorted()).toEqual(
      [INVENTORY_KEY, `${BASE}/list-a/items@-`, `${BASE}/list-b/items@-`].toSorted(),
    );
  });
});
