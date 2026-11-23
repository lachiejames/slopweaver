/**
 * The Authenticated Origin Pull third of the `zone-certificate` projection — the zone-wide AOP setting, the
 * per-zone AOP certificates and the per-hostname AOP certificates, cut out of `zoneCertificate.ts` because
 * they are the one sub-family that shares a name and a security note: the zone-certificate list is one of the
 * two surfaces that can return PRIVATE KEY material in an ordinary read, and every open bucket here goes
 * through the parent's `configBucket`, never a local copy. The subtype list and the redaction live in the
 * parent, the detail union in `zoneCertificateDetail.ts`; this file only projects.
 */
import { cloudflareZoneEntityId } from "../identity.js";
import type { CloudflareEntity } from "../model.js";
import { configBucket } from "./zoneCertificate.js";
import type { CloudflareZoneCertificateDetail } from "./zoneCertificateDetail.js";

/**
 * Project the zone's Authenticated Origin Pull setting into a `zone-certificate` entity — a singleton,
 * always the single `providerId` `"aop-setting"`.
 *
 * @param enabled whether AOP is enabled for the zone, or `undefined` if the SDK omitted it (stored as `null`)
 * @param accountId the selected account id
 * @param zoneId the configured deep zone id
 * @param at this run's ISO timestamp
 * @returns the projected entity
 */
export function projectCloudflareAopSetting({
  enabled = null,
  accountId,
  zoneId,
  at,
}: {
  enabled: boolean | null | undefined;
  accountId: string;
  zoneId: string;
  at: string;
}): CloudflareEntity {
  const providerId = "aop-setting";
  const detail: CloudflareZoneCertificateDetail = {
    enabled,
    kind: "zone-certificate",
    subtype: "aop-setting",
  };
  return {
    detail,
    firstSeenAt: at,
    id: cloudflareZoneEntityId({ components: { accountId, providerId }, kind: "zone-certificate", zoneId }),
    kind: "zone-certificate",
    lastSeenAt: at,
    providerId,
    scope: { accountId, parentId: null, zoneId },
    source: { channel: "rest-api", observedAt: at, operation: "zone-certificate-aop-settings-get" },
    state: "observed",
  };
}

/** The raw shape `client.originTLSClientAuth.zoneCertificates.list()` returns for one certificate —
 * **may include a real `private_key` field**, always redacted by `configBucket`. */
export interface CloudflareRawAopZoneCertificate {
  readonly id: string;
  readonly status?: string;
  readonly enabled?: boolean;
  readonly expires_on?: string;
  readonly issuer?: string;
  readonly [key: string]: unknown;
}

/**
 * Project one raw Authenticated Origin Pull zone certificate into a `zone-certificate` entity. Its raw
 * response may carry a `private_key` field — always redacted, never stored, by `configBucket`.
 *
 * @param raw the raw certificate, already validated to carry a non-empty `id`
 * @param accountId the selected account id
 * @param zoneId the configured deep zone id
 * @param at this run's ISO timestamp
 * @returns the projected entity
 */
export function projectCloudflareAopZoneCertificate({
  raw,
  accountId,
  zoneId,
  at,
}: {
  raw: CloudflareRawAopZoneCertificate;
  accountId: string;
  zoneId: string;
  at: string;
}): CloudflareEntity {
  const { id, status = null, enabled = null, expires_on = null, issuer = null, ...rest } = raw;
  const providerId = `aop-zone-certificate:${id}`;
  const detail: CloudflareZoneCertificateDetail = {
    config: configBucket({ value: rest }),
    enabled,
    expiresOn: expires_on,
    issuer,
    kind: "zone-certificate",
    status,
    subtype: "aop-zone-certificate",
  };
  return {
    detail,
    firstSeenAt: at,
    id: cloudflareZoneEntityId({ components: { accountId, providerId }, kind: "zone-certificate", zoneId }),
    kind: "zone-certificate",
    lastSeenAt: at,
    providerId,
    scope: { accountId, parentId: null, zoneId },
    source: { channel: "rest-api", observedAt: at, operation: "zone-certificate-aop-zone-certificates-list" },
    state: "observed",
  };
}

/** The raw shape `client.originTLSClientAuth.hostnameCertificates.list()` returns for one certificate. */
export interface CloudflareRawAopHostnameCertificate {
  readonly id: string;
  readonly status?: string;
  readonly expires_on?: string;
  readonly issuer?: string;
  readonly [key: string]: unknown;
}

/**
 * Project one raw Authenticated Origin Pull hostname certificate into a `zone-certificate` entity.
 *
 * @param raw the raw certificate, already validated to carry a non-empty `id`
 * @param accountId the selected account id
 * @param zoneId the configured deep zone id
 * @param at this run's ISO timestamp
 * @returns the projected entity
 */
export function projectCloudflareAopHostnameCertificate({
  raw,
  accountId,
  zoneId,
  at,
}: {
  raw: CloudflareRawAopHostnameCertificate;
  accountId: string;
  zoneId: string;
  at: string;
}): CloudflareEntity {
  const { id, status = null, expires_on = null, issuer = null, ...rest } = raw;
  const providerId = `aop-hostname-certificate:${id}`;
  const detail: CloudflareZoneCertificateDetail = {
    config: configBucket({ value: rest }),
    expiresOn: expires_on,
    issuer,
    kind: "zone-certificate",
    status,
    subtype: "aop-hostname-certificate",
  };
  return {
    detail,
    firstSeenAt: at,
    id: cloudflareZoneEntityId({ components: { accountId, providerId }, kind: "zone-certificate", zoneId }),
    kind: "zone-certificate",
    lastSeenAt: at,
    providerId,
    scope: { accountId, parentId: null, zoneId },
    source: { channel: "rest-api", observedAt: at, operation: "zone-certificate-aop-hostname-certificates-list" },
    state: "observed",
  };
}
