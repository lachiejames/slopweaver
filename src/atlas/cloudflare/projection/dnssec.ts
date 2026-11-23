/**
 * Pure projection for the `dnssec` kind — the configured deep zone's DNSSEC status (`client.dns.dnssec.get`).
 * A flat singleton, deep-zone-scoped, keyed by the zone id itself, same convention
 * `projection/accountSetting.ts` established for an account-level singleton. None of the returned fields
 * (`publicKey`, `digest`, `ds`) are secret — they are DNSSEC public-key material Cloudflare's own docs say to
 * publish in the parent zone's DS record, the opposite of something to redact.
 */
import { unsetFieldAsNull } from "#lib/absent.js";
import { cloudflareZoneEntityId } from "../identity.js";
import type { CloudflareEntity } from "../model.js";

/** The detail this atlas stores for the `dnssec` kind. */
interface CloudflareDnssecDetail {
  readonly kind: "dnssec";
  readonly status: "active" | "pending" | "disabled" | "pending-disabled" | "error" | null;
  readonly algorithm: string | null;
  readonly digest: string | null;
  readonly digestAlgorithm: string | null;
  readonly digestType: string | null;
  readonly ds: string | null;
  readonly flags: number | null;
  readonly keyTag: number | null;
  readonly keyType: string | null;
  readonly publicKey: string | null;
  readonly dnssecMultiSigner: boolean | null;
  readonly dnssecPresigned: boolean | null;
  readonly dnssecUseNsec3: boolean | null;
  readonly modifiedOn: string | null;
}

/** The subset of the SDK's `DNSSEC` shape this projection reads. */
export interface CloudflareRawDnssec {
  readonly status?: "active" | "pending" | "disabled" | "pending-disabled" | "error";
  readonly algorithm?: string | null;
  readonly digest?: string | null;
  readonly digest_algorithm?: string | null;
  readonly digest_type?: string | null;
  readonly ds?: string | null;
  readonly flags?: number | null;
  readonly key_tag?: number | null;
  readonly key_type?: string | null;
  readonly public_key?: string | null;
  readonly dnssec_multi_signer?: boolean;
  readonly dnssec_presigned?: boolean;
  readonly dnssec_use_nsec3?: boolean;
  readonly modified_on?: string | null;
}

/**
 * Project the deep zone's DNSSEC status into a `dnssec` entity.
 *
 * @param raw the raw DNSSEC status
 * @param accountId the account the deep zone belongs to
 * @param zoneId the configured deep zone's id
 * @param at this run's ISO timestamp
 * @returns the projected entity
 */
export function projectCloudflareDnssec({
  raw,
  accountId,
  zoneId,
  at,
}: {
  raw: CloudflareRawDnssec;
  accountId: string;
  zoneId: string;
  at: string;
}): CloudflareEntity {
  const detail: CloudflareDnssecDetail = {
    algorithm: unsetFieldAsNull({ key: "algorithm", record: raw }),
    digest: unsetFieldAsNull({ key: "digest", record: raw }),
    digestAlgorithm: unsetFieldAsNull({ key: "digest_algorithm", record: raw }),
    digestType: unsetFieldAsNull({ key: "digest_type", record: raw }),
    dnssecMultiSigner: unsetFieldAsNull({ key: "dnssec_multi_signer", record: raw }),
    dnssecPresigned: unsetFieldAsNull({ key: "dnssec_presigned", record: raw }),
    dnssecUseNsec3: unsetFieldAsNull({ key: "dnssec_use_nsec3", record: raw }),
    ds: unsetFieldAsNull({ key: "ds", record: raw }),
    flags: unsetFieldAsNull({ key: "flags", record: raw }),
    keyTag: unsetFieldAsNull({ key: "key_tag", record: raw }),
    keyType: unsetFieldAsNull({ key: "key_type", record: raw }),
    kind: "dnssec",
    modifiedOn: unsetFieldAsNull({ key: "modified_on", record: raw }),
    publicKey: unsetFieldAsNull({ key: "public_key", record: raw }),
    status: unsetFieldAsNull({ key: "status", record: raw }),
  };
  return {
    detail,
    firstSeenAt: at,
    id: cloudflareZoneEntityId({ components: { accountId, providerId: zoneId }, kind: "dnssec", zoneId }),
    kind: "dnssec",
    lastSeenAt: at,
    providerId: zoneId,
    scope: { accountId, parentId: null, zoneId },
    source: { channel: "rest-api", observedAt: at, operation: "dnssec-get" },
    state: "observed",
  };
}
