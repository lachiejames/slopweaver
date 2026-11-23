/**
 * The Access ADMINISTRATION entity shapes and their projections, bar the two log lines.
 *
 * None of these is a `deferred` coverage row: "secondary Access
 * administration that no enforcement question reaches through" is a ground the owner rejected outright, leaving
 * exactly one that survives: volume. Measured against the live account, the eight kinds
 * together fell nowhere near a qualifying volume: the time-series `access-authentication-log` is the largest
 * of them, and the other seven are configuration a reader can hold whole. See `model.ts` for the ruling and `inventory.ts` for the
 * per-kind table. The `access-authentication-log` projections, and the composite identity a log line has to
 * be given because Cloudflare returns none, are in `zeroTrustAccessLog.ts`.
 *
 * ## An identity Cloudflare does not hand you
 *
 * **A tag's id IS its name.** `/accounts/{id}/access/tags/{tag_name}` is the provider's own addressing, so
 * the name is not a mutable label here, it is the key. That is the one place in this atlas where a name is
 * the provider id, and it is the provider's decision rather than this code's.
 *
 * ## Absent fields
 *
 * A field read with `unsetFieldAsNull` is one the SDK declares optional or does not declare at all, so its
 * absence is the provider's to make. The fields read with `??` instead are the ones an SDK response type
 * declares REQUIRED — a custom page's `name` and `type`, a SAML certificate set's `created_at` and
 * `updated_at`, and every infrastructure target field — which stay on the no-silent-fallback debt list until
 * their readers refuse an absent one.
 */
import { unsetFieldAsNull } from "#lib/absent.js";

import type { CloudflareEntity } from "../model.js";
import { accountScopedEntity } from "./accountScopedEntity.js";

/** The authentication-event and SCIM-update projections, kept reachable from this module's path. @internal */
export { projectCloudflareAccessAuthenticationEvent, projectCloudflareAccessScimUpdate } from "./zeroTrustAccessLog.js";

/** The fixed provider id the Access key-rotation singleton is stored under. Not exported: nothing
 * outside this file names it, and the entity it keys is reached through the projection like every other. */
const ACCESS_KEY_CONFIGURATION_ID = "access-key-configuration";

/**
 * Project one Access tag. Its provider id is its name — see this file's header on why that is the
 * provider's addressing rather than a mutable label.
 *
 * @param tag the raw tag, already validated to carry a non-empty `name`
 * @param accountId the account this tag was read under
 * @param at this run's ISO timestamp
 * @returns the projected entity
 */
export function projectCloudflareAccessTag({
  tag,
  accountId,
  at,
}: {
  tag: {
    readonly name: string;
    readonly app_count?: number | null;
    readonly created_at?: string | null;
    readonly updated_at?: string | null;
  };
  accountId: string;
  at: string;
}): CloudflareEntity {
  return accountScopedEntity({
    accountId,
    at,
    detail: {
      appCount: unsetFieldAsNull({ key: "app_count", record: tag }),
      createdAt: unsetFieldAsNull({ key: "created_at", record: tag }),
      kind: "access-tag",
      name: tag.name,
      updatedAt: unsetFieldAsNull({ key: "updated_at", record: tag }),
    },
    kind: "access-tag",
    operation: "access-tags-list",
    providerId: tag.name,
  });
}

/**
 * Project one App Launcher bookmark.
 *
 * @param bookmark the raw bookmark, already validated to carry a non-empty `id`
 * @param accountId the account this bookmark was read under
 * @param at this run's ISO timestamp
 * @returns the projected entity
 */
export function projectCloudflareAccessBookmark({
  bookmark,
  accountId,
  at,
}: {
  bookmark: {
    readonly id: string;
    readonly name?: string | null;
    readonly domain?: string | null;
    readonly app_launcher_visible?: boolean | null;
    readonly created_at?: string | null;
    readonly updated_at?: string | null;
  };
  accountId: string;
  at: string;
}): CloudflareEntity {
  return accountScopedEntity({
    accountId,
    at,
    detail: {
      appLauncherVisible: unsetFieldAsNull({ key: "app_launcher_visible", record: bookmark }),
      createdAt: unsetFieldAsNull({ key: "created_at", record: bookmark }),
      domain: unsetFieldAsNull({ key: "domain", record: bookmark }),
      kind: "access-bookmark",
      name: unsetFieldAsNull({ key: "name", record: bookmark }),
      updatedAt: unsetFieldAsNull({ key: "updated_at", record: bookmark }),
    },
    kind: "access-bookmark",
    operation: "access-bookmarks-list",
    providerId: bookmark.id,
  });
}

/**
 * Project one Access custom page — the HTML a blocked or identity-denied visitor is shown.
 *
 * @param page the raw custom page, already validated to carry a non-empty `uid`
 * @param accountId the account this page was read under
 * @param at this run's ISO timestamp
 * @returns the projected entity
 */
export function projectCloudflareAccessCustomPage({
  page,
  accountId,
  at,
}: {
  page: {
    readonly uid: string;
    readonly name?: string | null;
    readonly type?: string | null;
    readonly app_count?: number | null;
    readonly custom_html?: string | null;
    readonly created_at?: string | null;
    readonly updated_at?: string | null;
  };
  accountId: string;
  at: string;
}): CloudflareEntity {
  return accountScopedEntity({
    accountId,
    at,
    detail: {
      appCount: unsetFieldAsNull({ key: "app_count", record: page }),
      createdAt: unsetFieldAsNull({ key: "created_at", record: page }),
      /** The page body itself, because "what does a blocked visitor see" is the whole question here. */
      customHtml: unsetFieldAsNull({ key: "custom_html", record: page }),
      kind: "access-custom-page",
      name: page.name ?? null,
      type: page.type ?? null,
      updatedAt: unsetFieldAsNull({ key: "updated_at", record: page }),
    },
    kind: "access-custom-page",
    operation: "access-custom-pages-list",
    providerId: page.uid,
  });
}

