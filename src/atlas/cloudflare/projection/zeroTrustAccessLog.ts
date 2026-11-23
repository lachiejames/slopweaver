/**
 * The two Access LOG line projections — authentication events and SCIM provisioning updates, folded into the
 * one `access-authentication-log` kind and told apart by the stored `entryKind`. The other six Access
 * administration shapes are in `zeroTrustAccessAdmin.ts`.
 *
 * ## An identity Cloudflare does not hand you
 *
 * **A log line carries no id at all.** Neither an authentication event nor a SCIM update returns one, so
 * each is keyed on the composite the provider does return: the event's instant plus the fields that make it
 * unique within that instant. That is stable across runs, which is what identity has to be, and it is
 * stated here because a composite key invented by a projection is exactly the kind of thing a later reader
 * has to be able to check. Every component is therefore REQUIRED here: `readers/accessAuthenticationLog.ts`
 * refuses a line missing one with a schema error, rather than keying it on a placeholder that two different
 * lines would share.
 *
 * An authentication event's `ray_id` settles it. **A SCIM update's does not, and the first live sync is
 * what proved that**: MEASURED, the stored SCIM rows carried groups of rows colliding on
 * `(logged_at, idp_id, cf_resource_id, http_method)`. Only SOME of those groups were
 * byte-identical repeats; the rest differ in `request_body` alone — two members added to one group
 * in the same second are two provisioning updates, and a key that merged them would silently drop real
 * records rather than de-duplicate delivered ones. So the body is part of the key, as a 16-hex-character
 * SHA-1 prefix because a raw body is unbounded and a provider id is not. That collapses the repeats and
 * separates the distinct updates, which is what identity is for. Without it `merge.ts` refuses the WHOLE generation:
 * _"this run produced the same entity id twice … refusing to merge"_.
 *
 * ## What a log line holds, and why it is held anyway
 *
 * An authentication event carries the person's email and source address; a SCIM update carries the raw
 * provisioning request body. That is what the surface IS — "who signed in to what, and when" is the question
 * this kind exists to answer, and an atlas that stripped it would hold rows that answer nothing. It lands in
 * `$SLOPWEAVER_HOME`, never in this repository, and no fixture in the test suite is built from a real one.
 */
import { createHash } from "node:crypto";

import { unsetFieldAsNull } from "#lib/absent.js";

import type { CloudflareEntity } from "../model.js";
import { accountScopedEntity } from "./accountScopedEntity.js";

/**
 * Project one Access authentication event. Keyed on its instant plus its Cloudflare ray id, because the
 * surface returns no identifier of its own — see this file's header.
 *
 * @param event the raw authentication event, its two key components already validated as non-empty strings
 * @param accountId the account this event was read under
 * @param at this run's ISO timestamp
 * @returns the projected entity
 */
export function projectCloudflareAccessAuthenticationEvent({
  event,
  accountId,
  at,
}: {
  event: {
    readonly created_at: string;
    readonly ray_id: string;
    readonly user_email?: string | null;
    readonly user_id?: string | null;
    readonly ip_address?: string | null;
    readonly app_uid?: string | null;
    readonly app_name?: string | null;
    readonly app_domain?: string | null;
    readonly app_type?: string | null;
    readonly action?: string | null;
    readonly connection?: string | null;
    readonly allowed?: boolean | null;
    readonly country?: string | null;
  };
  accountId: string;
  at: string;
}): CloudflareEntity {
  return accountScopedEntity({
    accountId,
    at,
    detail: {
      action: unsetFieldAsNull({ key: "action", record: event }),
      allowed: unsetFieldAsNull({ key: "allowed", record: event }),
      appDomain: unsetFieldAsNull({ key: "app_domain", record: event }),
      appName: unsetFieldAsNull({ key: "app_name", record: event }),
      appType: unsetFieldAsNull({ key: "app_type", record: event }),
      appUid: unsetFieldAsNull({ key: "app_uid", record: event }),
      connection: unsetFieldAsNull({ key: "connection", record: event }),
      country: unsetFieldAsNull({ key: "country", record: event }),
      entryKind: "authentication",
      ipAddress: unsetFieldAsNull({ key: "ip_address", record: event }),
      kind: "access-authentication-log",
      loggedAt: event.created_at,
      rayId: event.ray_id,
      userEmail: unsetFieldAsNull({ key: "user_email", record: event }),
      userId: unsetFieldAsNull({ key: "user_id", record: event }),
    },
    kind: "access-authentication-log",
    operation: "access-authentication-events-list",
    providerId: `auth:${event.created_at}:${event.ray_id}`,
  });
}

/**
 * Project one SCIM provisioning update, folded into the same kind as an authentication event and told apart
 * by the stored `entryKind`.
 *
 * @param update the raw SCIM update, its four key components already validated as non-empty strings
 * @param accountId the account this update was read under
 * @param at this run's ISO timestamp
 * @returns the projected entity
 */
export function projectCloudflareAccessScimUpdate({
  update,
  accountId,
  at,
}: {
  update: {
    readonly logged_at: string;
    readonly idp_id: string;
    readonly cf_resource_id: string;
    readonly http_method: string;
    readonly resource_type?: string | null;
    readonly resource_group_name?: string | null;
    readonly status?: string | null;
    readonly request_body?: string | null;
  };
  accountId: string;
  at: string;
}): CloudflareEntity {
  const requestBody = unsetFieldAsNull({ key: "request_body", record: update });
  const providerId = [
    "scim",
    update.logged_at,
    update.idp_id,
    update.cf_resource_id,
    update.http_method,
    // The BODY is part of the key — see this file's header on the collision the first live sync found. It
    // is hashed through `JSON.stringify` rather than coalesced to a string, so an ABSENT body and an empty
    // one hash differently (`null` versus `""`) instead of colliding on the way in.
    createHash("sha1").update(JSON.stringify(requestBody)).digest("hex").slice(0, 16),
  ].join(":");
  return accountScopedEntity({
    accountId,
    at,
    detail: {
      cfResourceId: update.cf_resource_id,
      entryKind: "scim-update",
      httpMethod: update.http_method,
      idpId: update.idp_id,
      kind: "access-authentication-log",
      loggedAt: update.logged_at,
      /** The provisioning payload itself, which is what makes a SCIM update answerable at all. */
      requestBody,
      resourceGroupName: unsetFieldAsNull({ key: "resource_group_name", record: update }),
      resourceType: unsetFieldAsNull({ key: "resource_type", record: update }),
      status: unsetFieldAsNull({ key: "status", record: update }),
    },
    kind: "access-authentication-log",
    operation: "access-scim-updates-list",
    providerId,
  });
}
