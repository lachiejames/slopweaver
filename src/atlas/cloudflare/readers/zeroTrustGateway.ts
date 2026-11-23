/**
 * The seven Zero Trust GATEWAY readers — four list surfaces and three singletons, each fitting the shared
 * `FlatKindReader` contract `flatKindSpecs.ts` registers.
 *
 * The three singleton reads (`configurations.get`, `logging.get`, `auditSSHSettings.get`) return one object
 * rather than a page, and each answers `null` on an account that has never configured that surface. A
 * `null` is folded to an EMPTY entity array rather than to an invented empty entity: zero entities plus a
 * successful coverage cell says "read it, there is nothing there", which is exactly the distinction a
 * fabricated all-null record would destroy.
 */
import type Cloudflare from "cloudflare";

import { err, ok, type Result } from "../../../lib/result.js";
import { mapCloudflareError } from "../client.js";
import { type CloudflareClientError, CloudflareClientErrors } from "../errors.js";
import type { CloudflareEntity } from "../model.js";
import {
  projectCloudflareGatewayAuditSsh,
  projectCloudflareGatewayCertificate,
  projectCloudflareGatewayConfiguration,
  projectCloudflareGatewayLocation,
  projectCloudflareGatewayLogging,
  projectCloudflareGatewayPolicy,
  projectCloudflareGatewayProxyEndpoint,
} from "../projection/zeroTrustGateway.js";
import { singletonEntities } from "./singleton.js";

/**
 * Read every Gateway DNS/HTTP/Network policy under the selected account.
 *
 * @param client the constructed Cloudflare client
 * @param accountId the selected account id
 * @param at this run's ISO timestamp
 * @returns every policy's entity, or the reason the read failed
 */
export async function readCloudflareGatewayPolicies({
  client,
  accountId,
  at,
}: {
  client: Cloudflare;
  accountId: string;
  at: string;
}): Promise<Result<readonly CloudflareEntity[], CloudflareClientError>> {
  const entities: CloudflareEntity[] = [];
  try {
    for await (const policy of client.zeroTrust.gateway.rules.list({ account_id: accountId })) {
      if (typeof policy.id !== "string" || policy.id.length === 0) {
        return err(
          CloudflareClientErrors.schema({
            cause: `a Gateway policy named "${policy.name}" had no id in the response`,
            operation: "gateway-policies-list",
          }),
        );
      }
      entities.push(projectCloudflareGatewayPolicy({ accountId, at, policy: { ...policy, id: policy.id } }));
    }
  } catch (cause) {
    return err(mapCloudflareError({ cause, operation: "gateway-policies-list" }));
  }
  return ok(entities);
}

/**
 * Read the account's Gateway configuration singleton.
 *
 * @param client the constructed Cloudflare client
 * @param accountId the selected account id
 * @param at this run's ISO timestamp
 * @returns a one-element array, empty when the account has no Gateway configuration, or why the read failed
 */
export async function readCloudflareGatewayConfiguration({
  client,
  accountId,
  at,
}: {
  client: Cloudflare;
  accountId: string;
  at: string;
}): Promise<Result<readonly CloudflareEntity[], CloudflareClientError>> {
  try {
    const configuration = await client.zeroTrust.gateway.configurations.get({ account_id: accountId });
    return ok(
      singletonEntities({
        project: ({ value }) => projectCloudflareGatewayConfiguration({ accountId, at, configuration: value }),
        value: configuration,
      }),
    );
  } catch (cause) {
    return err(mapCloudflareError({ cause, operation: "gateway-configuration-get" }));
  }
}

/**
 * Read the account's Gateway logging settings singleton.
 *
 * @param client the constructed Cloudflare client
 * @param accountId the selected account id
 * @param at this run's ISO timestamp
 * @returns a one-element array, empty when the account has no logging settings, or why the read failed
 */
export async function readCloudflareGatewayLogging({
  client,
  accountId,
  at,
}: {
  client: Cloudflare;
  accountId: string;
  at: string;
}): Promise<Result<readonly CloudflareEntity[], CloudflareClientError>> {
  try {
    const logging = await client.zeroTrust.gateway.logging.get({ account_id: accountId });
    return ok(
      singletonEntities({
        project: ({ value }) => projectCloudflareGatewayLogging({ accountId, at, logging: value }),
        value: logging,
      }),
    );
  } catch (cause) {
    return err(mapCloudflareError({ cause, operation: "gateway-logging-get" }));
  }
}

