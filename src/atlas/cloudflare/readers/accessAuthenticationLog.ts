/**
 * The `access-authentication-log` reader, fitting the shared `FlatKindReader` contract `flatKindSpecs.ts`
 * registers (through `zeroTrustAccessAdmin.ts`, beside the other seven Access administration readers).
 *
 * **It folds the two log streams**, authentication events and SCIM provisioning updates, told apart by the
 * stored `entryKind`. The SCIM half REQUIRES `idp_id` —
 * `UpdateListParams` declares it non-optional — so the reader reads the identity providers first and passes
 * their ids. It passes only the SCIM-ENABLED ones: MEASURED, asking about a provider with
 * `scim_config.enabled: false` answers
 * `400 access.api.error.idp_not_scim_enabled`, which failed the whole kind. The first live sync is what found
 * that, after every unit test passed. With no SCIM-enabled provider there are no SCIM updates to ask for, and
 * the reader returns the authentication half alone rather than a refusal.
 *
 * **Every component of a log line's key must be there.** A line carries no id of its own, so
 * `projection/zeroTrustAccessLog.ts` keys it on a composite, and a component the response omits would
 * otherwise have keyed two different lines alike. So this reader refuses the whole kind with a schema error —
 * one cause for an absent component, another for one that is present but not a non-empty string — which
 * `gaps.ts` records as `schema-drift`. Cloudflare's SDK types every component optional, and names the SCIM
 * method `request_method` where the wire carries `http_method`; MEASURED over every authentication
 * event and SCIM update in the stored atlas, not one component was absent or empty. Repro, which
 * prints 0, over `$SLOPWEAVER_HOME/atlas/cloudflare/access-authentication-log.jsonl`:
 * `jq -s '[.[1:][].detail | if .entryKind == "authentication" then [.loggedAt, .rayId]
 * else [.loggedAt, .idpId, .cfResourceId, .httpMethod] end | select(any(. == null or . == ""))] | length'`.
 *
 * The SCIM stream also DELIVERS a row twice, and telling that apart from two real updates is the whole
 * reason the projection puts the request body in the key. Measured on the same run, once the body was in the
 * key: the rows still outnumbered their distinct ids, and every repeated id was a byte-identical redelivery. So
 * this reader drops an id it has already emitted, exactly as `readers/zeroTrustPosture.ts` does for
 * `dex-fleet-status`, and the two guards answer different halves of the same class: the KEY keeps two real
 * updates apart, and the guard collapses one update delivered twice.
 */
import type Cloudflare from "cloudflare";

import { err, ok, type Result } from "../../../lib/result.js";
import { mapCloudflareError } from "../client.js";
import { type CloudflareClientError, CloudflareClientErrors } from "../errors.js";
import type { CloudflareEntity } from "../model.js";
import {
  projectCloudflareAccessAuthenticationEvent,
  projectCloudflareAccessScimUpdate,
} from "../projection/zeroTrustAccessLog.js";

const EVENTS_OPERATION = "access-authentication-events-list";
const SCIM_OPERATION = "access-scim-updates-list";

/**
 * Read both Access log streams — authentication events and SCIM provisioning updates — into one kind.
 *
 * @param client the constructed Cloudflare client
 * @param accountId the selected account id
 * @param at this run's ISO timestamp
 * @returns every log line's entity across both streams, or the reason the first failing read failed —
 *   including a line missing a component of its key
 */
export async function readCloudflareAccessAuthenticationLog({
  client,
  accountId,
  at,
}: {
  client: Cloudflare;
  accountId: string;
  at: string;
}): Promise<Result<readonly CloudflareEntity[], CloudflareClientError>> {
  const events = await readAuthenticationEvents({ accountId, at, client });
  if (events.isErr()) {
    return err(events.error);
  }
  const idpIds: string[] = [];
  try {
    for await (const provider of client.zeroTrust.identityProviders.list({ account_id: accountId })) {
      // Only a SCIM-ENABLED provider may be asked — see this file's header for the refusal that proved it.
      if (typeof provider.id === "string" && provider.id.length > 0 && provider.scim_config?.enabled === true) {
        idpIds.push(provider.id);
      }
    }
  } catch (cause) {
    return err(mapCloudflareError({ cause, operation: "access-scim-idps-list" }));
  }
  if (idpIds.length === 0) {
    return ok(events.value);
  }
  const updates = await readScimUpdates({ accountId, at, client, idpIds });
  if (updates.isErr()) {
    return err(updates.error);
  }
  return ok([...events.value, ...updates.value]);
}

