/**
 * The eight Access ADMINISTRATION readers, each fitting the shared `FlatKindReader` contract
 * `flatKindSpecs.ts` registers.
 *
 * None of these is a `deferred` coverage row, by the owner's ruling — see
 * `model.ts` for the ruling and `projection/zeroTrustAccessLog.ts` for the identity the log kind has to
 * invent. Three of them need something said here rather than discovered:
 *
 * **`access-certificate` folds two independent collections.** mTLS certificates and SAML signing
 * certificates are separate SDK surfaces with separate id spaces, folded into one kind the way
 * `notification-destination` folds webhooks and PagerDuty. Both must succeed: a partial answer would say
 * "these are the Access certificates" while holding one of the two families. Their SHAPES differ too — a
 * SAML row is a certificate SET keyed on `uid` with the active certificate nested under
 * `current_certificate`, not a certificate keyed on `id` — so the reader maps the set's uid and its active
 * certificate's `not_after` onto the shared projection rather than the projection guessing between two
 * layouts. The PEM body is deliberately not carried, the same call `projection/accountCertificate.ts` makes.
 *
 * **`access-gateway-ca` answers 404 when there is no CA, and that is a successful read of nothing.**
 * MEASURED live: `access/gateway_ca` returns `404` with the provider's own code
 * `access.api.error.gateway_ca_not_found` for an account that has never created an SSH certificate
 * authority. Folding that to zero entities and a `synced` cell is the same call `readers/singleton.ts`
 * already makes for a `null` singleton — "we read it, there is nothing there" — and it is narrowed to the
 * TYPED `not-found` kind rather than a message match, so a genuine routing failure still fails.
 *
 * **`access-authentication-log` folds the two log streams** and refuses a line missing a component of its
 * key; its reader is `accessAuthenticationLog.ts`, re-exported here so `flatKindSpecs.ts` registers all eight
 * Access administration readers from one module.
 */
import type Cloudflare from "cloudflare";

import { unsetFieldAsNull } from "#lib/absent.js";

import { err, ok, type Result } from "../../../lib/result.js";
import { mapCloudflareError } from "../client.js";
import { type CloudflareClientError, CloudflareClientErrors } from "../errors.js";
import type { CloudflareEntity } from "../model.js";
import {
  projectCloudflareAccessBookmark,
  projectCloudflareAccessCertificate,
  projectCloudflareAccessCustomPage,
  projectCloudflareAccessGatewayCa,
  projectCloudflareAccessInfrastructureTarget,
  projectCloudflareAccessKeyConfiguration,
  projectCloudflareAccessTag,
} from "../projection/zeroTrustAccessAdmin.js";
import { singletonEntities } from "./singleton.js";

export { readCloudflareAccessAuthenticationLog } from "./accessAuthenticationLog.js";

/**
 * Read every Access tag under the selected account.
 *
 * @param client the constructed Cloudflare client
 * @param accountId the selected account id
 * @param at this run's ISO timestamp
 * @returns every tag's entity, or the reason the read failed
 */
export async function readCloudflareAccessTags({
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
    for await (const tag of client.zeroTrust.access.tags.list({ account_id: accountId })) {
      if (typeof tag.name !== "string" || tag.name.length === 0) {
        return err(
          CloudflareClientErrors.schema({
            cause: "an Access tag had no name in the response, and a tag's name is its provider id",
            operation: "access-tags-list",
          }),
        );
      }
      entities.push(projectCloudflareAccessTag({ accountId, at, tag: { ...tag, name: tag.name } }));
    }
  } catch (cause) {
    return err(mapCloudflareError({ cause, operation: "access-tags-list" }));
  }
  return ok(entities);
}

/**
 * Read every Access App Launcher bookmark under the selected account.
 *
 * @param client the constructed Cloudflare client
 * @param accountId the selected account id
 * @param at this run's ISO timestamp
 * @returns every bookmark's entity, or the reason the read failed
 */