/**
 * Read the account's SSH session-recording settings singleton.
 *
 * @param client the constructed Cloudflare client
 * @param accountId the selected account id
 * @param at this run's ISO timestamp
 * @returns a one-element array, empty when SSH auditing is unconfigured, or why the read failed
 */
export async function readCloudflareGatewayAuditSsh({
  client,
  accountId,
  at,
}: {
  client: Cloudflare;
  accountId: string;
  at: string;
}): Promise<Result<readonly CloudflareEntity[], CloudflareClientError>> {
  try {
    const setting = await client.zeroTrust.gateway.auditSSHSettings.get({ account_id: accountId });
    return ok(
      singletonEntities({
        project: ({ value }) => projectCloudflareGatewayAuditSsh({ accountId, at, setting: value }),
        value: setting,
      }),
    );
  } catch (cause) {
    return err(mapCloudflareError({ cause, operation: "gateway-audit-ssh-settings-get" }));
  }
}

/**
 * Read every Gateway location under the selected account.
 *
 * @param client the constructed Cloudflare client
 * @param accountId the selected account id
 * @param at this run's ISO timestamp
 * @returns every location's entity, or the reason the read failed
 */
export async function readCloudflareGatewayLocations({
  client,
  accountId,
  at,
}: {
  client: Cloudflare;
  accountId: string;
  at: string;
}): Promise<Result<readonly CloudflareEntity[], CloudflareClientError>> {
  const entities: CloudflareEntity[] = [];
  try {
    for await (const location of client.zeroTrust.gateway.locations.list({ account_id: accountId })) {
      if (typeof location.id !== "string" || location.id.length === 0) {
        return err(
          CloudflareClientErrors.schema({
            cause: `a Gateway location named "${location.name}" had no id in the response`,
            operation: "gateway-locations-list",
          }),
        );
      }
      entities.push(projectCloudflareGatewayLocation({ accountId, at, location: { ...location, id: location.id } }));
    }
  } catch (cause) {
    return err(mapCloudflareError({ cause, operation: "gateway-locations-list" }));
  }
  return ok(entities);
}

/**
 * Read every Gateway TLS-inspection certificate under the selected account.
 *
 * @param client the constructed Cloudflare client
 * @param accountId the selected account id
 * @param at this run's ISO timestamp
 * @returns every certificate's entity, or the reason the read failed
 */
export async function readCloudflareGatewayCertificates({
  client,
  accountId,
  at,
}: {
  client: Cloudflare;
  accountId: string;
  at: string;
}): Promise<Result<readonly CloudflareEntity[], CloudflareClientError>> {
  const entities: CloudflareEntity[] = [];
  try {
    for await (const certificate of client.zeroTrust.gateway.certificates.list({ account_id: accountId })) {
      if (typeof certificate.id !== "string" || certificate.id.length === 0) {
        return err(
          CloudflareClientErrors.schema({
            cause: "a Gateway certificate had no id in the response",
            operation: "gateway-certificates-list",
          }),
        );
      }
      entities.push(
        projectCloudflareGatewayCertificate({ accountId, at, certificate: { ...certificate, id: certificate.id } }),
      );
    }
  } catch (cause) {
    return err(mapCloudflareError({ cause, operation: "gateway-certificates-list" }));
  }
  return ok(entities);
}

/**
 * Read every Gateway proxy endpoint under the selected account.
 *
 * @param client the constructed Cloudflare client
 * @param accountId the selected account id
 * @param at this run's ISO timestamp
 * @returns every endpoint's entity, or the reason the read failed
 */
export async function readCloudflareGatewayProxyEndpoints({
  client,
  accountId,
  at,
}: {
  client: Cloudflare;
  accountId: string;
  at: string;
}): Promise<Result<readonly CloudflareEntity[], CloudflareClientError>> {
  const entities: CloudflareEntity[] = [];
  try {
    for await (const endpoint of client.zeroTrust.gateway.proxyEndpoints.list({ account_id: accountId })) {
      if (typeof endpoint.id !== "string" || endpoint.id.length === 0) {
        return err(
          CloudflareClientErrors.schema({
            cause: `a Gateway proxy endpoint named "${endpoint.name}" had no id in the response`,
            operation: "gateway-proxy-endpoints-list",
          }),
        );
      }
      entities.push(
        projectCloudflareGatewayProxyEndpoint({ accountId, at, endpoint: { ...endpoint, id: endpoint.id } }),
      );
    }
  } catch (cause) {
    return err(mapCloudflareError({ cause, operation: "gateway-proxy-endpoints-list" }));
  }
  return ok(entities);
}
