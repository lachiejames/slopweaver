/**
 * The Universal SSL third of the `zone-certificate` projection — the zone's Universal SSL setting and its
 * verification entries, cut out of `zoneCertificate.ts` for the same file-size reason
 * `zoneCertificateAop.ts` was. The subtype list and the redaction live in the parent, the detail union in
 * `zoneCertificateDetail.ts`; every open bucket here goes through the parent's `configBucket`, never a local
 * copy.
 *
 * A verification entry has no `id`, so its `cert_pack_uuid` is its provider identity. The reader refuses an
 * entry without one rather than keying it on its position in the response, which is not a provider identity
 * and moves whenever the response order does. It refuses one without the SDK-required `certificate_status` too.
 */
import { unsetFieldAsNull } from "#lib/absent.js";
import { cloudflareZoneEntityId } from "../identity.js";
import type { CloudflareEntity } from "../model.js";
import { configBucket } from "./zoneCertificate.js";
import type { CloudflareZoneCertificateDetail } from "./zoneCertificateDetail.js";

/**
 * Project the zone's Universal SSL setting into a `zone-certificate` entity — a singleton, always the
 * single `providerId` `"universal-ssl-setting"`.
 *
 * @param setting the raw `client.ssl.universal.settings.get()` response; an `enabled` flag the SDK omitted
 *   is stored as `null`
 * @param accountId the selected account id
 * @param zoneId the configured deep zone id
 * @param at this run's ISO timestamp
 * @returns the projected entity
 */
export function projectCloudflareUniversalSslSetting({
  setting,
  accountId,
  zoneId,
  at,
}: {
  setting: { readonly enabled?: boolean };
  accountId: string;
  zoneId: string;
  at: string;
}): CloudflareEntity {
  const providerId = "universal-ssl-setting";
  const detail: CloudflareZoneCertificateDetail = {
    enabled: unsetFieldAsNull({ record: setting, key: "enabled" }),
    kind: "zone-certificate",
    subtype: "universal-ssl-setting",
  };
  return {
    detail,
    firstSeenAt: at,
    id: cloudflareZoneEntityId({ components: { accountId, providerId }, kind: "zone-certificate", zoneId }),
    kind: "zone-certificate",
    lastSeenAt: at,
    providerId,
    scope: { accountId, parentId: null, zoneId },
    source: { channel: "rest-api", observedAt: at, operation: "zone-certificate-universal-ssl-settings-get" },
    state: "observed",
  };
}

/** The raw shape `client.ssl.verification.get()` returns for one entry, once the reader has confirmed it
 * carries the non-empty `cert_pack_uuid` that is its only stable identity and the `certificate_status` the
 * SDK declares required. */
export interface CloudflareRawUniversalSslVerification {
  readonly certificate_status: string;
  readonly cert_pack_uuid: string;
  readonly verification_status?: boolean;
  readonly verification_type?: string;
  readonly [key: string]: unknown;
}

/**
 * Project one raw Universal SSL verification entry into a `zone-certificate` entity.
 *
 * @param raw the raw verification entry, already validated to carry a non-empty `cert_pack_uuid` and a
 *   `certificate_status`
 * @param accountId the selected account id
 * @param zoneId the configured deep zone id
 * @param at this run's ISO timestamp
 * @returns the projected entity
 */
export function projectCloudflareUniversalSslVerification({
  raw,
  accountId,
  zoneId,
  at,
}: {
  raw: CloudflareRawUniversalSslVerification;
  accountId: string;
  zoneId: string;
  at: string;
}): CloudflareEntity {
  const {
    certificate_status,
    cert_pack_uuid,
    verification_status: _verificationStatus,
    verification_type: _verificationType,
    ...rest
  } = raw;
  const providerId = `universal-ssl-verification:${cert_pack_uuid}`;
  const detail: CloudflareZoneCertificateDetail = {
    certificateStatus: certificate_status,
    certPackUuid: cert_pack_uuid,
    config: configBucket({ value: rest }),
    kind: "zone-certificate",
    subtype: "universal-ssl-verification",
    verificationStatus: unsetFieldAsNull({ record: raw, key: "verification_status" }),
    verificationType: unsetFieldAsNull({ record: raw, key: "verification_type" }),
  };
  return {
    detail,
    firstSeenAt: at,
    id: cloudflareZoneEntityId({ components: { accountId, providerId }, kind: "zone-certificate", zoneId }),
    kind: "zone-certificate",
    lastSeenAt: at,
    providerId,
    scope: { accountId, parentId: null, zoneId },
    source: { channel: "rest-api", observedAt: at, operation: "zone-certificate-universal-ssl-verification-get" },
    state: "observed",
  };
}
