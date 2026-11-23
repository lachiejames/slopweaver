/**
 * The flat Access readers: applications, groups, service tokens and identity providers. Each is one
 * account-filtered, SDK-paginated collection, exhausted with `for await` — not a parent fan-out, the same
 * shape `readers/zone.ts` already established.
 */
import type Cloudflare from "cloudflare";

import { err, ok, type Result } from "../../../lib/result.js";
import { mapCloudflareError } from "../client.js";
import { type CloudflareClientError, CloudflareClientErrors } from "../errors.js";
import type { CloudflareEntity } from "../model.js";
import {
  projectCloudflareAccessApplication,
  projectCloudflareAccessGroup,
  projectCloudflareAccessServiceToken,
  projectCloudflareIdentityProvider,
} from "../projection/access.js";

/** Refuse a matched item whose response omits an id, rather than projecting it with `id: undefined`. */
function requireId({
  raw,
  operation,
}: {
  raw: { id?: string };
  operation: string;
}): Result<string, CloudflareClientError> {
  if (typeof raw.id !== "string" || raw.id.length === 0) {
    return err(
      CloudflareClientErrors.schema({
        cause: `an item had no id in the ${operation} response`,
        operation,
      }),
    );
  }
  return ok(raw.id);
}

/**
 * Read every Access application under the selected account, exhausting pagination.
 *
 * @param client the constructed Cloudflare client
 * @param accountId the selected account id
 * @param at this run's ISO timestamp
 * @returns every application's entity, or the reason the read failed
 */
export async function readCloudflareAccessApplications({
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
    for await (const application of client.zeroTrust.access.applications.list({ account_id: accountId })) {
      const id = requireId({ operation: "access-applications-list", raw: application });
      if (id.isErr()) {
        return err(id.error);
      }
      entities.push(
        projectCloudflareAccessApplication({ accountId, application: { ...application, id: id.value }, at }),
      );
    }
  } catch (cause) {
    return err(mapCloudflareError({ cause, operation: "access-applications-list" }));
  }
  return ok(entities);
}

/**
 * Read every Access group under the selected account, exhausting pagination.
 *
 * @param client the constructed Cloudflare client
 * @param accountId the selected account id
 * @param at this run's ISO timestamp
 * @returns every group's entity, or the reason the read failed
 */
export async function readCloudflareAccessGroups({
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
    for await (const group of client.zeroTrust.access.groups.list({ account_id: accountId })) {
      const id = requireId({ operation: "access-groups-list", raw: group });
      if (id.isErr()) {
        return err(id.error);
      }
      entities.push(projectCloudflareAccessGroup({ accountId, at, group: { ...group, id: id.value } }));
    }
  } catch (cause) {
    return err(mapCloudflareError({ cause, operation: "access-groups-list" }));
  }
  return ok(entities);
}

/**
 * Read every Access service token under the selected account, exhausting pagination. The list endpoint
 * carries no secret `value` field — only metadata (see `projection/access.ts`).
 *
 * @param client the constructed Cloudflare client
 * @param accountId the selected account id
 * @param at this run's ISO timestamp
 * @returns every service token's entity, or the reason the read failed
 */
export async function readCloudflareAccessServiceTokens({
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
    for await (const serviceToken of client.zeroTrust.access.serviceTokens.list({ account_id: accountId })) {
      const id = requireId({ operation: "access-service-tokens-list", raw: serviceToken });
      if (id.isErr()) {
        return err(id.error);
      }
      entities.push(
        projectCloudflareAccessServiceToken({ accountId, at, serviceToken: { ...serviceToken, id: id.value } }),
      );
    }
  } catch (cause) {
    return err(mapCloudflareError({ cause, operation: "access-service-tokens-list" }));
  }
  return ok(entities);
}

/**
 * Read every identity provider under the selected account, exhausting pagination.
 *
 * @param client the constructed Cloudflare client
 * @param accountId the selected account id
 * @param at this run's ISO timestamp
 * @returns every identity provider's entity, or the reason the read failed
 */
export async function readCloudflareIdentityProviders({
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
    for await (const provider of client.zeroTrust.identityProviders.list({ account_id: accountId })) {
      const id = requireId({ operation: "identity-providers-list", raw: provider });
      if (id.isErr()) {
        return err(id.error);
      }
      entities.push(projectCloudflareIdentityProvider({ accountId, at, provider: { ...provider, id: id.value } }));
    }
  } catch (cause) {
    return err(mapCloudflareError({ cause, operation: "identity-providers-list" }));
  }
  return ok(entities);
}
