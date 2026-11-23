/**
 * The `account-filter-list` entity shape and its one-list projection — the account `rules.lists` API
 * (IP/hostname/redirect/ASN lists), never the deprecated zone Filters API. Items are a discriminated union
 * across four list kinds sharing only `id`/`created_on`/`modified_on`/`comment` as stable fields, so — same
 * "inherently open configuration" treatment `projection/access.ts` already uses — the type-specific payload
 * is kept as an open bucket rather than hand-modelling every variant. Item pagination is cursor-exhausted by
 * the SDK's own `CursorPaginationAfter`, the same trusted mechanism every other cursor-paginated reader in
 * this atlas already relies on, so unlike `gateway-list` there is no separate completeness check here.
 */
import { unsetFieldAsNull } from "#lib/absent.js";
import { isRecord } from "../../../lib/parsers.js";
import { cloudflareEntityId } from "../identity.js";
import type { CloudflareEntity } from "../model.js";

/** The raw shape `client.rules.lists.list()` returns for one list. */
export interface CloudflareRawAccountFilterList {
  readonly id: string;
  readonly name: string;
  readonly kind: string;
  readonly description?: string;
  readonly num_items: number;
  readonly num_referencing_filters: number;
}

/** The raw shape `client.rules.lists.items.list()` returns for one item — a union of four list-kind shapes,
 * kept open beyond `id`. */
export interface CloudflareRawAccountFilterListItem {
  readonly id: string;
  readonly comment?: string;
  readonly [key: string]: unknown;
}

/** One list item, as stored — everything but `id`/`comment` is the type-specific open config bucket. */
export interface CloudflareAccountFilterListItem {
  readonly id: string;
  readonly comment: string | null;
  readonly config: Readonly<Record<string, unknown>>;
}

/** The light-inventory detail this atlas stores for the `account-filter-list` kind. */
export interface CloudflareAccountFilterListDetail {
  readonly kind: "account-filter-list";
  readonly name: string;
  readonly listKind: string;
  readonly description: string | null;
  readonly declaredNumItems: number;
  readonly numReferencingFilters: number;
  readonly items: readonly CloudflareAccountFilterListItem[];
}

/**
 * Narrow a stored entity's `detail` into this domain's shape — the same pattern
 * `projection/accessPolicy.ts`'s `isCloudflareAccessPolicyDetail` established for a `z.unknown()` disk field.
 *
 * @param value the entity's `detail` field, read back from disk
 * @returns true when `value` is a genuine `CloudflareAccountFilterListDetail`
 */
export function isCloudflareAccountFilterListDetail(value: unknown): value is CloudflareAccountFilterListDetail {
  return (
    isRecord(value) &&
    value["kind"] === "account-filter-list" &&
    typeof value["name"] === "string" &&
    typeof value["listKind"] === "string" &&
    (value["description"] === null || typeof value["description"] === "string") &&
    typeof value["declaredNumItems"] === "number" &&
    typeof value["numReferencingFilters"] === "number" &&
    Array.isArray(value["items"])
  );
}

/**
 * Normalize one raw filter-list item into its stored shape.
 *
 * @param raw the raw item, from the per-list items read
 * @returns the item, as stored
 */
export function normalizeCloudflareAccountFilterListItem({
  raw,
}: {
  raw: CloudflareRawAccountFilterListItem;
}): CloudflareAccountFilterListItem {
  const { id, comment: _comment, ...config } = raw;
  return { comment: unsetFieldAsNull({ key: "comment", record: raw }), config, id };
}

/**
 * Project one account filter list's metadata and resolved items into an `account-filter-list` entity.
 *
 * @param raw the list's own metadata, from the inventory read
 * @param items this list's items, already normalized — either freshly read this run or preserved from what
 *   was already stored, when this run's own read for this one list failed
 * @param accountId the account this list was read under
 * @param at this run's ISO timestamp
 * @returns the projected entity
 */
export function projectCloudflareAccountFilterList({
  raw,
  items,
  accountId,
  at,
}: {
  raw: CloudflareRawAccountFilterList;
  items: readonly CloudflareAccountFilterListItem[];
  accountId: string;
  at: string;
}): CloudflareEntity {
  const detail: CloudflareAccountFilterListDetail = {
    declaredNumItems: raw.num_items,
    description: unsetFieldAsNull({ key: "description", record: raw }),
    items,
    kind: "account-filter-list",
    listKind: raw.kind,
    name: raw.name,
    numReferencingFilters: raw.num_referencing_filters,
  };
  return {
    detail,
    firstSeenAt: at,
    id: cloudflareEntityId({ components: { accountId, providerId: raw.id }, kind: "account-filter-list" }),
    kind: "account-filter-list",
    lastSeenAt: at,
    providerId: raw.id,
    scope: { accountId, parentId: null, zoneId: null },
    source: { channel: "rest-api", observedAt: at, operation: "account-filter-lists-fanout" },
    state: "observed",
  };
}
