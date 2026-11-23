/**
 * Pure projection for the `zone-certificate` kind — the independent, deep-zone-scoped SSL/certificate
 * surfaces `zoneCertificateDetail.ts`'s `CLOUDFLARE_ZONE_CERTIFICATE_SUBTYPES` names, folded into one kind, each entity tagged by which surface produced it (`subtype`), the same
 * "N independent collections, per-subtype partial credit" shape `projection/firewallService.ts` established.
 *
 * **Security-critical**: two of those surfaces can return actual PRIVATE KEY material in an ordinary read
 * response — Authenticated Origin Pull's zone-certificate list (`private_key`) and a custom hostname's
 * embedded `ssl.custom_key`. Every subtype's open `config` bucket is passed through `redactSecretKeyFields`,
 * which recursively nulls out any field literally named `private_key`/`custom_key` at any nesting depth,
 * regardless of which subtype it came from — never opt-in per subtype, since an unexpected field in a future
 * SDK response should still be caught. Every PEM certificate body / CSR is ALSO omitted, matching PR11's
 * `account-certificate` precedent ("a large, low-value blob rather than secrecy") — this atlas already never
 * stores a full certificate body anywhere else, so this is consistency, not a new policy.
 *
 * Two real surfaces this atlas does NOT read, both deliberate exclusions:
 * - Authenticated Origin Pull's PER-HOSTNAME association (`client.originTLSClientAuth.hostnames.get`) has no
 *   list-all endpoint — Cloudflare requires already knowing a hostname string to look it up. There is no
 *   authoritative enumeration of "every hostname with an AOP override" to fan out over; guessing from DNS
 *   records or custom hostnames would be an arbitrary, incomplete substitute, the same reasoning PR10 used to
 *   drop Audit Log's originally-proposed per-resource history fan-out.
 * - Certificate packs' `quota` sub-resource is a write-eligibility counter (how many more packs may be
 *   ordered), not descriptive state of an existing resource — omitted as out of scope for an inventory atlas.
 *
 * Three sub-families project in sibling files: Authenticated Origin Pull in `zoneCertificateAop.ts`, the
 * Universal SSL setting and verification entries in `zoneCertificateUniversal.ts`, and custom certificates in
 * `zoneCertificateCustom.ts`. The detail union every projector builds, and the subtype list it is keyed by,
 * live in `zoneCertificateDetail.ts`.
 */
import { unsetFieldAsNull } from "#lib/absent.js";
import { isRecord } from "../../../lib/parsers.js";
import { cloudflareZoneEntityId } from "../identity.js";
import type { CloudflareEntity } from "../model.js";
import type { CloudflareZoneCertificateDetail } from "./zoneCertificateDetail.js";

/**
 * Recursively null out any field literally named `private_key` or `custom_key`, at any nesting depth,
 * anywhere in a raw config bucket — see this file's header. Applied unconditionally to every subtype's
 * open bucket, never opt-in.
 *
 * @param value the raw value to sanitise
 * @returns the same shape with every private-key-shaped field redacted
 */
function redactSecretKeyFields({ value }: { value: unknown }): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => redactSecretKeyFields({ value: item }));
  }
  if (isRecord(value)) {
    return redactSecretKeyFieldsInRecord({ value });
  }
  return value;
}

/**
 * The record-shaped branch of {@link redactSecretKeyFields}, typed so a caller that already knows it holds a
 * record never needs an unsafe narrowing cast on the return value.
 *
 * @param value the record to sanitise
 * @returns the same record with every private-key-shaped field redacted
 */
function redactSecretKeyFieldsInRecord({
  value,
}: {
  value: Readonly<Record<string, unknown>>;
}): Readonly<Record<string, unknown>> {
  return Object.fromEntries(
    Object.entries(value).map(([key, entryValue]) => [
      key,
      key === "private_key" || key === "custom_key" ? null : redactSecretKeyFields({ value: entryValue }),
    ]),
  );
}

/**
 * Build an open config bucket from a raw object's remaining fields (after named stable fields were already
 * extracted), stripping any PEM certificate/CSR body and any private-key-shaped field.
 *
 * @param value the raw remaining fields
 * @returns the same bucket, redacted
 */
export function configBucket({
  value,
}: {
  value: Readonly<Record<string, unknown>>;
}): Readonly<Record<string, unknown>> {
  const { certificate: _certificate, csr: _csr, ...rest } = value;
  return redactSecretKeyFieldsInRecord({ value: rest });
}

/** The raw shape `client.ssl.certificatePacks.list()` returns for one pack. */
export interface CloudflareRawCertificatePack {
  readonly id: string;
  readonly status?: string;
  readonly type?: string;
  readonly hosts?: readonly string[];
  readonly validity_days?: number;
  readonly [key: string]: unknown;
}

