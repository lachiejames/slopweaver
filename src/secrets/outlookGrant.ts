/**
 * The Microsoft doors' credentials: the app registration's CLIENT id, shared, and one user-consent GRANT per
 * product — the mail grant `outlook connect` writes and the calendar grant `outlook-calendar connect` writes.
 *
 * ## Why mail and calendar are two files
 *
 * They are two integrations with two consents. Someone may connect their calendar and not their mail, or the
 * reverse, so neither consent screen asks for the other product's permission, and each grant lives in its own
 * file with its own refresh lock: revoking one leaves the other working, and `connect --status` on either
 * reports only what that door can reach. The Google doors are split the same way (`calendarGrant.ts`).
 *
 * ## Why a grant carries an MSAL cache rather than a refresh token
 *
 * Microsoft's personal-account refresh token ROTATES on every refresh, and a rotated token that is not
 * persisted leaves the next process holding a dead one. MSAL owns that rotation, the account it bound to, and
 * which cached access token is still good — so a grant stores MSAL's own serialized token cache whole
 * (`msalCache`) and lets `acquireTokenSilent` decide, rather than re-implementing the token endpoint here. The
 * door re-serializes the cache after every silent acquisition and writes it back, so a rotation survives.
 *
 * The status fields `secrets status` prints — `account`, `scopes`, `grantedAtIso`, `expiryMs` — sit at the top
 * level on purpose, beside the cache, so the generic grant reader needs nothing Microsoft-specific. The cache is
 * a long-lived credential for the bound account and is never printed, logged or returned by a status call.
 *
 * ## Why the client id is a plain secret and there is no client secret
 *
 * The app registration is a PUBLIC client ("Mobile and desktop applications" platform): it consents with
 * authorization code + PKCE through the loopback listener, and Microsoft issues a public client no secret to
 * keep. The id identifies the application, not the account, so it is the same one-line shape every connector
 * token is and is set with `slopweaver secrets set outlook-client-id`. Both products consent through it.
 */
import { tokenFromEnvOrHomeFile } from "../config.js";
import type { Result } from "../lib/result.js";
import { secretFilePath } from "../stateHome.js";
import type { SecretsError } from "./errors.js";
import { readGrantFile, removeGrantFile, writeGrantFile } from "./grantFile.js";

/** The app registration's client id, under `$SLOPWEAVER_HOME/secrets`. */
const OUTLOOK_CLIENT_ID_SECRET = "outlook-client-id";

/** The mail grant's file name under `$SLOPWEAVER_HOME/secrets`. */
export const OUTLOOK_MAIL_GRANT_SECRET = "outlook-oauth.json";

/** The calendar grant's file name under `$SLOPWEAVER_HOME/secrets`. */
export const OUTLOOK_CALENDAR_GRANT_SECRET = "outlook-calendar-oauth.json";

/** A persisted Microsoft grant, the same shape for either product. */
export interface OutlookGrant {
  /** The address the grant bound to — a personal account's user principal name. */
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

/**
 * One Microsoft product's bound grant store. Every member already carries that product's file, lock and
 * vocabulary, so a caller never repeats them and the two products cannot drift apart on what they print.
 */
export interface OutlookGrantStore {
  /** Which Microsoft product this grant belongs to — the `OutlookProduct` of `live/outlook/scopes.ts`. */
  readonly product: "mail" | "calendar";
  /** The command that (re)establishes this grant, named in every failure. */
  readonly connectVerb: string;
  /** The operation-lock key every refresh, consent and disconnect of this grant takes. */
  readonly lockKey: string;
  /** How the door names itself to the owner. */
  readonly productName: string;
  /** Where this grant lives under a home. */
  readonly path: (args: { home: string }) => string;
  /** The grant, `undefined` when never connected, or why a stored one is unusable. */
  readonly read: (args: { home: string }) => Result<OutlookGrant | undefined>;
  /** Persist owner-only — on consent, and after every silent acquisition so a rotation is never lost. */
  readonly write: (args: { home: string; grant: OutlookGrant }) => Result<string>;
  /** Delete the local grant. Server-side consent stays until withdrawn, which a caller says out loud. */
  readonly remove: (args: { home: string }) => Result<string>;
  /** The token-free view of a stored grant, safe to print into a transcript. */
  readonly status: (args: { home: string; grant: OutlookGrant }) => OutlookGrantStatus;
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
 * Bind a grant store to one Microsoft product's file, lock and vocabulary.
 *
 * @param secretName the grant's file name under `$SLOPWEAVER_HOME/secrets`
 * @param productName how the door names itself to the owner ("Outlook", "Outlook Calendar")
 * @param connectVerb the command that re-establishes the grant, named in every failure message
 * @param lockKey the operation-lock key that serialises this grant's refreshes and replacements
 * @param product which Microsoft product the grant belongs to
 * @returns the bound store
 */
function outlookGrantStore({
  secretName,
  productName,
  connectVerb,
  lockKey,
  product,
}: {
  secretName: string;
  productName: string;
  connectVerb: string;
  lockKey: string;
  product: "mail" | "calendar";
}): OutlookGrantStore {
  const pathFor = ({ home }: { home: string }): string => secretFilePath({ home, name: secretName });
  return {
    connectVerb,
    lockKey,
    path: pathFor,
    product,
    productName,
    read: ({ home }) =>
      readGrantFile({ connectVerb, isGrant: isOutlookGrant, path: pathFor({ home }), productName }).mapErr((error) =>
        asLines({ error }),
      ),
    remove: ({ home }) =>
      removeGrantFile({ path: pathFor({ home }), productName }).mapErr((error) => asLines({ error })),
    status: ({ home, grant }) => ({
      account: grant.account,
      grantedAtIso: grant.grantedAtIso,
      path: pathFor({ home }),
      scopes: grant.scopes,
    }),
    write: ({ home, grant }) =>
      writeGrantFile({ grant, home, path: pathFor({ home }), productName }).mapErr((error) => asLines({ error })),
  };
}

/** The mail grant, `outlook-oauth.json`, written by `outlook connect`. */
export const outlookMailGrantStore: OutlookGrantStore = outlookGrantStore({
  connectVerb: "slopweaver outlook connect",
  lockKey: "outlook-grant-refresh",
  product: "mail",
  productName: "Outlook",
  secretName: OUTLOOK_MAIL_GRANT_SECRET,
});

/** The calendar grant, `outlook-calendar-oauth.json`, written by `outlook-calendar connect`. */
export const outlookCalendarGrantStore: OutlookGrantStore = outlookGrantStore({
  connectVerb: "slopweaver outlook-calendar connect",
  lockKey: "outlook-calendar-grant-refresh",
  product: "calendar",
  productName: "Outlook Calendar",
  secretName: OUTLOOK_CALENDAR_GRANT_SECRET,
});

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
