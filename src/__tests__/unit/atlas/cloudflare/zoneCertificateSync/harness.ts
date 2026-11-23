/*
 * The fixtures more than one `syncZoneCertificateKind` test file reads: the account, zone and instants a run is
 * stamped at, the kind scope its gaps hang off, and one case per declared certificate/SSL subtype naming where
 * it is read, what it serves and what an earlier run stored. The fake client lives beside it in
 * `servedClient.ts`, and the stored-file and view helpers in `zoneView.ts`. A plain module, not a `*.test.ts`,
 * so no test registers twice. It was split out when the zone certificate sync suite became one file per
 * behaviour.
 */
import type { CloudflareEntity } from "../../../../../atlas/cloudflare/model.js";
import {
  projectCloudflareCertificatePack,
  projectCloudflareClientCertificate,
  projectCloudflareCustomHostname,
  projectCloudflareKeylessCertificate,
  projectCloudflareOriginCaCertificate,
} from "../../../../../atlas/cloudflare/projection/zoneCertificate.js";
import {
  projectCloudflareAopHostnameCertificate,
  projectCloudflareAopSetting,
  projectCloudflareAopZoneCertificate,
} from "../../../../../atlas/cloudflare/projection/zoneCertificateAop.js";
import { projectCloudflareCustomCertificate } from "../../../../../atlas/cloudflare/projection/zoneCertificateCustom.js";
import {
  CLOUDFLARE_ZONE_CERTIFICATE_SUBTYPES,
  type CloudflareZoneCertificateSubtype,
} from "../../../../../atlas/cloudflare/projection/zoneCertificateDetail.js";
import {
  projectCloudflareUniversalSslSetting,
  projectCloudflareUniversalSslVerification,
} from "../../../../../atlas/cloudflare/projection/zoneCertificateUniversal.js";

export const AT = "2026-02-01T00:00:00.000Z";
export const STORED_AT = "2026-01-01T00:00:00.000Z";
export const ACCOUNT_ID: string = "a".repeat(32);
export const ZONE_ID: string = "z".repeat(32);
const ZONE_BASE = `/client/v4/zones/${ZONE_ID}`;
export const KIND_SCOPE: string = `zone/${ZONE_ID}/zone-certificate`;

/** What one subtype's endpoint serves: a paged list's items, or the enveloped `result` payload (an object or a bare array). */
export type Wire =
  | { readonly shape: "list"; readonly items: readonly unknown[] }
  | { readonly shape: "single"; readonly result: unknown };

/** Everything the tests need to know about one subtype: where it is read, what it serves and what was stored. */
export interface SubtypeCase {
  readonly subtype: CloudflareZoneCertificateSubtype;
  readonly path: string;
  readonly operation: string;
  readonly wire: Wire;
  readonly providerId: string;
  /** The one detail field whose value tells the stored entity from the freshly read one. */
  readonly markerField: string;
  readonly oldMarker: unknown;
  readonly newMarker: unknown;
  /** The entity an earlier run stored for this subtype in the given zone, at `STORED_AT`. */
  readonly stored: (args: { zoneId: string }) => CloudflareEntity;
}

