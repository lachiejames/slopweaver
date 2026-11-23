/**
 * The `api-gateway` readers: eight independent, deep-zone-scoped API Gateway collections, each returned as
 * its OWN `Result` — see `apiGatewaySync.ts`'s header for why this kind needs per-subtype partial success
 * rather than an all-or-nothing combine, the same reasoning `readers/firewallService.ts`/
 * `readers/zoneCertificate.ts` already established. `discovery.get`/`schemas.list` are the two surfaces here
 * the SDK types as bare `unknown[]`, folded whole into one entity each rather than split per-item.
 */
import type Cloudflare from "cloudflare";
import { isRecord } from "../../../lib/parsers.js";

import { err, ok, type Result } from "../../../lib/result.js";
import { mapCloudflareError } from "../client.js";
import type { CloudflareClientError } from "../errors.js";
import type { CloudflareEntity } from "../model.js";
import {
  projectCloudflareApiGatewayConfiguration,
  projectCloudflareApiGatewayLabel,
  projectCloudflareApiGatewayOperation,
  projectCloudflareApiGatewaySettings,
  projectCloudflareDiscoveryOperation,
  projectCloudflareDiscoverySchemaCollection,
  projectCloudflareSchemaCollection,
  projectCloudflareUserSchema,
} from "../projection/apiGateway.js";

/**
 * Read every registered API Gateway operation for the configured deep zone.
 *
 * @param client the constructed Cloudflare client
 * @param accountId the selected account id
 * @param zoneId the configured deep zone id
 * @param at this run's ISO timestamp
 * @returns every operation's entity, or the reason the read failed
 */
export async function readCloudflareApiGatewayOperations({
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
    for await (const operation of client.apiGateway.operations.list({ zone_id: zoneId })) {
      if (typeof operation.operation_id !== "string" || operation.operation_id.length === 0) {
        continue;
      }
      entities.push(
        projectCloudflareApiGatewayOperation({
          accountId,
          at,
          raw: { ...operation, operation_id: operation.operation_id },
          zoneId,
        }),
      );
    }
  } catch (cause) {
    return err(mapCloudflareError({ cause, operation: "api-gateway-operations-list" }));
  }
  return ok(entities);
}

/**
 * Read every discovered API Gateway operation for the configured deep zone.
 *
 * @param client the constructed Cloudflare client
 * @param accountId the selected account id
 * @param zoneId the configured deep zone id
 * @param at this run's ISO timestamp
 * @returns every discovered operation's entity, or the reason the read failed
 */
export async function readCloudflareDiscoveryOperations({
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
    for await (const operation of client.apiGateway.discovery.operations.list({ zone_id: zoneId })) {
      if (typeof operation.id !== "string" || operation.id.length === 0) {
        continue;
      }
      entities.push(
        projectCloudflareDiscoveryOperation({ accountId, at, raw: { ...operation, id: operation.id }, zoneId }),
      );
    }
  } catch (cause) {
    return err(mapCloudflareError({ cause, operation: "api-gateway-discovery-operations-list" }));
  }
  return ok(entities);
}

/**
 * Read the zone's discovered-schema collection — the SDK types this endpoint's `schemas` field as bare
 * `unknown[]`, so each item is validated at runtime rather than by the compiler.
 *
 * @param client the constructed Cloudflare client
 * @param accountId the selected account id
 * @param zoneId the configured deep zone id
 * @param at this run's ISO timestamp
 * @returns the discovered-schema collection's entity, or the reason the read failed
 */
export async function readCloudflareDiscoverySchemas({
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
    const response = await client.apiGateway.discovery.get({ zone_id: zoneId });
    const schemas = Array.isArray(response.schemas) ? response.schemas.filter(isRecord) : [];
    return ok([
      projectCloudflareDiscoverySchemaCollection({ accountId, at, schemas, timestamp: response.timestamp, zoneId }),
    ]);
  } catch (cause) {
    return err(mapCloudflareError({ cause, operation: "api-gateway-discovery-get" }));
  }
}