/**
 * Project one raw certificate pack into a `zone-certificate` entity.
 *
 * @param raw the raw pack, already validated to carry a non-empty `id`
 * @param accountId the selected account id
 * @param zoneId the configured deep zone id
 * @param at this run's ISO timestamp
 * @returns the projected entity
 */
export function projectCloudflareCertificatePack({
  raw,
  accountId,
  zoneId,
  at,
}: {
  raw: CloudflareRawCertificatePack;
  accountId: string;
  zoneId: string;
  at: string;
}): CloudflareEntity {
  const { id, status, type, hosts, validity_days: _validityDays, ...rest } = raw;
  const providerId = `certificate-pack:${id}`;
  const detail: CloudflareZoneCertificateDetail = {
    config: configBucket({ value: rest }),
    hosts: hosts ?? [],
    kind: "zone-certificate",
    status: status ?? null,
    subtype: "certificate-pack",
    type: type ?? null,
    validityDays: unsetFieldAsNull({ record: raw, key: "validity_days" }),
  };
  return {
    detail,
    firstSeenAt: at,
    id: cloudflareZoneEntityId({ components: { accountId, providerId }, kind: "zone-certificate", zoneId }),
    kind: "zone-certificate",
    lastSeenAt: at,
    providerId,
    scope: { accountId, parentId: null, zoneId },
    source: { channel: "rest-api", observedAt: at, operation: "zone-certificate-certificate-packs-list" },
    state: "observed",
  };
}

/** The raw shape `client.clientCertificates.list()` returns for one certificate. */
export interface CloudflareRawClientCertificate {
  readonly id: string;
  readonly status?: string;
  readonly common_name?: string;
  readonly expires_on?: string;
  readonly issued_on?: string;
  readonly [key: string]: unknown;
}

/**
 * Project one raw zone client certificate (API Shield mTLS) into a `zone-certificate` entity.
 *
 * @param raw the raw certificate, already validated to carry a non-empty `id`
 * @param accountId the selected account id
 * @param zoneId the configured deep zone id
 * @param at this run's ISO timestamp
 * @returns the projected entity
 */
export function projectCloudflareClientCertificate({
  raw,
  accountId,
  zoneId,
  at,
}: {
  raw: CloudflareRawClientCertificate;
  accountId: string;
  zoneId: string;
  at: string;
}): CloudflareEntity {
  const { id, status: _status, common_name: _commonName, expires_on: _expiresOn, issued_on: _issuedOn, ...rest } = raw;
  const providerId = `client-certificate:${id}`;
  const detail: CloudflareZoneCertificateDetail = {
    commonName: unsetFieldAsNull({ record: raw, key: "common_name" }),
    config: configBucket({ value: rest }),
    expiresOn: unsetFieldAsNull({ record: raw, key: "expires_on" }),
    issuedOn: unsetFieldAsNull({ record: raw, key: "issued_on" }),
    kind: "zone-certificate",
    status: unsetFieldAsNull({ record: raw, key: "status" }),
    subtype: "client-certificate",
  };
  return {
    detail,
    firstSeenAt: at,
    id: cloudflareZoneEntityId({ components: { accountId, providerId }, kind: "zone-certificate", zoneId }),
    kind: "zone-certificate",
    lastSeenAt: at,
    providerId,
    scope: { accountId, parentId: null, zoneId },
    source: { channel: "rest-api", observedAt: at, operation: "zone-certificate-client-certificates-list" },
    state: "observed",
  };
}

/** The raw shape `client.keylessCertificates.list()` returns for one certificate. */
export interface CloudflareRawKeylessCertificate {
  readonly id: string;
  readonly enabled?: boolean;
  readonly host?: string;
  readonly port?: number;
  readonly status?: string;
  readonly name?: string;
  readonly [key: string]: unknown;
}

/**
 * Project one raw keyless SSL certificate into a `zone-certificate` entity.
 *
 * @param raw the raw certificate, already validated to carry a non-empty `id`
 * @param accountId the selected account id
 * @param zoneId the configured deep zone id
 * @param at this run's ISO timestamp
 * @returns the projected entity
 */
export function projectCloudflareKeylessCertificate({
  raw,
  accountId,
  zoneId,
  at,
}: {
  raw: CloudflareRawKeylessCertificate;
  accountId: string;
  zoneId: string;
  at: string;
}): CloudflareEntity {
  const { id, enabled, host, port, status, name, ...rest } = raw;
  const providerId = `keyless-certificate:${id}`;
  const detail: CloudflareZoneCertificateDetail = {
    config: configBucket({ value: rest }),
    enabled: enabled ?? null,
    host: host ?? null,
    kind: "zone-certificate",
    name: name ?? null,
    port: port ?? null,
    status: status ?? null,
    subtype: "keyless-certificate",
  };
  return {
    detail,
    firstSeenAt: at,
    id: cloudflareZoneEntityId({ components: { accountId, providerId }, kind: "zone-certificate", zoneId }),
    kind: "zone-certificate",
    lastSeenAt: at,
    providerId,
    scope: { accountId, parentId: null, zoneId },
    source: { channel: "rest-api", observedAt: at, operation: "zone-certificate-keyless-certificates-list" },
    state: "observed",
  };
}