/** One case per declared subtype; the `Record` key type makes a missing subtype a compile error. */
export const CASES: Record<CloudflareZoneCertificateSubtype, SubtypeCase> = {
  "aop-hostname-certificate": {
    markerField: "status",
    newMarker: "active",
    oldMarker: "pending",
    operation: "zone-certificate-aop-hostname-certificates-list",
    path: `${ZONE_BASE}/origin_tls_client_auth/hostnames/certificates`,
    providerId: "aop-hostname-certificate:aophc-1",
    stored: ({ zoneId }) =>
      projectCloudflareAopHostnameCertificate({
        accountId: ACCOUNT_ID,
        at: STORED_AT,
        raw: { id: "aophc-1", status: "pending" },
        zoneId,
      }),
    subtype: "aop-hostname-certificate",
    wire: { items: [{ id: "aophc-1", status: "active" }], shape: "list" },
  },
  "aop-setting": {
    markerField: "enabled",
    newMarker: true,
    oldMarker: false,
    operation: "zone-certificate-aop-settings-get",
    path: `${ZONE_BASE}/origin_tls_client_auth/settings`,
    providerId: "aop-setting",
    stored: ({ zoneId }) =>
      projectCloudflareAopSetting({ accountId: ACCOUNT_ID, at: STORED_AT, enabled: false, zoneId }),
    subtype: "aop-setting",
    wire: { result: { enabled: true }, shape: "single" },
  },
  "aop-zone-certificate": {
    markerField: "status",
    newMarker: "active",
    oldMarker: "pending",
    operation: "zone-certificate-aop-zone-certificates-list",
    path: `${ZONE_BASE}/origin_tls_client_auth`,
    providerId: "aop-zone-certificate:aop-1",
    stored: ({ zoneId }) =>
      projectCloudflareAopZoneCertificate({
        accountId: ACCOUNT_ID,
        at: STORED_AT,
        raw: { id: "aop-1", status: "pending" },
        zoneId,
      }),
    subtype: "aop-zone-certificate",
    wire: { items: [{ id: "aop-1", status: "active" }], shape: "list" },
  },
  "certificate-pack": {
    markerField: "status",
    newMarker: "active",
    oldMarker: "pending_validation",
    operation: "zone-certificate-certificate-packs-list",
    path: `${ZONE_BASE}/ssl/certificate_packs`,
    providerId: "certificate-pack:pack-1",
    stored: ({ zoneId }) =>
      projectCloudflareCertificatePack({
        accountId: ACCOUNT_ID,
        at: STORED_AT,
        raw: { id: "pack-1", status: "pending_validation" },
        zoneId,
      }),
    subtype: "certificate-pack",
    wire: { items: [{ id: "pack-1", status: "active" }], shape: "list" },
  },
  "client-certificate": {
    markerField: "status",
    newMarker: "active",
    oldMarker: "pending_reactivation",
    operation: "zone-certificate-client-certificates-list",
    path: `${ZONE_BASE}/client_certificates`,
    providerId: "client-certificate:cc-1",
    stored: ({ zoneId }) =>
      projectCloudflareClientCertificate({
        accountId: ACCOUNT_ID,
        at: STORED_AT,
        raw: { id: "cc-1", status: "pending_reactivation" },
        zoneId,
      }),
    subtype: "client-certificate",
    wire: { items: [{ id: "cc-1", status: "active" }], shape: "list" },
  },
  "custom-certificate": {
    markerField: "status",
    newMarker: "active",
    oldMarker: "expired",
    operation: "zone-certificate-custom-certificates-list",
    path: `${ZONE_BASE}/custom_certificates`,
    providerId: "custom-certificate:cert-1",
    stored: ({ zoneId }) =>
      projectCloudflareCustomCertificate({
        accountId: ACCOUNT_ID,
        at: STORED_AT,
        raw: { id: "cert-1", status: "expired" },
        zoneId,
      }),
    subtype: "custom-certificate",
    wire: { items: [{ id: "cert-1", status: "active" }], shape: "list" },
  },
  "custom-hostname": {
    markerField: "hostname",
    newMarker: "shop.customer.test",
    oldMarker: "old.customer.test",
    operation: "zone-certificate-custom-hostnames-list",
    path: `${ZONE_BASE}/custom_hostnames`,
    providerId: "custom-hostname:ch-1",
    stored: ({ zoneId }) =>
      projectCloudflareCustomHostname({
        accountId: ACCOUNT_ID,
        at: STORED_AT,
        raw: { hostname: "old.customer.test", id: "ch-1" },
        zoneId,
      }),
    subtype: "custom-hostname",
    wire: { items: [{ hostname: "shop.customer.test", id: "ch-1" }], shape: "list" },
  },
  "keyless-certificate": {
    markerField: "name",
    newMarker: "keyless-new",
    oldMarker: "keyless-old",
    operation: "zone-certificate-keyless-certificates-list",
    path: `${ZONE_BASE}/keyless_certificates`,
    providerId: "keyless-certificate:kl-1",
    stored: ({ zoneId }) =>
      projectCloudflareKeylessCertificate({
        accountId: ACCOUNT_ID,
        at: STORED_AT,
        raw: { id: "kl-1", name: "keyless-old" },
        zoneId,
      }),
    subtype: "keyless-certificate",
    wire: { items: [{ id: "kl-1", name: "keyless-new" }], shape: "list" },
  },
  "origin-ca-certificate": {
    markerField: "requestType",
    newMarker: "origin-ecc",
    oldMarker: "origin-rsa",
    operation: "zone-certificate-origin-ca-certificates-list",
    // Origin CA is the one surface not addressed under `/zones/<id>`: the zone rides as a query filter.
    path: "/client/v4/certificates",
    providerId: "origin-ca-certificate:ca-1",
    stored: ({ zoneId }) =>
      projectCloudflareOriginCaCertificate({
        accountId: ACCOUNT_ID,
        at: STORED_AT,
        raw: { id: "ca-1", request_type: "origin-rsa" },
        zoneId,
      }),
    subtype: "origin-ca-certificate",
    wire: { items: [{ id: "ca-1", request_type: "origin-ecc" }], shape: "list" },
  },
  "universal-ssl-setting": {
    markerField: "enabled",
    newMarker: true,
    oldMarker: false,
    operation: "zone-certificate-universal-ssl-settings-get",
    path: `${ZONE_BASE}/ssl/universal/settings`,
    providerId: "universal-ssl-setting",
    stored: ({ zoneId }) =>
      projectCloudflareUniversalSslSetting({
        accountId: ACCOUNT_ID,
        at: STORED_AT,
        setting: { enabled: false },
        zoneId,
      }),
    subtype: "universal-ssl-setting",
    wire: { result: { enabled: true }, shape: "single" },
  },
  "universal-ssl-verification": {
    markerField: "certificateStatus",
    newMarker: "active",
    oldMarker: "initializing",
    operation: "zone-certificate-universal-ssl-verification-get",
    path: `${ZONE_BASE}/ssl/verification`,
    providerId: "universal-ssl-verification:uuid-1",
    stored: ({ zoneId }) =>
      projectCloudflareUniversalSslVerification({
        accountId: ACCOUNT_ID,
        at: STORED_AT,
        raw: { cert_pack_uuid: "uuid-1", certificate_status: "initializing" },
        zoneId,
      }),
    subtype: "universal-ssl-verification",
    // Not a paginated collection: the SDK reads a bare array out of `result`.
    wire: { result: [{ cert_pack_uuid: "uuid-1", certificate_status: "active" }], shape: "single" },
  },
};

/** Every case, in the declared subtype order. */
export const ALL_CASES: readonly SubtypeCase[] = CLOUDFLARE_ZONE_CERTIFICATE_SUBTYPES.map((subtype) => CASES[subtype]);
