/**
 * The `zone-certificate` readers: one per independent, deep-zone-scoped SSL/certificate collection, each
 * returned as its OWN `Result` — see `zoneCertificateSync.ts`'s header for why this kind needs per-subtype
 * partial success rather than an all-or-nothing combine, the same reasoning `readers/firewallService.ts`
 * already established. The two Universal SSL readers live in `readers/zoneCertificateUniversal.ts`.
 */
import type Cloudflare from "cloudflare";

import { err, ok, type Result } from "../../../lib/result.js";
import { mapCloudflareError } from "../client.js";
import type { CloudflareClientError } from "../errors.js";
import type { CloudflareEntity } from "../model.js";
import {
  projectCloudflareCertificatePack,
  projectCloudflareClientCertificate,
  projectCloudflareCustomHostname,
  projectCloudflareKeylessCertificate,
  projectCloudflareOriginCaCertificate,
} from "../projection/zoneCertificate.js";
import {
  projectCloudflareAopHostnameCertificate,
  projectCloudflareAopSetting,
  projectCloudflareAopZoneCertificate,
} from "../projection/zoneCertificateAop.js";
import { projectCloudflareCustomCertificate } from "../projection/zoneCertificateCustom.js";

/**
 * Read every certificate pack for the configured deep zone.
 *
 * @param client the constructed Cloudflare client
 * @param accountId the selected account id
 * @param zoneId the configured deep zone id
 * @param at this run's ISO timestamp
 * @returns every pack's entity, or the reason the read failed
 */