export async function readCloudflareAccessBookmarks({
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
    // Cloudflare has deprecated the whole Bookmarks resource, and it still returns live rows
    // (measured). Not reading a deprecated-but-live surface would be the silent omission the
    // owner's ruling forbids; the deprecation is a fact about the surface, and the day it stops answering
    // this read fails loudly into an `unreadable` cell rather than quietly holding nothing.
    // oxlint-disable-next-line no-deprecated
    for await (const bookmark of client.zeroTrust.access.bookmarks.list({ account_id: accountId })) {
      if (typeof bookmark.id !== "string" || bookmark.id.length === 0) {
        return err(
          CloudflareClientErrors.schema({
            cause: `an Access bookmark named "${bookmark.name}" had no id in the response`,
            operation: "access-bookmarks-list",
          }),
        );
      }
      entities.push(projectCloudflareAccessBookmark({ accountId, at, bookmark: { ...bookmark, id: bookmark.id } }));
    }
  } catch (cause) {
    return err(mapCloudflareError({ cause, operation: "access-bookmarks-list" }));
  }
  return ok(entities);
}

/**
 * Read every Access custom block/denied page under the selected account.
 *
 * @param client the constructed Cloudflare client
 * @param accountId the selected account id
 * @param at this run's ISO timestamp
 * @returns every custom page's entity, or the reason the read failed
 */
export async function readCloudflareAccessCustomPages({
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
    for await (const page of client.zeroTrust.access.customPages.list({ account_id: accountId })) {
      if (typeof page.uid !== "string" || page.uid.length === 0) {
        return err(
          CloudflareClientErrors.schema({
            cause: `an Access custom page named "${page.name}" had no uid in the response`,
            operation: "access-custom-pages-list",
          }),
        );
      }
      entities.push(projectCloudflareAccessCustomPage({ accountId, at, page: { ...page, uid: page.uid } }));
    }
  } catch (cause) {
    return err(mapCloudflareError({ cause, operation: "access-custom-pages-list" }));
  }
  return ok(entities);
}

/**
 * Read both Access certificate collections — mTLS and SAML signing — into one kind.
 *
 * @param client the constructed Cloudflare client
 * @param accountId the selected account id
 * @param at this run's ISO timestamp
 * @returns every certificate's entity across both families, or the reason the first failing read failed
 */
export async function readCloudflareAccessCertificates({
  client,
  accountId,
  at,
}: {
  client: Cloudflare;
  accountId: string;
  at: string;
}): Promise<Result<readonly CloudflareEntity[], CloudflareClientError>> {
  const mtls = await readAccessMtlsCertificates({ accountId, at, client });
  if (mtls.isErr()) {
    return err(mtls.error);
  }
  const saml = await readAccessSamlCertificates({ accountId, at, client });
  if (saml.isErr()) {
    return err(saml.error);
  }
  return ok([...mtls.value, ...saml.value]);
}

/** The mTLS half of `access-certificate` — its own function so the folded reader stays under the
 * function-size cap, not because the two halves are independently useful. */
async function readAccessMtlsCertificates({
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
    for await (const certificate of client.zeroTrust.access.certificates.list({ account_id: accountId })) {
      if (typeof certificate.id !== "string" || certificate.id.length === 0) {
        return err(
          CloudflareClientErrors.schema({
            cause: `an Access mTLS certificate named "${certificate.name}" had no id in the response`,
            operation: "access-certificates-list",
          }),
        );
      }
      entities.push(
        projectCloudflareAccessCertificate({
          accountId,
          at,
          certificate: { ...certificate, id: certificate.id },
          certificateKind: "mtls",
        }),
      );
    }
  } catch (cause) {
    return err(mapCloudflareError({ cause, operation: "access-certificates-list" }));
  }
  return ok(entities);
}

/** The SAML half of `access-certificate`, mapping a certificate SET's uid and its active certificate's
 * expiry onto the shared projection — see this file's header on why the two shapes differ. */