/**
 * Project one Access certificate — an mTLS certificate or a SAML signing certificate, folded into one kind
 * and told apart by the stored `certificateKind`.
 *
 * @param certificate the raw certificate, already validated to carry a non-empty `id`
 * @param certificateKind which of the two collections this row came from
 * @param accountId the account this certificate was read under
 * @param at this run's ISO timestamp
 * @returns the projected entity
 */
export function projectCloudflareAccessCertificate({
  certificate,
  certificateKind,
  accountId,
  at,
}: {
  certificate: {
    readonly id: string;
    readonly name?: string | null;
    readonly fingerprint?: string | null;
    readonly expires_on?: string | null;
    readonly associated_hostnames?: readonly string[] | null;
    readonly created_at?: string | null;
    readonly updated_at?: string | null;
  };
  certificateKind: "mtls" | "saml";
  accountId: string;
  at: string;
}): CloudflareEntity {
  return accountScopedEntity({
    accountId,
    at,
    detail: {
      associatedHostnames: certificateHostnames({ certificate }),
      certificateKind,
      createdAt: certificate.created_at ?? null,
      expiresOn: unsetFieldAsNull({ key: "expires_on", record: certificate }),
      fingerprint: unsetFieldAsNull({ key: "fingerprint", record: certificate }),
      kind: "access-certificate",
      name: unsetFieldAsNull({ key: "name", record: certificate }),
      updatedAt: certificate.updated_at ?? null,
    },
    kind: "access-certificate",
    operation: certificateKind === "mtls" ? "access-mtls-certificates-list" : "access-saml-certificates-list",
    providerId: certificate.id,
  });
}

/** The hostnames a certificate is associated with, copied. The SDK declares the list optional, and a
 * certificate that names none — every SAML set, which carries no such list — is associated with none. */
function certificateHostnames({
  certificate,
}: {
  certificate: { readonly associated_hostnames?: readonly string[] | null };
}): string[] {
  const hostnames = unsetFieldAsNull({ key: "associated_hostnames", record: certificate });
  if (hostnames === null) {
    return [];
  }
  return [...hostnames];
}

/**
 * Project the account's SSH certificate authority.
 *
 * @param ca the raw certificate authority, already validated to carry a non-empty `id`
 * @param accountId the account this CA was read under
 * @param at this run's ISO timestamp
 * @returns the projected entity
 */
export function projectCloudflareAccessGatewayCa({
  ca,
  accountId,
  at,
}: {
  ca: { readonly id: string; readonly public_key?: string | null };
  accountId: string;
  at: string;
}): CloudflareEntity {
  return accountScopedEntity({
    accountId,
    at,
    detail: {
      kind: "access-gateway-ca",
      /** The PUBLIC half. Cloudflare's read API never returns the private key. */
      publicKey: unsetFieldAsNull({ key: "public_key", record: ca }),
    },
    kind: "access-gateway-ca",
    operation: "access-gateway-ca-list",
    providerId: ca.id,
  });
}

/**
 * Project one infrastructure access target.
 *
 * @param target the raw target, already validated to carry a non-empty `id`
 * @param accountId the account this target was read under
 * @param at this run's ISO timestamp
 * @returns the projected entity
 */
export function projectCloudflareAccessInfrastructureTarget({
  target,
  accountId,
  at,
}: {
  target: {
    readonly id: string;
    readonly hostname?: string | null;
    readonly ip?: unknown;
    readonly created_at?: string | null;
    readonly modified_at?: string | null;
  };
  accountId: string;
  at: string;
}): CloudflareEntity {
  return accountScopedEntity({
    accountId,
    at,
    detail: {
      createdAt: target.created_at ?? null,
      hostname: target.hostname ?? null,
      /** The IPv4/IPv6 addresses and the virtual networks each is reachable on. */
      ip: target.ip ?? null,
      kind: "access-infrastructure-target",
      modifiedAt: target.modified_at ?? null,
    },
    kind: "access-infrastructure-target",
    operation: "access-infrastructure-targets-list",
    providerId: target.id,
  });
}

/**
 * Project the account's Access JWT key-rotation settings into their singleton entity.
 *
 * @param configuration the raw key configuration
 * @param accountId the account this was read under
 * @param at this run's ISO timestamp
 * @returns the projected entity
 */
export function projectCloudflareAccessKeyConfiguration({
  configuration,
  accountId,
  at,
}: {
  configuration: {
    readonly key_rotation_interval_days?: number | null;
    readonly last_key_rotation_at?: string | null;
    readonly days_until_next_rotation?: number | null;
  };
  accountId: string;
  at: string;
}): CloudflareEntity {
  return accountScopedEntity({
    accountId,
    at,
    detail: {
      daysUntilNextRotation: unsetFieldAsNull({ key: "days_until_next_rotation", record: configuration }),
      keyRotationIntervalDays: unsetFieldAsNull({ key: "key_rotation_interval_days", record: configuration }),
      kind: "access-key-configuration",
      lastKeyRotationAt: unsetFieldAsNull({ key: "last_key_rotation_at", record: configuration }),
    },
    kind: "access-key-configuration",
    operation: "access-keys-get",
    providerId: ACCESS_KEY_CONFIGURATION_ID,
  });
}