/** The authentication-event half, refusing an event missing either component of its key. */
async function readAuthenticationEvents({
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
    const events = await client.zeroTrust.access.logs.accessRequests.list({ account_id: accountId });
    for (const event of events) {
      const identity = { line: "an Access authentication event", operation: EVENTS_OPERATION };
      const createdAt = identityComponent({ ...identity, field: "created_at", value: event.created_at });
      if (createdAt.isErr()) {
        return err(createdAt.error);
      }
      const rayId = identityComponent({ ...identity, field: "ray_id", value: event.ray_id });
      if (rayId.isErr()) {
        return err(rayId.error);
      }
      entities.push(
        projectCloudflareAccessAuthenticationEvent({
          accountId,
          at,
          event: { ...event, created_at: createdAt.value, ray_id: rayId.value },
        }),
      );
    }
  } catch (cause) {
    return err(mapCloudflareError({ cause, operation: EVENTS_OPERATION }));
  }
  return ok(entities);
}

/** The SCIM half, refusing an update missing any component of its key, and dropping a redelivery. */
async function readScimUpdates({
  client,
  accountId,
  at,
  idpIds,
}: {
  client: Cloudflare;
  accountId: string;
  at: string;
  idpIds: readonly string[];
}): Promise<Result<readonly CloudflareEntity[], CloudflareClientError>> {
  const entities: CloudflareEntity[] = [];
  const seen = new Set<string>();
  try {
    for await (const update of client.zeroTrust.access.logs.scim.updates.list({
      account_id: accountId,
      idp_id: [...idpIds],
    })) {
      const identity = scimUpdateIdentity({ update });
      if (identity.isErr()) {
        return err(identity.error);
      }
      const entity = projectCloudflareAccessScimUpdate({ accountId, at, update: { ...update, ...identity.value } });
      // The provider also delivers a byte-identical update twice — see this file's header. The projection's
      // key already carries the request body, so an id repeat here means the SAME update, not a lost one.
      if (seen.has(entity.id)) {
        continue;
      }
      seen.add(entity.id);
      entities.push(entity);
    }
  } catch (cause) {
    return err(mapCloudflareError({ cause, operation: SCIM_OPERATION }));
  }
  return ok(entities);
}

/** The four components of a SCIM update's key, each a non-empty string, or the schema error naming the first
 * that is not. `http_method` is read off the wire record by name because the SDK does not declare it. */
function scimUpdateIdentity({ update }: { update: object }): Result<
  {
    readonly logged_at: string;
    readonly idp_id: string;
    readonly cf_resource_id: string;
    readonly http_method: string;
  },
  CloudflareClientError
> {
  const identity = { line: "an Access SCIM update", operation: SCIM_OPERATION };
  const loggedAt = identityComponent({ ...identity, field: "logged_at", value: Reflect.get(update, "logged_at") });
  if (loggedAt.isErr()) {
    return err(loggedAt.error);
  }
  const idpId = identityComponent({ ...identity, field: "idp_id", value: Reflect.get(update, "idp_id") });
  if (idpId.isErr()) {
    return err(idpId.error);
  }
  const cfResourceId = identityComponent({
    ...identity,
    field: "cf_resource_id",
    value: Reflect.get(update, "cf_resource_id"),
  });
  if (cfResourceId.isErr()) {
    return err(cfResourceId.error);
  }
  const httpMethod = identityComponent({
    ...identity,
    field: "http_method",
    value: Reflect.get(update, "http_method"),
  });
  if (httpMethod.isErr()) {
    return err(httpMethod.error);
  }
  return ok({
    cf_resource_id: cfResourceId.value,
    http_method: httpMethod.value,
    idp_id: idpId.value,
    logged_at: loggedAt.value,
  });
}

/** One component of a log line's key: the value when it is a non-empty string, else a schema error whose
 * cause tells an ABSENT component (`undefined`/`null`) from a MALFORMED one (any other type, or empty). */
function identityComponent({
  value,
  field,
  line,
  operation,
}: {
  value: unknown;
  field: string;
  line: string;
  operation: string;
}): Result<string, CloudflareClientError> {
  if (value === undefined || value === null) {
    return err(
      CloudflareClientErrors.schema({
        cause: `${line} had no ${field} in the response, and ${field} is part of the key that identifies it`,
        operation,
      }),
    );
  }
  if (typeof value !== "string" || value.length === 0) {
    return err(
      CloudflareClientErrors.schema({
        cause: `${line}'s ${field} was not a non-empty string in the response, so no key can be formed from it`,
        operation,
      }),
    );
  }
  return ok(value);
}