/** The raw shape `client.originCACertificates.list()` returns for one certificate. */
export interface CloudflareRawOriginCaCertificate {
  readonly id: string;
  readonly request_type?: string;
  readonly requested_validity?: number;
  readonly expires_on?: string;
  readonly hostnames?: readonly string[];
  readonly [key: string]: unknown;
}

/**
 * Project one raw Origin CA certificate into a `zone-certificate` entity.
 *
 * @param raw the raw certificate, already validated to carry a non-empty `id`
 * @param accountId the selected account id
 * @param zoneId the configured deep zone id
 * @param at this run's ISO timestamp
 * @returns the projected entity
 */
export function projectCloudflareOriginCaCertificate({
  raw,
  accountId,
  zoneId,
  at,
}: {
  raw: CloudflareRawOriginCaCertificate;
  accountId: string;
  zoneId: string;
  at: string;
}): CloudflareEntity {
  const { id, request_type, requested_validity, expires_on: _expiresOn, hostnames, ...rest } = raw;
  const providerId = `origin-ca-certificate:${id}`;
  const detail: CloudflareZoneCertificateDetail = {
    config: configBucket({ value: rest }),
    expiresOn: unsetFieldAsNull({ record: raw, key: "expires_on" }),
    hostnames: hostnames ?? [],
    kind: "zone-certificate",
    requestedValidity: requested_validity ?? null,
    requestType: request_type ?? null,
    subtype: "origin-ca-certificate",
  };
  return {
    detail,
    firstSeenAt: at,
    id: cloudflareZoneEntityId({ components: { accountId, providerId }, kind: "zone-certificate", zoneId }),
    kind: "zone-certificate",
    lastSeenAt: at,
    providerId,
    scope: { accountId, parentId: null, zoneId },
    source: { channel: "rest-api", observedAt: at, operation: "zone-certificate-origin-ca-certificates-list" },
    state: "observed",
  };
}

/** The raw shape `client.customHostnames.list()` returns for one hostname. */
export interface CloudflareRawCustomHostname {
  readonly id: string;
  readonly hostname?: string;
  readonly status?: string;
  readonly ssl?: { readonly id?: string; readonly status?: string; readonly [key: string]: unknown } | undefined;
  readonly ownership_verification?: { readonly type?: string };
  readonly [key: string]: unknown;
}

/**
 * Project one raw custom hostname into a `zone-certificate` entity. Its embedded `ssl` object may carry a
 * `custom_key` field — always redacted, never stored, by `configBucket`.
 *
 * @param raw the raw hostname, already validated to carry a non-empty `id`
 * @param accountId the selected account id
 * @param zoneId the configured deep zone id
 * @param at this run's ISO timestamp
 * @returns the projected entity
 */
export function projectCloudflareCustomHostname({
  raw,
  accountId,
  zoneId,
  at,
}: {
  raw: CloudflareRawCustomHostname;
  accountId: string;
  zoneId: string;
  at: string;
}): CloudflareEntity {
  const { id, hostname, status: _status, ssl: _ssl, ownership_verification: _ownershipVerification, ...rest } = raw;
  const providerId = `custom-hostname:${id}`;
  const detail: CloudflareZoneCertificateDetail = {
    config: configBucket({ value: { ...rest, ssl: unsetFieldAsNull({ record: raw, key: "ssl" }) } }),
    hostname: hostname ?? null,
    kind: "zone-certificate",
    ownershipVerificationType: unsetFieldAsNull({ record: raw.ownership_verification, key: "type" }),
    sslId: unsetFieldAsNull({ record: raw.ssl, key: "id" }),
    sslStatus: unsetFieldAsNull({ record: raw.ssl, key: "status" }),
    status: unsetFieldAsNull({ record: raw, key: "status" }),
    subtype: "custom-hostname",
  };
  return {
    detail,
    firstSeenAt: at,
    id: cloudflareZoneEntityId({ components: { accountId, providerId }, kind: "zone-certificate", zoneId }),
    kind: "zone-certificate",
    lastSeenAt: at,
    providerId,
    scope: { accountId, parentId: null, zoneId },
    source: { channel: "rest-api", observedAt: at, operation: "zone-certificate-custom-hostnames-list" },
    state: "observed",
  };
}
