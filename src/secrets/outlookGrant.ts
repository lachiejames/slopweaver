/**
 * The Outlook mail door's two credentials: the Microsoft app registration's CLIENT id, and the user-consent
 * GRANT `outlook connect` writes.
 *
 * ## Why the grant carries an MSAL cache rather than a refresh token
 *
 * Microsoft's personal-account refresh token ROTATES on every refresh, and a rotated token that is not
 * persisted leaves the next process holding a dead one. MSAL owns that rotation, the account it bound to, and
 * which cached access token is still good — so the grant stores MSAL's own serialized token cache whole
 * (`msalCache`) and lets `acquireTokenSilent` decide, rather than re-implementing the token endpoint here. The
 * door re-serializes the cache after every silent acquisition and writes it back, so a rotation survives.
 *
 * The status fields `secrets status` prints — `account`, `scopes`, `grantedAtIso`, `expiryMs` — sit at the top
 * level on purpose, beside the cache, so the generic grant reader needs nothing Microsoft-specific. The cache is
 * a long-lived credential for the bound mailbox and is never printed, logged or returned by a status call.
 *
 * ## Why the client id is a plain secret and there is no client secret
 *
 * The app registration is a PUBLIC client ("Mobile and desktop applications" platform): it consents with
 * authorization code + PKCE through the loopback listener, and Microsoft issues a public client no secret to
 * keep. The id identifies the application, not the account, so it is the same one-line shape every connector
 * token is and is set with `slopweaver secrets set outlook-client-id`.
 */
import { tokenFromEnvOrHomeFile } from "../config.js";
import type { Result } from "../lib/result.js";
import { secretFilePath } from "../stateHome.js";
import type { SecretsError } from "./errors.js";
import { readGrantFile, removeGrantFile, writeGrantFile } from "./grantFile.js";

/** The grant file's name under `$SLOPWEAVER_HOME/secrets`. */
const OUTLOOK_GRANT_SECRET = "outlook-oauth.json";

/** The app registration's client id, under `$SLOPWEAVER_HOME/secrets`. */
const OUTLOOK_CLIENT_ID_SECRET = "outlook-client-id";

/** The verb that (re)establishes the grant, named in every failure. */
const CONNECT_VERB = "slopweaver outlook connect";

/** How the door names itself to the owner. */
const PRODUCT_NAME = "Outlook";

/** The persisted grant. */
export interface OutlookGrant {
  /** The mailbox address the grant bound to — a personal account's user principal name. */
  readonly account: string;
  /** MSAL's key for that account inside {@link msalCache}, which `acquireTokenSilent` is handed back. */
  readonly homeAccountId: string;
  /** The scopes Microsoft reported granted, which may be narrower than what was asked for. */
  readonly scopes: readonly string[];
  /** When the consent was granted, ISO-8601. */
  readonly grantedAtIso: string;
  /** When the cached access token stops being usable, in epoch milliseconds — status only; MSAL decides. */
  readonly expiryMs?: number;
  /** MSAL's serialized token cache: the refresh token, the access token and the account record. */
  readonly msalCache: string;
}

/** What a status call may report: everything about the grant EXCEPT its cache. */
export interface OutlookGrantStatus {
  readonly account: string;
  readonly scopes: readonly string[];
  readonly grantedAtIso: string;
  readonly path: string;
}

/** Narrow an unknown parsed value to an {@link OutlookGrant}; structural, as `googleGrant.ts`'s guard is. */
function isOutlookGrant(value: unknown): value is OutlookGrant {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const record: Record<string, unknown> = { ...value };
  return (
    typeof record["account"] === "string" &&
    typeof record["homeAccountId"] === "string" &&
    typeof record["msalCache"] === "string" &&
    typeof record["grantedAtIso"] === "string" &&
    Array.isArray(record["scopes"]) &&
    record["scopes"].every((scope) => typeof scope === "string")
  );
}

/** The `readonly string[]` every member answers, matching the Google grant store's members. */
function asLines({ error }: { error: SecretsError }): readonly string[] {
  return [error.message];
}

/**
 * Where the Outlook grant lives under a home.
 *
 * @returns the grant file's absolute path
 */
export function outlookGrantPath({ home }: { home: string }): string {
  return secretFilePath({ home, name: OUTLOOK_GRANT_SECRET });
}

/**
 * Read the stored Outlook grant.
 *
 * @returns the grant, `undefined` when the door was never connected, or why a stored one is unusable
 */
export function readOutlookGrant({ home }: { home: string }): Result<OutlookGrant | undefined> {
  return readGrantFile({
    connectVerb: CONNECT_VERB,
    isGrant: isOutlookGrant,
    path: outlookGrantPath({ home }),
    productName: PRODUCT_NAME,
  }).mapErr((error) => asLines({ error }));
}

/**
 * Persist the Outlook grant owner-only — on consent, and again after every silent acquisition so a rotated
 * refresh token is never lost.
 *
 * @returns the path written, or why the write did not happen
 */
export function writeOutlookGrant({ home, grant }: { home: string; grant: OutlookGrant }): Result<string> {
  return writeGrantFile({ grant, home, path: outlookGrantPath({ home }), productName: PRODUCT_NAME }).mapErr((error) =>
    asLines({ error }),
  );
}

/**
 * Delete the local Outlook grant. Server-side consent stays until withdrawn at
 * `https://account.live.com/consent/Manage`, which a caller says out loud.
 *
 * @returns the path that went, or why it did not
 */
export function removeOutlookGrant({ home }: { home: string }): Result<string> {
  return removeGrantFile({ path: outlookGrantPath({ home }), productName: PRODUCT_NAME }).mapErr((error) =>
    asLines({ error }),
  );
}

/**
 * The token-free view of a stored grant, safe to print into a transcript.
 *
 * @returns the account, scopes, consent instant and file path — never the cache
 */
export function outlookGrantStatus({ home, grant }: { home: string; grant: OutlookGrant }): OutlookGrantStatus {
  return {
    account: grant.account,
    grantedAtIso: grant.grantedAtIso,
    path: outlookGrantPath({ home }),
    scopes: grant.scopes,
  };
}

/**
 * The Microsoft app registration's client id: `OUTLOOK_CLIENT_ID`, else
 * `$SLOPWEAVER_HOME/secrets/outlook-client-id`. Resolved from the same home as the grant it authenticates.
 *
 * @param home the Slopweaver home (defaults to the ambient one)
 * @returns the client id, or undefined when unconfigured
 */
export function outlookClientId({ home }: { home?: string } = {}): string | undefined {
  return tokenFromEnvOrHomeFile({
    envNames: ["OUTLOOK_CLIENT_ID"],
    secretName: OUTLOOK_CLIENT_ID_SECRET,
    ...(home !== undefined ? { home } : {}),
  });
}
