/**
 * The custom-certificate subtype of the `zone-certificate` projection — the certificates a zone uploads
 * itself, cut out of `zoneCertificate.ts` for the file-size cap. Its open bucket goes through the parent's
 * `configBucket`, never a local copy, so the parent's redaction covers it.
 */
import { unsetFieldAsNull } from "#lib/absent.js";
import { cloudflareZoneEntityId } from "../identity.js";
import type { CloudflareEntity } from "../model.js";
import { configBucket } from "./zoneCertificate.js";
import type { CloudflareZoneCertificateDetail } from "./zoneCertificateDetail.js";

/** The raw shape `client.customCertificates.list()` returns for one certificate. */
interface CloudflareRawCustomCertificate {
  readonly id: string;
  readonly status?: string;
  readonly hosts?: readonly string[];
  readonly issuer?: string;
  readonly expires_on?: string;
  readonly priority?: number;
  readonly [key: string]: unknown;
}

/**
 * The hostnames a custom certificate covers; a certificate that publishes none (the field absent or null)
 * covers no hostname, so it reads as an empty list. A published list is carried as-is, never copied.
 *
 * @param raw the raw custom certificate
 * @returns the published hostnames, or an empty list when none were published
 */
function customCertificateHostsOrNone({ raw }: { raw: CloudflareRawCustomCertificate }): readonly string[] {
  const hosts = unsetFieldAsNull({ record: raw, key: "hosts" });
  if (hosts === null) {
    return [];
  }
  return hosts;
}

/**
 * Project one raw custom certificate into a `zone-certificate` entity.
 *
 * @param raw the raw certificate, already validated to carry a non-empty `id`
 * @param accountId the selected account id
 * @param zoneId the configured deep zone id
 * @param at this run's ISO timestamp
 * @returns the projected entity
 */
export function projectCloudflareCustomCertificate({
  raw,
  accountId,
  zoneId,
  at,
}: {
  raw: CloudflareRawCustomCertificate;
  accountId: string;
  zoneId: string;
  at: string;
}): CloudflareEntity {
  const {
    id,
    status: _status,
    hosts: _hosts,
    issuer: _issuer,
    expires_on: _expiresOn,
    priority: _priority,
    ...rest
  } = raw;
  const providerId = `custom-certificate:${id}`;
  const detail: CloudflareZoneCertificateDetail = {
    config: configBucket({ value: rest }),
    expiresOn: unsetFieldAsNull({ record: raw, key: "expires_on" }),
    hosts: customCertificateHostsOrNone({ raw }),
    issuer: unsetFieldAsNull({ record: raw, key: "issuer" }),
    kind: "zone-certificate",
    priority: unsetFieldAsNull({ record: raw, key: "priority" }),
    status: unsetFieldAsNull({ record: raw, key: "status" }),
    subtype: "custom-certificate",
  };
  return {
    detail,
    firstSeenAt: at,
    id: cloudflareZoneEntityId({ components: { accountId, providerId }, kind: "zone-certificate", zoneId }),
    kind: "zone-certificate",
    lastSeenAt: at,
    providerId,
    scope: { accountId, parentId: null, zoneId },
    source: { channel: "rest-api", observedAt: at, operation: "zone-certificate-custom-certificates-list" },
    state: "observed",
  };
}
