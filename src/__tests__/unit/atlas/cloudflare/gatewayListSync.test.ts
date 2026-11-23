import { describe, expect, it } from "vitest";

import { createCloudflareClient } from "../../../../atlas/cloudflare/client.js";
import { succeededCloudflareCoverageCell } from "../../../../atlas/cloudflare/coverage.js";
import { openCloudflareGap } from "../../../../atlas/cloudflare/gaps.js";
import { syncGatewayListKind } from "../../../../atlas/cloudflare/gatewayListSync.js";
import { cloudflareGapId } from "../../../../atlas/cloudflare/identity.js";
import {
  CLOUDFLARE_VISIBILITY_SCOPE,
  type CloudflareEntity,
  type CloudflareGap,
  type CloudflareKindFile,
  emptyCloudflareKindFile,
} from "../../../../atlas/cloudflare/model.js";
import {
  type CloudflareGatewayListItem,
  type CloudflareRawGatewayList,
  projectCloudflareGatewayList,
} from "../../../../atlas/cloudflare/projection/gatewayList.js";
import { unwrap } from "../../../../lib/result.js";
import { requestedPage } from "./requestedPage.js";

const AT = "2026-01-01T00:00:00.000Z";
const STORED_AT = "2025-12-01T00:00:00.000Z";
const ACCOUNT_ID = "a".repeat(32);
const FLAT_SCOPE = `account/${ACCOUNT_ID}/gateway-list`;
const INVENTORY_PATH = `/client/v4/accounts/${ACCOUNT_ID}/gateway/lists`;

/** The message a 403 on the inventory read maps to, exactly as the typed client error words it. */
const INVENTORY_DENIED =
  'cloudflare gateway-lists-list: permission denied (403) — the configured token cannot see this surface: 403 {"errors":[{"message":"denied"}],"success":false}';
/** The message a 403 on one list's item read maps to. */
const ITEMS_DENIED =
  'cloudflare gateway-list-items-list: permission denied (403) — the configured token cannot see this surface: 403 {"errors":[{"message":"denied"}],"success":false}';

function jsonResponse({ status, body }: { status: number; body: unknown }): Response {
  return new Response(JSON.stringify(body), { headers: { "content-type": "application/json" }, status });
}

function deniedResponse(): Response {
  return jsonResponse({ body: { errors: [{ message: "denied" }], success: false }, status: 403 });
}

/** The requested URL, however the SDK passed it. */
function requestUrl({ input }: { input: string | URL | Request }): URL {
  if (typeof input === "string") {
    return new URL(input);
  }
  return input instanceof URL ? input : new URL(input.url);
}

function itemsPath({ listId }: { listId: string }): string {
  return `${INVENTORY_PATH}/${listId}/items`;
}

function listScope({ listId }: { listId: string }): string {
  return `${FLAT_SCOPE}/${listId}`;
}

/**
 * A client serving the Gateway List inventory and one item read per list. `failInventory` answers the
 * inventory 403, any list named in `failItems` answers its own item read 403, and every path actually
 * requested is pushed onto `requests` so a test can say what was NOT asked for. Any other path is a 500, so a
 * module wiring the wrong endpoint fails loudly rather than reading an empty page.
 */
function gatewayClient({
  lists,
  itemsByList,
  requests,
  failInventory = false,
  failItems = [],
}: {
  lists: readonly CloudflareRawGatewayList[];
  itemsByList: Record<string, readonly unknown[]>;
  requests: string[];
  failInventory?: boolean;
  failItems?: readonly string[];
}) {
  return createCloudflareClient({
    apiToken: "t",
    fetchImpl: async (input) => {
      const url = requestUrl({ input });
      requests.push(url.pathname);
      if (url.pathname === INVENTORY_PATH) {
        if (failInventory) {
          return deniedResponse();
        }
        return jsonResponse({ body: { result: lists, success: true }, status: 200 });
      }
      const listId = lists.find((list) => url.pathname === itemsPath({ listId: list.id }))?.id;
      if (listId === undefined) {
        return jsonResponse({ body: { errors: [{ message: "unexpected path" }], success: false }, status: 500 });
      }
      if (failItems.includes(listId)) {
        return deniedResponse();
      }
      const items = itemsByList[listId];
      // A list the test gave no items to holds none, and every page past the first is empty so the
      // page-paginated items list (`cloudflare` 7.2.0) terminates.
      if (items === undefined || requestedPage({ url }) > 1) {
        return jsonResponse({ body: { result: [], success: true }, status: 200 });
      }
      return jsonResponse({ body: { result: items, success: true }, status: 200 });
    },
    maxRetries: 0,
  });
}

