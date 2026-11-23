/**
 * Pure projection for the `page-rule` kind — the configured deep zone's Page Rules (`client.pageRules.list`).
 * A plain array in one response, no pagination at all (confirmed against the SDK's own compiled source: a
 * bare `.get()` unwrap, never `getAPIList`). `actions` (a ~30-variant discriminated union — cache settings,
 * `forwarding_url` redirects, security toggles) and `targets` (URL-match constraints) are kept as open
 * buckets rather than modelled per variant, the same "inherently open configuration" treatment
 * `projection/access.ts` already uses — neither carries secret material (a `forwarding_url`'s destination is
 * a plain redirect URL).
 */
import { unsetFieldAsNull } from "#lib/absent.js";
import { isRecord } from "../../../lib/parsers.js";
import { cloudflareZoneEntityId } from "../identity.js";
import type { CloudflareEntity } from "../model.js";

/** The detail this atlas stores for the `page-rule` kind. */
interface CloudflarePageRuleDetail {
  readonly kind: "page-rule";
  readonly priority: number | null;
  readonly status: "active" | "disabled" | null;
  readonly createdOn: string | null;
  readonly modifiedOn: string | null;
  readonly actions: readonly Readonly<Record<string, unknown>>[];
  readonly targets: readonly Readonly<Record<string, unknown>>[];
}

/** The raw shape `client.pageRules.list()` returns for one Page Rule. */
export interface CloudflareRawPageRule {
  readonly id: string;
  readonly priority?: number;
  readonly status?: "active" | "disabled";
  readonly created_on?: string;
  readonly modified_on?: string;
  readonly actions?: readonly unknown[];
  readonly targets?: readonly unknown[];
}

/** Keep an array's own record-shaped entries as plain-object copies; drop anything else (never expected in
 * practice, but the SDK's own action/target union types offer no runtime guarantee). */
function normalizedRecords({ items }: { items: readonly unknown[] }): readonly Readonly<Record<string, unknown>>[] {
  return items.filter(isRecord).map((item) => ({ ...item }));
}

/** A Page Rule that omitted `actions` has none to store, so it stores an empty list. */
function pageRuleActionRecords({ raw }: { raw: CloudflareRawPageRule }): readonly Readonly<Record<string, unknown>>[] {
  const actions = unsetFieldAsNull({ key: "actions", record: raw });
  if (actions === null) {
    return [];
  }
  return normalizedRecords({ items: actions });
}

/** A Page Rule that omitted `targets` has no URL constraints to store, so it stores an empty list. */
function pageRuleTargetRecords({ raw }: { raw: CloudflareRawPageRule }): readonly Readonly<Record<string, unknown>>[] {
  const targets = unsetFieldAsNull({ key: "targets", record: raw });
  if (targets === null) {
    return [];
  }
  return normalizedRecords({ items: targets });
}

/**
 * Project one raw Page Rule into a `page-rule` entity.
 *
 * @param raw the raw Page Rule, already validated to carry a non-empty `id`
 * @param accountId the account the deep zone belongs to
 * @param zoneId the configured deep zone's id
 * @param at this run's ISO timestamp
 * @returns the projected entity
 */
export function projectCloudflarePageRule({
  raw,
  accountId,
  zoneId,
  at,
}: {
  raw: CloudflareRawPageRule;
  accountId: string;
  zoneId: string;
  at: string;
}): CloudflareEntity {
  const detail: CloudflarePageRuleDetail = {
    actions: pageRuleActionRecords({ raw }),
    createdOn: unsetFieldAsNull({ key: "created_on", record: raw }),
    kind: "page-rule",
    modifiedOn: unsetFieldAsNull({ key: "modified_on", record: raw }),
    priority: unsetFieldAsNull({ key: "priority", record: raw }),
    status: unsetFieldAsNull({ key: "status", record: raw }),
    targets: pageRuleTargetRecords({ raw }),
  };
  return {
    detail,
    firstSeenAt: at,
    id: cloudflareZoneEntityId({ components: { accountId, providerId: raw.id }, kind: "page-rule", zoneId }),
    kind: "page-rule",
    lastSeenAt: at,
    providerId: raw.id,
    scope: { accountId, parentId: null, zoneId },
    source: { channel: "rest-api", observedAt: at, operation: "page-rules-list" },
    state: "observed",
  };
}
