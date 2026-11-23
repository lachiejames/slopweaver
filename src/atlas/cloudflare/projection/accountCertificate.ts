/**
 * The `account-certificate` entity shape and its one-certificate projection — account mTLS certificates
 * (`client.mtlsCertificates.list`) plus each certificate's active service associations
 * (`client.mtlsCertificates.associations.get`, a `SinglePage` read with no completeness signal to compare
 * against, same shape as `account-filter-list`'s items — no separate completeness check needed here either).
 *
 * The plan described this as "hostname associations"; the real SDK shape returns `{service, status}` pairs
 * (which Cloudflare service is using the certificate, and its deployment status there) — never a hostname.
 * Corrected here against what the SDK actually returns rather than the plan's original phrasing.
 *
 * The certificate's own PEM body (`certificates`) is deliberately NOT stored — it is the public CA
 * certificate a customer uploaded, never a private key (`private_key` is a create-only field, never
 * returned by any read), so this omission is about avoiding a large, low-value blob rather than secrecy.
 * The API already returns `serialNumber`/`signature` as stable identifying metadata, so no fingerprint needs
 * to be computed from the omitted body.
 */
import { unsetFieldAsNull } from "#lib/absent.js";
import { isRecord } from "../../../lib/parsers.js";
import { cloudflareEntityId } from "../identity.js";
import type { CloudflareEntity } from "../model.js";

/** The raw shape `client.mtlsCertificates.list()` returns for one certificate. */
export interface CloudflareRawAccountCertificate {
  readonly id: string;
  readonly ca?: boolean;
  readonly expires_on?: string;
  readonly issuer?: string;
  readonly name?: string;
  readonly serial_number?: string;
  readonly signature?: string;
  readonly type?: "custom" | "gateway_managed" | "access_managed";
  readonly uploaded_on?: string;
}

/** The raw shape `client.mtlsCertificates.associations.get()` returns for one association. */
export interface CloudflareRawAccountCertificateAssociation {
  readonly service?: string;
  readonly status?: string;
}

/** One certificate's service association, as stored. */
export interface CloudflareAccountCertificateAssociation {
  readonly service: string | null;
  readonly status: string | null;
}

/** The detail this atlas stores for the `account-certificate` kind. */
export interface CloudflareAccountCertificateDetail {
  readonly kind: "account-certificate";
  readonly name: string | null;
  readonly ca: boolean | null;
  readonly type: "custom" | "gateway_managed" | "access_managed" | null;
  readonly issuer: string | null;
  readonly serialNumber: string | null;
  readonly signature: string | null;
  readonly expiresOn: string | null;
  readonly uploadedOn: string | null;
  readonly associations: readonly CloudflareAccountCertificateAssociation[];
}

/**
 * Narrow a stored entity's `detail` into this domain's shape — the same pattern
 * `projection/accessPolicy.ts`'s `isCloudflareAccessPolicyDetail` established for a `z.unknown()` disk field.
 *
 * @param value the entity's `detail` field, read back from disk
 * @returns true when `value` is a genuine `CloudflareAccountCertificateDetail`
 */
export function isCloudflareAccountCertificateDetail(value: unknown): value is CloudflareAccountCertificateDetail {
  return isRecord(value) && value["kind"] === "account-certificate" && Array.isArray(value["associations"]);
}

/**
 * Normalize one raw association into its stored shape.
 *
 * @param raw the raw association, from the per-certificate associations read
 * @returns the association, as stored
 */
export function normalizeCloudflareAccountCertificateAssociation({
  raw,
}: {
  raw: CloudflareRawAccountCertificateAssociation;
}): CloudflareAccountCertificateAssociation {
  return {
    service: unsetFieldAsNull({ key: "service", record: raw }),
    status: unsetFieldAsNull({ key: "status", record: raw }),
  };
}

/**
 * Project one certificate's metadata and resolved associations into an `account-certificate` entity.
 *
 * @param raw the certificate's own metadata, from the inventory read
 * @param associations this certificate's associations, already normalized — either freshly read this run or
 *   preserved from what was already stored, when this run's own read for this one certificate failed
 * @param accountId the account this certificate was read under
 * @param at this run's ISO timestamp
 * @returns the projected entity
 */
export function projectCloudflareAccountCertificate({
  raw,
  associations,
  accountId,
  at,
}: {
  raw: CloudflareRawAccountCertificate;
  associations: readonly CloudflareAccountCertificateAssociation[];
  accountId: string;
  at: string;
}): CloudflareEntity {
  const detail: CloudflareAccountCertificateDetail = {
    associations,
    ca: unsetFieldAsNull({ key: "ca", record: raw }),
    expiresOn: unsetFieldAsNull({ key: "expires_on", record: raw }),
    issuer: unsetFieldAsNull({ key: "issuer", record: raw }),
    kind: "account-certificate",
    name: unsetFieldAsNull({ key: "name", record: raw }),
    serialNumber: unsetFieldAsNull({ key: "serial_number", record: raw }),
    signature: unsetFieldAsNull({ key: "signature", record: raw }),
    type: unsetFieldAsNull({ key: "type", record: raw }),
    uploadedOn: unsetFieldAsNull({ key: "uploaded_on", record: raw }),
  };
  return {
    detail,
    firstSeenAt: at,
    id: cloudflareEntityId({ components: { accountId, providerId: raw.id }, kind: "account-certificate" }),
    kind: "account-certificate",
    lastSeenAt: at,
    providerId: raw.id,
    scope: { accountId, parentId: null, zoneId: null },
    source: { channel: "rest-api", observedAt: at, operation: "account-certificates-fanout" },
    state: "observed",
  };
}