function storedList({
  raw,
  items,
}: {
  raw: CloudflareRawGatewayList;
  items: readonly CloudflareGatewayListItem[];
}): CloudflareEntity {
  return projectCloudflareGatewayList({ accountId: ACCOUNT_ID, at: STORED_AT, items, raw });
}

function storedFile({
  entities,
  gaps = [],
  coverage = [],
}: {
  entities: readonly CloudflareEntity[];
  gaps?: readonly CloudflareGap[];
  coverage?: CloudflareKindFile["coverage"];
}): CloudflareKindFile {
  return {
    ...emptyCloudflareKindFile({ kind: "gateway-list", updatedAt: STORED_AT }),
    coverage: [...coverage],
    entities: [...entities],
    gaps: [...gaps],
  };
}

/** The identity-bearing view of a set of entities, ordered by provider id (the stored order is by hashed id). */
function entityView({ entities }: { entities: readonly CloudflareEntity[] }) {
  return entities
    .toSorted((left, right) => left.providerId.localeCompare(right.providerId))
    .map((entity) => ({
      detail: entity.detail,
      firstSeenAt: entity.firstSeenAt,
      lastSeenAt: entity.lastSeenAt,
      providerId: entity.providerId,
    }));
}

function gatewayDetail({
  name,
  type,
  description,
  declaredCount,
  items,
  itemsComplete,
}: {
  name: string | null;
  type: string | null;
  description: string | null;
  declaredCount: number | null;
  items: readonly CloudflareGatewayListItem[];
  itemsComplete: boolean;
}) {
  return { declaredCount, description, itemsComplete, items, kind: "gateway-list", name, type };
}

function openGapsOf({ file }: { file: CloudflareKindFile }): readonly CloudflareGap[] {
  return file.gaps.filter((gap) => gap.status === "open");
}

/** Every gap as `{ condition, scope, status, lastCheckedAt }`, in a fixed order, for lifecycle assertions. */
function gapLifecycle({ file }: { file: CloudflareKindFile }) {
  return file.gaps
    .map((gap) => ({
      condition: gap.condition,
      lastCheckedAt: gap.lastCheckedAt,
      scope: gap.scope,
      status: gap.status,
    }))
    .toSorted((left, right) => `${left.scope}/${left.condition}`.localeCompare(`${right.scope}/${right.condition}`));
}

function storedGap({ condition, scope }: { condition: "permission-refused" | "pagination-incomplete"; scope: string }) {
  return openCloudflareGap({ at: STORED_AT, condition, kind: "gateway-list", reason: "stored", scope });
}

const LIST_1: CloudflareRawGatewayList = {
  count: 2,
  description: "office egress",
  id: "list-1",
  name: "IPs",
  type: "IP",
};
const LIST_2: CloudflareRawGatewayList = { count: 1, id: "list-2", name: "Domains", type: "DOMAIN" };