/**
 * Read the zone's uploaded/learned schema collection — the same bare-`unknown[]` shape
 * {@link readCloudflareDiscoverySchemas} handles.
 *
 * @param client the constructed Cloudflare client
 * @param accountId the selected account id
 * @param zoneId the configured deep zone id
 * @param at this run's ISO timestamp
 * @returns the schema collection's entity, or the reason the read failed
 */
export async function readCloudflareApiGatewaySchemas({
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
    const response = await client.apiGateway.schemas.list({ zone_id: zoneId });
    const schemas = Array.isArray(response.schemas) ? response.schemas.filter(isRecord) : [];
    return ok([projectCloudflareSchemaCollection({ accountId, at, raw: response, schemas, zoneId })]);
  } catch (cause) {
    return err(mapCloudflareError({ cause, operation: "api-gateway-schemas-list" }));
  }
}

/**
 * Read every API Gateway label for the configured deep zone.
 *
 * @param client the constructed Cloudflare client
 * @param accountId the selected account id
 * @param zoneId the configured deep zone id
 * @param at this run's ISO timestamp
 * @returns every label's entity, or the reason the read failed
 */
export async function readCloudflareApiGatewayLabels({
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
    for await (const label of client.apiGateway.labels.list({ zone_id: zoneId })) {
      if (typeof label.name !== "string" || label.name.length === 0) {
        continue;
      }
      entities.push(projectCloudflareApiGatewayLabel({ accountId, at, raw: { ...label, name: label.name }, zoneId }));
    }
  } catch (cause) {
    return err(mapCloudflareError({ cause, operation: "api-gateway-labels-list" }));
  }
  return ok(entities);
}

/**
 * Read the zone's schema-validation setting.
 *
 * @param client the constructed Cloudflare client
 * @param accountId the selected account id
 * @param zoneId the configured deep zone id
 * @param at this run's ISO timestamp
 * @returns the setting's entity, or the reason the read failed
 */
export async function readCloudflareApiGatewaySettings({
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
    const settings = await client.apiGateway.settings.schemaValidation.get({ zone_id: zoneId });
    return ok([projectCloudflareApiGatewaySettings({ accountId, at, raw: settings, zoneId })]);
  } catch (cause) {
    return err(mapCloudflareError({ cause, operation: "api-gateway-settings-schema-validation-get" }));
  }
}

/**
 * Read the zone's API Shield auth-ID configuration.
 *
 * @param client the constructed Cloudflare client
 * @param accountId the selected account id
 * @param zoneId the configured deep zone id
 * @param at this run's ISO timestamp
 * @returns the configuration's entity, or the reason the read failed
 */
export async function readCloudflareApiGatewayConfiguration({
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
    const configuration = await client.apiGateway.configurations.get({ zone_id: zoneId });
    const authIdCharacteristics = configuration.auth_id_characteristics.filter(isRecord).map((item) => ({ ...item }));
    return ok([projectCloudflareApiGatewayConfiguration({ accountId, at, authIdCharacteristics, zoneId })]);
  } catch (cause) {
    return err(mapCloudflareError({ cause, operation: "api-gateway-configurations-get" }));
  }
}

/**
 * Read every uploaded/deprecated user schema for the configured deep zone.
 *
 * @param client the constructed Cloudflare client
 * @param accountId the selected account id
 * @param zoneId the configured deep zone id
 * @param at this run's ISO timestamp
 * @returns every schema's entity, or the reason the read failed
 */
export async function readCloudflareUserSchemas({
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
    for await (const schema of client.apiGateway.userSchemas.list({ zone_id: zoneId })) {
      if (typeof schema.schema_id !== "string" || schema.schema_id.length === 0) {
        continue;
      }
      entities.push(
        projectCloudflareUserSchema({ accountId, at, raw: { ...schema, schema_id: schema.schema_id }, zoneId }),
      );
    }
  } catch (cause) {
    return err(mapCloudflareError({ cause, operation: "api-gateway-user-schemas-list" }));
  }
  return ok(entities);
}
