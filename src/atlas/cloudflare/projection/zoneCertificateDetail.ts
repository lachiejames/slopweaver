/**
 * The stored shape of the `zone-certificate` kind — the detail union every subtype's projector builds, and
 * the guard that narrows a stored `detail` back into it, with the subtype list both are keyed by. Cut out of
 * `zoneCertificate.ts` for the file-size cap; the redaction stays in the parent, and every projector lives
 * beside it. This module imports nothing from its siblings, so the projectors depend on it and never the
 * reverse.
 */
import { isRecord } from "../../../lib/parsers.js";

/** Every source surface `zone-certificate` folds together. */
export const CLOUDFLARE_ZONE_CERTIFICATE_SUBTYPES = [
  "certificate-pack",
  "universal-ssl-setting",
  "universal-ssl-verification",
  "custom-certificate",
  "client-certificate",
  "keyless-certificate",
  "origin-ca-certificate",
  "aop-setting",
  "aop-zone-certificate",
  "aop-hostname-certificate",
  "custom-hostname",
] as const;

export type CloudflareZoneCertificateSubtype = (typeof CLOUDFLARE_ZONE_CERTIFICATE_SUBTYPES)[number];

/** The detail this atlas stores for the `zone-certificate` kind — one variant per subtype. */
export type CloudflareZoneCertificateDetail =
  | {
      readonly kind: "zone-certificate";
      readonly subtype: "certificate-pack";
      readonly status: string | null;
      readonly type: string | null;
      readonly hosts: readonly string[];
      readonly validityDays: number | null;
      readonly config: Readonly<Record<string, unknown>>;
    }
  | {
      readonly kind: "zone-certificate";
      readonly subtype: "universal-ssl-setting";
      readonly enabled: boolean | null;
    }
  | {
      readonly kind: "zone-certificate";
      readonly subtype: "universal-ssl-verification";
      readonly certificateStatus: string | null;
      readonly verificationStatus: boolean | null;
      readonly verificationType: string | null;
      readonly certPackUuid: string | null;
      readonly config: Readonly<Record<string, unknown>>;
    }
  | {
      readonly kind: "zone-certificate";
      readonly subtype: "custom-certificate";
      readonly status: string | null;
      readonly hosts: readonly string[];
      readonly issuer: string | null;
      readonly expiresOn: string | null;
      readonly priority: number | null;
      readonly config: Readonly<Record<string, unknown>>;
    }
  | {
      readonly kind: "zone-certificate";
      readonly subtype: "client-certificate";
      readonly status: string | null;
      readonly commonName: string | null;
      readonly expiresOn: string | null;
      readonly issuedOn: string | null;
      readonly config: Readonly<Record<string, unknown>>;
    }
  | {
      readonly kind: "zone-certificate";
      readonly subtype: "keyless-certificate";
      readonly enabled: boolean | null;
      readonly host: string | null;
      readonly port: number | null;
      readonly status: string | null;
      readonly name: string | null;
      readonly config: Readonly<Record<string, unknown>>;
    }
  | {
      readonly kind: "zone-certificate";
      readonly subtype: "origin-ca-certificate";
      readonly requestType: string | null;
      readonly requestedValidity: number | null;
      readonly expiresOn: string | null;
      readonly hostnames: readonly string[];
      readonly config: Readonly<Record<string, unknown>>;
    }
  | {
      readonly kind: "zone-certificate";
      readonly subtype: "aop-setting";
      readonly enabled: boolean | null;
    }
  | {
      readonly kind: "zone-certificate";
      readonly subtype: "aop-zone-certificate";
      readonly status: string | null;
      readonly enabled: boolean | null;
      readonly expiresOn: string | null;
      readonly issuer: string | null;
      readonly config: Readonly<Record<string, unknown>>;
    }
  | {
      readonly kind: "zone-certificate";
      readonly subtype: "aop-hostname-certificate";
      readonly status: string | null;
      readonly expiresOn: string | null;
      readonly issuer: string | null;
      readonly config: Readonly<Record<string, unknown>>;
    }
  | {
      readonly kind: "zone-certificate";
      readonly subtype: "custom-hostname";
      readonly hostname: string | null;
      readonly status: string | null;
      readonly sslStatus: string | null;
      readonly sslId: string | null;
      readonly ownershipVerificationType: string | null;
      readonly config: Readonly<Record<string, unknown>>;
    };

/**
 * Narrow a stored entity's `detail` into this domain's shape and confirm its subtype, the same pattern
 * `projection/firewallService.ts`'s `isCloudflareFirewallServiceDetailOf` established.
 *
 * @param value the entity's `detail` field, read back from disk
 * @param subtype the subtype to require
 * @returns true when `value` is a genuine `CloudflareZoneCertificateDetail` of the given subtype
 */
export function isCloudflareZoneCertificateDetailOf({
  value,
  subtype,
}: {
  value: unknown;
  subtype: CloudflareZoneCertificateSubtype;
}): boolean {
  return isRecord(value) && value["kind"] === "zone-certificate" && value["subtype"] === subtype;
}
