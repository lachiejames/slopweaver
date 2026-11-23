/**
 * Pure projection for the `dns-record` kind — every DNS record for the configured deep zone
 * (`client.dns.records.list`). Flat but deep-zone-scoped, not account-scoped — see `flatKindSpecs.ts`'s
 * `flatKindSpecs` for how a deep-zone-only flat kind differs from an account-scoped one.
 *
 * The real SDK response is a 20-variant discriminated union (A, AAAA, CNAME, MX, NS, TXT, CAA, SRV, and 12
 * more), sharing only `id`/`name`/`type`/`ttl`/`comment`/`content`/`proxied`/`tags`/`created_on`/
 * `modified_on`/`proxiable` as stable fields — the rest (e.g. MX's `priority`, SRV's `data` object) is kept
 * as an open `config` bucket, the same "inherently open configuration" treatment `projection/access.ts`
 * already uses for a comparably wide discriminated union. DNS records are published to the whole internet by
 * design, so no redaction applies here.
 */
import { unsetFieldAsNull } from "#lib/absent.js";
import { cloudflareZoneEntityId } from "../identity.js";
import type { CloudflareEntity } from "../model.js";

/** The subset of the SDK's `RecordResponse` union this projection reads as stable fields; every other field
 * (type-specific, e.g. MX's `priority`) is folded into the open `config` bucket. */
export interface CloudflareRawDnsRecord {
  readonly id: string;
  readonly name?: string;
  readonly type?: string;
  readonly ttl?: number;
  readonly comment?: string;
  readonly content?: string;
  readonly proxied?: boolean;
  readonly proxiable?: boolean;
  readonly tags?: readonly string[];
  readonly created_on?: string;
  readonly modified_on?: string;
  readonly [key: string]: unknown;
}

/** The detail this atlas stores for the `dns-record` kind. */
interface CloudflareDnsRecordDetail {
  readonly kind: "dns-record";
  readonly name: string | null;
  readonly type: string | null;
  readonly ttl: number | null;
  readonly comment: string | null;
  readonly content: string | null;
  readonly proxied: boolean | null;
  readonly proxiable: boolean | null;
  readonly tags: readonly string[];
  readonly createdOn: string | null;
  readonly modifiedOn: string | null;
  readonly config: Readonly<Record<string, unknown>>;
}

const STABLE_FIELDS = new Set([
  "id",
  "name",
  "type",
  "ttl",
  "comment",
  "content",
  "proxied",
  "proxiable",
  "tags",
  "created_on",
  "modified_on",
]);

/**
 * The tags a record carries — a record the provider sent with none (omitted or null) has an empty tag list.
 *
 * @param raw the raw record
 * @returns the record's own tag list (not a copy), or a fresh empty one when it carries none
 */
function dnsRecordTags({ raw }: { raw: CloudflareRawDnsRecord }): readonly string[] {
  const tags = unsetFieldAsNull({ key: "tags", record: raw });
  if (tags === null) {
    return [];
  }
  return tags;
}

/**
 * Project one raw DNS record into a `dns-record` entity.
 *
 * @param raw the raw record, already validated to carry a non-empty `id`
 * @param accountId the account this record's zone belongs to
 * @param zoneId the deep zone this record belongs to
 * @param at this run's ISO timestamp
 * @returns the projected entity
 */
export function projectCloudflareDnsRecord({
  raw,
  accountId,
  zoneId,
  at,
}: {
  raw: CloudflareRawDnsRecord;
  accountId: string;
  zoneId: string;
  at: string;
}): CloudflareEntity {
  const config: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!STABLE_FIELDS.has(key)) {
      config[key] = value;
    }
  }
  const detail: CloudflareDnsRecordDetail = {
    comment: unsetFieldAsNull({ key: "comment", record: raw }),
    config,
    content: unsetFieldAsNull({ key: "content", record: raw }),
    createdOn: unsetFieldAsNull({ key: "created_on", record: raw }),
    kind: "dns-record",
    modifiedOn: unsetFieldAsNull({ key: "modified_on", record: raw }),
    name: unsetFieldAsNull({ key: "name", record: raw }),
    proxiable: unsetFieldAsNull({ key: "proxiable", record: raw }),
    proxied: unsetFieldAsNull({ key: "proxied", record: raw }),
    tags: dnsRecordTags({ raw }),
    ttl: unsetFieldAsNull({ key: "ttl", record: raw }),
    type: unsetFieldAsNull({ key: "type", record: raw }),
  };
  return {
    detail,
    firstSeenAt: at,
    id: cloudflareZoneEntityId({ components: { accountId, providerId: raw.id }, kind: "dns-record", zoneId }),
    kind: "dns-record",
    lastSeenAt: at,
    providerId: raw.id,
    scope: { accountId, parentId: null, zoneId },
    source: { channel: "rest-api", observedAt: at, operation: "dns-records-list" },
    state: "observed",
  };
}
