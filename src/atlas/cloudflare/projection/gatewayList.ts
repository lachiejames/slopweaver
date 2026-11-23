/**
 * The `gateway-list` entity shape and its one-list projection.
 *
 * A live read-only probe (never committed) found the list endpoint's own `items` field always empty — a
 * list's items live only behind the per-list `items` sub-resource, which the SDK pages by `page` number.
 * For every list that probe read, the item count via that sub-resource matched the list's own declared `count` exactly, but nothing about the API guarantees that
 * for a larger list — `itemsComplete` records the comparison every run makes rather than assuming it.
 */
import { unsetFieldAsNull } from "#lib/absent.js";
import { isRecord } from "../../../lib/parsers.js";
import { cloudflareEntityId } from "../identity.js";
import type { CloudflareEntity } from "../model.js";

/** The raw shape `client.zeroTrust.gateway.lists.list()` returns for one list — never its own `items`. */
export interface CloudflareRawGatewayList {
  readonly id: string;
  readonly name?: string;
  readonly type?: string;
  readonly description?: string;
  readonly count?: number;
}

/** The raw shape `client.zeroTrust.gateway.lists.items.list()` returns for one item. */
export interface CloudflareRawGatewayListItem {
  readonly value?: string;
  readonly description?: string;
}

/** One list item, as stored. */
export interface CloudflareGatewayListItem {
  readonly value: string | null;
  readonly description: string | null;
}

/** The light-inventory detail this atlas stores for the `gateway-list` kind. */
export interface CloudflareGatewayListDetail {
  readonly kind: "gateway-list";
  readonly name: string | null;
  readonly type: string | null;
  readonly description: string | null;
  /** The list's own declared item count, from the inventory read — `null` when Cloudflare omitted it. */
  readonly declaredCount: number | null;
  readonly items: readonly CloudflareGatewayListItem[];
  /** Whether `items.length` matched `declaredCount` the run that produced them — see this file's header. */
  readonly itemsComplete: boolean;
}

/**
 * Narrow a stored entity's `detail` into this domain's shape — the same pattern
 * `projection/accessPolicy.ts`'s `isCloudflareAccessPolicyDetail` established for a `z.unknown()` disk field.
 *
 * @param value the entity's `detail` field, read back from disk
 * @returns true when `value` is a genuine `CloudflareGatewayListDetail`
 */
export function isCloudflareGatewayListDetail(value: unknown): value is CloudflareGatewayListDetail {
  return (
    isRecord(value) &&
    value["kind"] === "gateway-list" &&
    (value["name"] === null || typeof value["name"] === "string") &&
    (value["type"] === null || typeof value["type"] === "string") &&
    (value["description"] === null || typeof value["description"] === "string") &&
    (value["declaredCount"] === null || typeof value["declaredCount"] === "number") &&
    Array.isArray(value["items"]) &&
    typeof value["itemsComplete"] === "boolean"
  );
}

/**
 * Normalize one raw gateway-list item into its stored shape.
 *
 * @param raw the raw item, from the per-list items read
 * @returns the item, as stored
 */
export function normalizeCloudflareGatewayListItem({
  raw,
}: {
  raw: CloudflareRawGatewayListItem;
}): CloudflareGatewayListItem {
  return {
    description: unsetFieldAsNull({ key: "description", record: raw }),
    value: unsetFieldAsNull({ key: "value", record: raw }),
  };
}

/**
 * Project one gateway list's metadata and resolved items into a `gateway-list` entity.
 *
 * @param raw the list's own metadata, from the inventory read
 * @param items this list's items, already normalized — either freshly read this run or preserved from what
 *   was already stored, when this run's own read for this one list failed
 * @param accountId the account this list was read under
 * @param at this run's ISO timestamp
 * @returns the projected entity
 */
export function projectCloudflareGatewayList({
  raw,
  items,
  accountId,
  at,
}: {
  raw: CloudflareRawGatewayList;
  items: readonly CloudflareGatewayListItem[];
  accountId: string;
  at: string;
}): CloudflareEntity {
  const declaredCount = unsetFieldAsNull({ key: "count", record: raw });
  const detail: CloudflareGatewayListDetail = {
    declaredCount,
    description: unsetFieldAsNull({ key: "description", record: raw }),
    items,
    itemsComplete: declaredCount === null ? items.length === 0 : items.length === declaredCount,
    kind: "gateway-list",
    name: unsetFieldAsNull({ key: "name", record: raw }),
    type: unsetFieldAsNull({ key: "type", record: raw }),
  };
  return {
    detail,
    firstSeenAt: at,
    id: cloudflareEntityId({ components: { accountId, providerId: raw.id }, kind: "gateway-list" }),
    kind: "gateway-list",
    lastSeenAt: at,
    providerId: raw.id,
    scope: { accountId, parentId: null, zoneId: null },
    source: { channel: "rest-api", observedAt: at, operation: "gateway-lists-fanout" },
    state: "observed",
  };
}