async function readAccessSamlCertificates({
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
    for await (const set of client.zeroTrust.access.samlCertificates.list({ account_id: accountId })) {
      if (typeof set.uid !== "string" || set.uid.length === 0) {
        return err(
          CloudflareClientErrors.schema({
            cause: "an Access SAML certificate set had no uid in the response",
            operation: "access-saml-certificates-list",
          }),
        );
      }
      entities.push(
        projectCloudflareAccessCertificate({
          accountId,
          at,
          certificate: {
            created_at: set.created_at,
            expires_on: samlActiveCertificateExpiry({ set }),
            id: set.uid,
            updated_at: set.updated_at,
          },
          certificateKind: "saml",
        }),
      );
    }
  } catch (cause) {
    return err(mapCloudflareError({ cause, operation: "access-saml-certificates-list" }));
  }
  return ok(entities);
}

/** When a SAML certificate set's ACTIVE certificate expires. The SDK declares `current_certificate`
 * optional, and a set with no active certificate has no expiry; a present one's `not_after` is required. */
function samlActiveCertificateExpiry({
  set,
}: {
  set: { readonly current_certificate?: { readonly not_after: string } };
}): string | null {
  const current = unsetFieldAsNull({ key: "current_certificate", record: set });
  if (current === null) {
    return null;
  }
  return current.not_after;
}

/**
 * Read the account's Access SSH certificate authorities.
 *
 * @param client the constructed Cloudflare client
 * @param accountId the selected account id
 * @param at this run's ISO timestamp
 * @returns every CA's entity, empty when none is configured, or the reason the read failed
 */
export async function readCloudflareAccessGatewayCas({
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
    for await (const ca of client.zeroTrust.access.gatewayCA.list({ account_id: accountId })) {
      if (typeof ca.id !== "string" || ca.id.length === 0) {
        return err(
          CloudflareClientErrors.schema({
            cause: "an Access SSH certificate authority had no id in the response",
            operation: "access-gateway-ca-list",
          }),
        );
      }
      entities.push(projectCloudflareAccessGatewayCa({ accountId, at, ca: { ...ca, id: ca.id } }));
    }
  } catch (cause) {
    const error = mapCloudflareError({ cause, operation: "access-gateway-ca-list" });
    // An account with no SSH CA answers 404, not an empty page — see this file's header for the measurement
    // and for why this is narrowed to the typed kind rather than to the message.
    if (error.kind === "not-found") {
      return ok([]);
    }
    return err(error);
  }
  return ok(entities);
}

/**
 * Read every Access infrastructure target under the selected account.
 *
 * @param client the constructed Cloudflare client
 * @param accountId the selected account id
 * @param at this run's ISO timestamp
 * @returns every target's entity, or the reason the read failed
 */
export async function readCloudflareAccessInfrastructureTargets({
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
    for await (const target of client.zeroTrust.access.infrastructure.targets.list({ account_id: accountId })) {
      if (typeof target.id !== "string" || target.id.length === 0) {
        return err(
          CloudflareClientErrors.schema({
            cause: `an Access infrastructure target for "${target.hostname}" had no id in the response`,
            operation: "access-infrastructure-targets-list",
          }),
        );
      }
      entities.push(
        projectCloudflareAccessInfrastructureTarget({ accountId, at, target: { ...target, id: target.id } }),
      );
    }
  } catch (cause) {
    return err(mapCloudflareError({ cause, operation: "access-infrastructure-targets-list" }));
  }
  return ok(entities);
}

/**
 * Read the account's Access JWT key-rotation configuration singleton.
 *
 * @param client the constructed Cloudflare client
 * @param accountId the selected account id
 * @param at this run's ISO timestamp
 * @returns a one-element array, empty when the provider returns nothing, or why the read failed
 */
export async function readCloudflareAccessKeyConfiguration({
  client,
  accountId,
  at,
}: {
  client: Cloudflare;
  accountId: string;
  at: string;
}): Promise<Result<readonly CloudflareEntity[], CloudflareClientError>> {
  try {
    const configuration = await client.zeroTrust.access.keys.get({ account_id: accountId });
    return ok(
      singletonEntities({
        project: ({ value }) => projectCloudflareAccessKeyConfiguration({ accountId, at, configuration: value }),
        value: configuration,
      }),
    );
  } catch (cause) {
    return err(mapCloudflareError({ cause, operation: "access-keys-get" }));
  }
}