describe("syncGatewayListKind", () => {
  it("keeps every stored list and reads nothing else when the inventory itself is refused", async () => {
    const requests: string[] = [];
    const client = gatewayClient({ failInventory: true, itemsByList: {}, lists: [], requests });
    const entities = [
      storedList({ items: [{ description: null, value: "10.0.0.1" }], raw: { ...LIST_1, count: 1 } }),
      storedList({ items: [{ description: "d", value: "example.com" }], raw: LIST_2 }),
    ];
    const stored = storedFile({
      coverage: [
        succeededCloudflareCoverageCell({
          at: STORED_AT,
          reason: "reconciled 2 gateway list(s)",
          scope: FLAT_SCOPE,
          state: "synced",
        }),
      ],
      entities,
    });

    const folded = unwrap(await syncGatewayListKind({ accountId: ACCOUNT_ID, at: AT, client, stored }));

    expect(requests).toEqual([INVENTORY_PATH]);
    expect(folded.file.entities).toEqual(entities);
    expect(folded.file.coverage).toEqual([
      {
        lastSuccessAt: STORED_AT,
        latestAttemptFailed: true,
        reason: INVENTORY_DENIED,
        scope: FLAT_SCOPE,
        state: "unreadable",
        unblockedBy: null,
        visibilityScope: CLOUDFLARE_VISIBILITY_SCOPE,
      },
    ]);
    expect(openGapsOf({ file: folded.file })).toEqual([
      {
        condition: "permission-refused",
        firstDetectedAt: AT,
        id: cloudflareGapId({ condition: "permission-refused", scope: FLAT_SCOPE }),
        kind: "gateway-list",
        lastCheckedAt: AT,
        lastDetectedAt: AT,
        reason: INVENTORY_DENIED,
        scope: FLAT_SCOPE,
        status: "open",
      },
    ]);
    expect(folded.file.gaps.length).toBe(1);
    expect(folded.outcome.complete).toBe(false);
    expect(folded.outcome.entityCount).toBe(2);
    expect(folded.outcome.kind).toBe("gateway-list");
    expect(folded.outcome.reasons).toEqual([INVENTORY_DENIED]);
    expect(folded.outcome.permissionBlocked!.detail).toBe(INVENTORY_DENIED);
  });

  it("embeds each list's normalized items and reports complete when every count matches", async () => {
    const requests: string[] = [];
    const client = gatewayClient({
      itemsByList: {
        "list-1": [{ description: "office", value: "10.0.0.1" }, { value: "10.0.0.2" }],
        "list-2": [{ description: "docs", value: "example.com" }],
      },
      lists: [LIST_1, LIST_2],
      requests,
    });
    // A gap a previous run opened against each list: success must close both.
    const stored = storedFile({
      entities: [],
      gaps: [
        storedGap({ condition: "pagination-incomplete", scope: listScope({ listId: "list-1" }) }),
        storedGap({ condition: "permission-refused", scope: listScope({ listId: "list-2" }) }),
      ],
    });

    const folded = unwrap(await syncGatewayListKind({ accountId: ACCOUNT_ID, at: AT, client, stored }));

    // Each list's items cost a data page and the empty page that ends the SDK's page-number pager.
    expect(requests.toSorted()).toEqual([
      INVENTORY_PATH,
      itemsPath({ listId: "list-1" }),
      itemsPath({ listId: "list-1" }),
      itemsPath({ listId: "list-2" }),
      itemsPath({ listId: "list-2" }),
    ]);
    expect(entityView({ entities: folded.file.entities })).toEqual([
      {
        detail: gatewayDetail({
          declaredCount: 2,
          description: "office egress",
          items: [
            { description: "office", value: "10.0.0.1" },
            { description: null, value: "10.0.0.2" },
          ],
          itemsComplete: true,
          name: "IPs",
          type: "IP",
        }),
        firstSeenAt: AT,
        lastSeenAt: AT,
        providerId: "list-1",
      },
      {
        detail: gatewayDetail({
          declaredCount: 1,
          description: null,
          items: [{ description: "docs", value: "example.com" }],
          itemsComplete: true,
          name: "Domains",
          type: "DOMAIN",
        }),
        firstSeenAt: AT,
        lastSeenAt: AT,
        providerId: "list-2",
      },
    ]);
    expect(folded.outcome).toEqual({ complete: true, entityCount: 2, kind: "gateway-list", reasons: [] });
    expect(folded.file.coverage).toEqual([
      {
        lastSuccessAt: AT,
        latestAttemptFailed: false,
        reason: "reconciled 2 gateway list(s)",
        scope: FLAT_SCOPE,
        state: "synced",
        unblockedBy: null,
        visibilityScope: CLOUDFLARE_VISIBILITY_SCOPE,
      },
    ]);
    expect(openGapsOf({ file: folded.file })).toEqual([]);
    expect(gapLifecycle({ file: folded.file })).toEqual([
      {
        condition: "pagination-incomplete",
        lastCheckedAt: AT,
        scope: listScope({ listId: "list-1" }),
        status: "closed",
      },
      { condition: "permission-refused", lastCheckedAt: AT, scope: listScope({ listId: "list-2" }), status: "closed" },
    ]);
  });

  it("preserves only the refused list's stored items, under fresh parent metadata, and opens a parent-scoped gap", async () => {
    const requests: string[] = [];
    const client = gatewayClient({
      failItems: ["list-1"],
      itemsByList: { "list-2": [{ description: "fresh", value: "new.example.com" }] },
      lists: [{ ...LIST_1, description: "renamed", name: "IPs v2" }, LIST_2],
      requests,
    });
    const stored = storedFile({
      entities: [
        storedList({
          items: [
            { description: "a", value: "10.0.0.1" },
            { description: "b", value: "10.0.0.2" },
          ],
          raw: LIST_1,
        }),
        storedList({ items: [{ description: "old", value: "old.example.com" }], raw: LIST_2 }),
      ],
    });

    const folded = unwrap(await syncGatewayListKind({ accountId: ACCOUNT_ID, at: AT, client, stored }));

    expect(entityView({ entities: folded.file.entities })).toEqual([
      {
        detail: gatewayDetail({
          declaredCount: 2,
          description: "renamed",
          items: [
            { description: "a", value: "10.0.0.1" },
            { description: "b", value: "10.0.0.2" },
          ],
          itemsComplete: true,
          name: "IPs v2",
          type: "IP",
        }),
        // Both lists were stored before this run, so each keeps the instant it was first seen.
        firstSeenAt: STORED_AT,
        lastSeenAt: AT,
        providerId: "list-1",
      },
      {
        detail: gatewayDetail({
          declaredCount: 1,
          description: null,
          items: [{ description: "fresh", value: "new.example.com" }],
          itemsComplete: true,
          name: "Domains",
          type: "DOMAIN",
        }),
        firstSeenAt: STORED_AT,
        lastSeenAt: AT,
        providerId: "list-2",
      },
    ]);
    expect(folded.outcome.complete).toBe(false);
    expect(folded.outcome.entityCount).toBe(2);
    expect(folded.outcome.reasons).toEqual([`list-1: ${ITEMS_DENIED}`]);
    expect(folded.file.coverage.map((cell) => ({ reason: cell.reason, state: cell.state }))).toEqual([
      { reason: `list-1: ${ITEMS_DENIED}`, state: "unreadable" },
    ]);
    expect(openGapsOf({ file: folded.file })).toEqual([
      {
        condition: "permission-refused",
        firstDetectedAt: AT,
        id: cloudflareGapId({ condition: "permission-refused", scope: listScope({ listId: "list-1" }) }),
        kind: "gateway-list",
        lastCheckedAt: AT,
        lastDetectedAt: AT,
        reason: ITEMS_DENIED,
        scope: listScope({ listId: "list-1" }),
        status: "open",
      },
    ]);
    expect(folded.file.gaps.length).toBe(1);
  });

  it("prunes a stored list that a successful inventory no longer names", async () => {
    const requests: string[] = [];
    const client = gatewayClient({
      itemsByList: { "list-1": [{ value: "10.0.0.1" }, { value: "10.0.0.2" }], "list-2": [{ value: "example.com" }] },
      lists: [LIST_1, LIST_2],
      requests,
    });
    const stored = storedFile({
      entities: [
        storedList({ items: [], raw: LIST_1 }),
        storedList({ items: [], raw: LIST_2 }),
        storedList({ items: [{ description: null, value: "gone.example.com" }], raw: { count: 1, id: "list-gone" } }),
      ],
    });

    const folded = unwrap(await syncGatewayListKind({ accountId: ACCOUNT_ID, at: AT, client, stored }));

    expect(folded.file.entities.map((entity) => entity.providerId).toSorted()).toEqual(["list-1", "list-2"]);
    expect(requests.toSorted()).toEqual([
      INVENTORY_PATH,
      itemsPath({ listId: "list-1" }),
      itemsPath({ listId: "list-1" }),
      itemsPath({ listId: "list-2" }),
      itemsPath({ listId: "list-2" }),
    ]);
    expect(folded.outcome).toEqual({ complete: true, entityCount: 2, kind: "gateway-list", reasons: [] });
  });

  it("marks a list incomplete when a successful item read is shorter than its declared count", async () => {
    const requests: string[] = [];
    const client = gatewayClient({
      itemsByList: {
        "list-ok": [{ description: "only", value: "example.com" }],
        "list-short": [{ value: "10.0.0.1" }, { value: "10.0.0.2" }],
      },
      lists: [
        { count: 3, id: "list-short", name: "Short", type: "IP" },
        { count: 1, id: "list-ok", name: "Fine", type: "DOMAIN" },
      ],
      requests,
    });
    // A stale shortfall gap on the list that is now complete must close; the short list's must stay open.
    const stored = storedFile({
      entities: [],
      gaps: [storedGap({ condition: "pagination-incomplete", scope: listScope({ listId: "list-ok" }) })],
    });

    const folded = unwrap(await syncGatewayListKind({ accountId: ACCOUNT_ID, at: AT, client, stored }));

    expect(entityView({ entities: folded.file.entities })).toEqual([
      {
        detail: gatewayDetail({
          declaredCount: 1,
          description: null,
          items: [{ description: "only", value: "example.com" }],
          itemsComplete: true,
          name: "Fine",
          type: "DOMAIN",
        }),
        firstSeenAt: AT,
        lastSeenAt: AT,
        providerId: "list-ok",
      },
      {
        detail: gatewayDetail({
          declaredCount: 3,
          description: null,
          items: [
            { description: null, value: "10.0.0.1" },
            { description: null, value: "10.0.0.2" },
          ],
          itemsComplete: false,
          name: "Short",
          type: "IP",
        }),
        firstSeenAt: AT,
        lastSeenAt: AT,
        providerId: "list-short",
      },
    ]);
    expect(folded.outcome).toEqual({
      complete: false,
      entityCount: 2,
      kind: "gateway-list",
      reasons: ["list-short: item count incomplete"],
    });
    expect(folded.file.coverage.map((cell) => ({ reason: cell.reason, state: cell.state }))).toEqual([
      { reason: "list-short: item count incomplete", state: "unreadable" },
    ]);
    expect(openGapsOf({ file: folded.file })).toEqual([
      {
        condition: "pagination-incomplete",
        firstDetectedAt: AT,
        id: cloudflareGapId({ condition: "pagination-incomplete", scope: listScope({ listId: "list-short" }) }),
        kind: "gateway-list",
        lastCheckedAt: AT,
        lastDetectedAt: AT,
        reason: "declared 3 item(s), read 2",
        scope: listScope({ listId: "list-short" }),
        status: "open",
      },
    ]);
    expect(gapLifecycle({ file: folded.file })).toEqual([
      {
        condition: "pagination-incomplete",
        lastCheckedAt: AT,
        scope: listScope({ listId: "list-ok" }),
        status: "closed",
      },
      {
        condition: "pagination-incomplete",
        lastCheckedAt: AT,
        scope: listScope({ listId: "list-short" }),
        status: "open",
      },
    ]);
  });
});