export async function readCloudflareCertificatePacks({
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
  const entities: CloudflareEntity[] = [];
  try {
    for await (const pack of client.ssl.certificatePacks.list({ zone_id: zoneId })) {
      if (typeof pack.id !== "string" || pack.id.length === 0) {
        continue;
      }
      entities.push(projectCloudflareCertificatePack({ accountId, at, raw: { ...pack, id: pack.id }, zoneId }));
    }
  } catch (cause) {
    return err(mapCloudflareError({ cause, operation: "zone-certificate-certificate-packs-list" }));
  }
  return ok(entities);
}

/**
 * Read every custom (uploaded) certificate for the configured deep zone.
 *
 * @param client the constructed Cloudflare client
 * @param accountId the selected account id
 * @param zoneId the configured deep zone id
 * @param at this run's ISO timestamp
 * @returns every certificate's entity, or the reason the read failed
 */
export async function readCloudflareCustomCertificates({
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
  const entities: CloudflareEntity[] = [];
  try {
    for await (const cert of client.customCertificates.list({ zone_id: zoneId })) {
      if (typeof cert.id !== "string" || cert.id.length === 0) {
        continue;
      }
      entities.push(projectCloudflareCustomCertificate({ accountId, at, raw: { ...cert, id: cert.id }, zoneId }));
    }
  } catch (cause) {
    return err(mapCloudflareError({ cause, operation: "zone-certificate-custom-certificates-list" }));
  }
  return ok(entities);
}

/**
 * Read every zone-level client certificate (API Shield mTLS) for the configured deep zone.
 *
 * @param client the constructed Cloudflare client
 * @param accountId the selected account id
 * @param zoneId the configured deep zone id
 * @param at this run's ISO timestamp
 * @returns every certificate's entity, or the reason the read failed
 */
export async function readCloudflareClientCertificates({
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
  const entities: CloudflareEntity[] = [];
  try {
    for await (const cert of client.clientCertificates.list({ zone_id: zoneId })) {
      if (typeof cert.id !== "string" || cert.id.length === 0) {
        continue;
      }
      entities.push(projectCloudflareClientCertificate({ accountId, at, raw: { ...cert, id: cert.id }, zoneId }));
    }
  } catch (cause) {
    return err(mapCloudflareError({ cause, operation: "zone-certificate-client-certificates-list" }));
  }
  return ok(entities);
}

/**
 * Read every keyless SSL certificate for the configured deep zone.
 *
 * @param client the constructed Cloudflare client
 * @param accountId the selected account id
 * @param zoneId the configured deep zone id
 * @param at this run's ISO timestamp
 * @returns every certificate's entity, or the reason the read failed
 */
export async function readCloudflareKeylessCertificates({
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
  const entities: CloudflareEntity[] = [];
  try {
    for await (const cert of client.keylessCertificates.list({ zone_id: zoneId })) {
      if (typeof cert.id !== "string" || cert.id.length === 0) {
        continue;
      }
      entities.push(projectCloudflareKeylessCertificate({ accountId, at, raw: { ...cert, id: cert.id }, zoneId }));
    }
  } catch (cause) {
    return err(mapCloudflareError({ cause, operation: "zone-certificate-keyless-certificates-list" }));
  }
  return ok(entities);
}

/**
 * Read every Origin CA certificate for the configured deep zone (filtered by `zone_id` as a query param).
 *
 * @param client the constructed Cloudflare client
 * @param accountId the selected account id
 * @param zoneId the configured deep zone id
 * @param at this run's ISO timestamp
 * @returns every certificate's entity, or the reason the read failed
 */
export async function readCloudflareOriginCaCertificates({
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
  const entities: CloudflareEntity[] = [];
  try {
    for await (const cert of client.originCACertificates.list({ zone_id: zoneId })) {
      if (typeof cert.id !== "string" || cert.id.length === 0) {
        continue;
      }
      entities.push(projectCloudflareOriginCaCertificate({ accountId, at, raw: { ...cert, id: cert.id }, zoneId }));
    }
  } catch (cause) {
    return err(mapCloudflareError({ cause, operation: "zone-certificate-origin-ca-certificates-list" }));
  }
  return ok(entities);
}

/**
 * Read the zone's Authenticated Origin Pull setting.
 *
 * @param client the constructed Cloudflare client
 * @param accountId the selected account id
 * @param zoneId the configured deep zone id
 * @param at this run's ISO timestamp
 * @returns the setting's entity, or the reason the read failed
 */
export async function readCloudflareAopSetting({
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
    const setting = await client.originTLSClientAuth.settings.get({ zone_id: zoneId });
    return ok([projectCloudflareAopSetting({ accountId, at, enabled: setting.enabled, zoneId })]);
  } catch (cause) {
    return err(mapCloudflareError({ cause, operation: "zone-certificate-aop-settings-get" }));
  }
}

/**
 * Read every Authenticated Origin Pull zone-wide client certificate for the configured deep zone.
 *
 * @param client the constructed Cloudflare client
 * @param accountId the selected account id
 * @param zoneId the configured deep zone id
 * @param at this run's ISO timestamp
 * @returns every certificate's entity, or the reason the read failed
 */
export async function readCloudflareAopZoneCertificates({
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
  const entities: CloudflareEntity[] = [];
  try {
    for await (const cert of client.originTLSClientAuth.zoneCertificates.list({ zone_id: zoneId })) {
      if (typeof cert.id !== "string" || cert.id.length === 0) {
        continue;
      }
      entities.push(projectCloudflareAopZoneCertificate({ accountId, at, raw: { ...cert, id: cert.id }, zoneId }));
    }
  } catch (cause) {
    return err(mapCloudflareError({ cause, operation: "zone-certificate-aop-zone-certificates-list" }));
  }
  return ok(entities);
}

/**
 * Read every Authenticated Origin Pull hostname-pool client certificate for the configured deep zone.
 *
 * @param client the constructed Cloudflare client
 * @param accountId the selected account id
 * @param zoneId the configured deep zone id
 * @param at this run's ISO timestamp
 * @returns every certificate's entity, or the reason the read failed
 */
export async function readCloudflareAopHostnameCertificates({
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
  const entities: CloudflareEntity[] = [];
  try {
    for await (const cert of client.originTLSClientAuth.hostnameCertificates.list({ zone_id: zoneId })) {
      if (typeof cert.id !== "string" || cert.id.length === 0) {
        continue;
      }
      entities.push(projectCloudflareAopHostnameCertificate({ accountId, at, raw: { ...cert, id: cert.id }, zoneId }));
    }
  } catch (cause) {
    return err(mapCloudflareError({ cause, operation: "zone-certificate-aop-hostname-certificates-list" }));
  }
  return ok(entities);
}

/**
 * Read every custom hostname (SSL for SaaS) for the configured deep zone.
 *
 * @param client the constructed Cloudflare client
 * @param accountId the selected account id
 * @param zoneId the configured deep zone id
 * @param at this run's ISO timestamp
 * @returns every hostname's entity, or the reason the read failed
 */
export async function readCloudflareCustomHostnames({
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
  const entities: CloudflareEntity[] = [];
  try {
    for await (const hostname of client.customHostnames.list({ zone_id: zoneId })) {
      if (typeof hostname.id !== "string" || hostname.id.length === 0) {
        continue;
      }
      entities.push(
        projectCloudflareCustomHostname({
          accountId,
          at,
          raw: { ...hostname, id: hostname.id, ssl: hostname.ssl !== undefined ? { ...hostname.ssl } : undefined },
          zoneId,
        }),
      );
    }
  } catch (cause) {
    return err(mapCloudflareError({ cause, operation: "zone-certificate-custom-hostnames-list" }));
  }
  return ok(entities);
}
