/**
 * The Universal SSL `zone-certificate` readers — the zone's Universal SSL setting and its verification
 * entries, cut out of `readers/zoneCertificate.ts` along the same seam `projection/zoneCertificateUniversal.ts`
 * cuts the projection. Each returns its OWN `Result`, folded per subtype by `zoneCertificateSync.ts`.
 *
 * Universal SSL verification (`client.ssl.verification.get`) is the one `zone-certificate` surface that returns
 * a bare array rather than either a paginated collection or a typed singleton, and its entries carry no `id`:
 * `cert_pack_uuid` is their only provider identity, so an entry without a usable one refuses the read. So does
 * one without the `certificate_status` the SDK declares required.
 */
import type Cloudflare from "cloudflare";

import { err, ok, type Result } from "../../../lib/result.js";
import { mapCloudflareError } from "../client.js";
import { type CloudflareClientError, CloudflareClientErrors } from "../errors.js";
import type { CloudflareEntity } from "../model.js";
import {
  projectCloudflareUniversalSslSetting,
  projectCloudflareUniversalSslVerification,
} from "../projection/zoneCertificateUniversal.js";

const UNIVERSAL_SSL_VERIFICATION_OPERATION = "zone-certificate-universal-ssl-verification-get";

/**
 * Read the zone's Universal SSL setting.
 *
 * @param client the constructed Cloudflare client
 * @param accountId the selected account id
 * @param zoneId the configured deep zone id
 * @param at this run's ISO timestamp
 * @returns the setting's entity, or the reason the read failed
 */
export async function readCloudflareUniversalSslSetting({
  client,
  accountId,
  zoneId,
  at,
}: {
  client: Cloudflare;
  accountId: string;
  zoneId: string;
  at: string;
}): Promise<Result<readonly CloudflareEntity[], CloudflareClientError>> {
  try {
    const setting = await client.ssl.universal.settings.get({ zone_id: zoneId });
    return ok([projectCloudflareUniversalSslSetting({ accountId, at, setting, zoneId })]);
  } catch (cause) {
    return err(mapCloudflareError({ cause, operation: "zone-certificate-universal-ssl-settings-get" }));
  }
}

/**
 * The `cert_pack_uuid` a Universal SSL verification entry is keyed on. An entry has no `id`, so without it
 * there is no provider identity to form: the entry is refused rather than keyed on its position in the
 * response, which moves whenever the response order does.
 *
 * @param entry one raw verification entry
 * @returns the entry's non-empty `cert_pack_uuid`, or a schema error naming whether it was absent or malformed
 */
function verificationCertPackUuid({
  entry,
}: {
  entry: { readonly cert_pack_uuid?: unknown };
}): Result<string, CloudflareClientError> {
  const uuid = entry.cert_pack_uuid;
  if (uuid === undefined || uuid === null) {
    return err(
      CloudflareClientErrors.schema({
        cause:
          "a Universal SSL verification entry had no cert_pack_uuid in the response, and it is the entry's provider id",
        operation: UNIVERSAL_SSL_VERIFICATION_OPERATION,
      }),
    );
  }
  if (typeof uuid !== "string" || uuid.length === 0) {
    return err(
      CloudflareClientErrors.schema({
        cause: "a Universal SSL verification entry's cert_pack_uuid was not a non-empty string in the response",
        operation: UNIVERSAL_SSL_VERIFICATION_OPERATION,
      }),
    );
  }
  return ok(uuid);
}

/**
 * The `certificate_status` of a Universal SSL verification entry. The SDK declares it REQUIRED, so an entry
 * without one is a response that broke its own contract: it is refused rather than stored as an unknown status.
 *
 * @param entry one raw verification entry
 * @returns the entry's `certificate_status`, or a schema error naming whether it was absent or malformed
 */
function verificationCertificateStatus({
  entry,
}: {
  entry: { readonly certificate_status?: unknown };
}): Result<string, CloudflareClientError> {
  const status = entry.certificate_status;
  if (status === undefined || status === null) {
    return err(
      CloudflareClientErrors.schema({
        cause: "a Universal SSL verification entry had no certificate_status in the response, which the SDK requires",
        operation: UNIVERSAL_SSL_VERIFICATION_OPERATION,
      }),
    );
  }
  if (typeof status !== "string") {
    return err(
      CloudflareClientErrors.schema({
        cause: "a Universal SSL verification entry's certificate_status was not a string in the response",
        operation: UNIVERSAL_SSL_VERIFICATION_OPERATION,
      }),
    );
  }
  return ok(status);
}

/**
 * Read the zone's Universal SSL verification entries — a plain array, not a paginated collection. One entry
 * without a usable `cert_pack_uuid` or `certificate_status` refuses the whole read with a typed schema error.
 *
 * @param client the constructed Cloudflare client
 * @param accountId the selected account id
 * @param zoneId the configured deep zone id
 * @param at this run's ISO timestamp
 * @returns every entry's entity, or the reason the read failed
 */
export async function readCloudflareUniversalSslVerification({
  client,
  accountId,
  zoneId,
  at,
}: {
  client: Cloudflare;
  accountId: string;
  zoneId: string;
  at: string;
}): Promise<Result<readonly CloudflareEntity[], CloudflareClientError>> {
  try {
    const entries = await client.ssl.verification.get({ zone_id: zoneId });
    const entities: CloudflareEntity[] = [];
    for (const entry of entries) {
      const certPackUuid = verificationCertPackUuid({ entry });
      if (certPackUuid.isErr()) {
        return err(certPackUuid.error);
      }
      const certificateStatus = verificationCertificateStatus({ entry });
      if (certificateStatus.isErr()) {
        return err(certificateStatus.error);
      }
      entities.push(
        projectCloudflareUniversalSslVerification({
          accountId,
          at,
          raw: { ...entry, cert_pack_uuid: certPackUuid.value, certificate_status: certificateStatus.value },
          zoneId,
        }),
      );
    }
    return ok(entities);
  } catch (cause) {
    return err(mapCloudflareError({ cause, operation: UNIVERSAL_SSL_VERIFICATION_OPERATION }));
  }
}
