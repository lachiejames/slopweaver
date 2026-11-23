/**
 * The account-certificate readers: the account-level mTLS certificate inventory (a flat collection, one
 * call), and per-certificate service associations (a parent fan-out, `SinglePage`).
 */
import type Cloudflare from "cloudflare";

import { err, ok, type Result } from "../../../lib/result.js";
import { mapCloudflareError } from "../client.js";
import type { CloudflareClientError } from "../errors.js";
import type {
  CloudflareRawAccountCertificate,
  CloudflareRawAccountCertificateAssociation,
} from "../projection/accountCertificate.js";

/**
 * Read the account's mTLS certificate inventory, exhausting pagination.
 *
 * @param client the constructed Cloudflare client
 * @param accountId the selected account id
 * @returns every certificate's metadata, or the reason the read failed
 */
export async function readCloudflareAccountCertificateInventory({
  client,
  accountId,
}: {
  client: Cloudflare;
  accountId: string;
}): Promise<Result<readonly CloudflareRawAccountCertificate[], CloudflareClientError>> {
  const certificates: CloudflareRawAccountCertificate[] = [];
  try {
    for await (const certificate of client.mtlsCertificates.list({ account_id: accountId })) {
      if (typeof certificate.id !== "string" || certificate.id.length === 0) {
        continue;
      }
      certificates.push({ ...certificate, id: certificate.id });
    }
  } catch (cause) {
    return err(mapCloudflareError({ cause, operation: "account-certificates-list" }));
  }
  return ok(certificates);
}

/**
 * Read one certificate's active service associations.
 *
 * @param client the constructed Cloudflare client
 * @param accountId the selected account id
 * @param certificateId the certificate to read associations for
 * @returns every association this certificate currently has, or the reason the read failed
 */
export async function readCloudflareAccountCertificateAssociations({
  client,
  accountId,
  certificateId,
}: {
  client: Cloudflare;
  accountId: string;
  certificateId: string;
}): Promise<Result<readonly CloudflareRawAccountCertificateAssociation[], CloudflareClientError>> {
  const associations: CloudflareRawAccountCertificateAssociation[] = [];
  try {
    for await (const association of client.mtlsCertificates.associations.get(certificateId, {
      account_id: accountId,
    })) {
      associations.push({ ...association });
    }
  } catch (cause) {
    return err(mapCloudflareError({ cause, operation: "account-certificate-associations-get" }));
  }
  return ok(associations);
}
