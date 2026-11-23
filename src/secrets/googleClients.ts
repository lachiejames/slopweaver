/**
 * The three Google OAuth CLIENT identities this install consents through, and the lines between them.
 *
 * Their own module rather than a section of `config.ts` because the split IS the mechanism carrying the
 * rule — write on the owner's own Gmail, Drive, Docs and calendar, read-only on Google
 * admin — and that argument belongs somewhere a reader arrives at deliberately. Google's incremental
 * authorisation merges granted scopes over the `(client, account)` pair, so no check written in this
 * repository can keep an administrator credential free of a write scope; a SECOND client that has never
 * been shown one is what does.
 *
 * The THIRD client is the Google SecOps door's: `chronicle.readonly` alone, on a
 * client of its own, by least privilege applied to our own setup. Under that one scope
 * merging it into the admin client would be low-harm, but a later wider SecOps scope could never be
 * un-merged from the organisation-wide admin token, so the separation is made before it is load-bearing.
 *
 * Each is read exactly like every other single-line secret, through {@link tokenFromEnvOrHomeFile}. The
 * ACCOUNT grants they authenticate are a different shape entirely and live in their own
 * `secrets/<door>-oauth.json` files ({@link googleGrantStore}).
 */
import { tokenFromEnvOrHomeFile } from "../config.js";

/**
 * The USER-DATA Google OAuth CLIENT id — the mail, Drive and calendar doors: `GOOGLE_CLIENT_ID`, else
 * `$SLOPWEAVER_HOME/secrets/google-client-id`.
 *
 * Not a user credential. It identifies the Desktop-app OAuth application that ASKS for consent, and it is
 * the client that may hold WRITE scopes on the owner's own data — drafting a mail, booking an owned event,
 * creating a Drive file, editing one of the owner's Docs. The Google Workspace ADMIN door consents through a
 * SECOND client ({@link googleAdminClientId}), because Google's incremental authorisation merges granted
 * scopes over the `(client, account)` pair and a single client therefore cannot hold two capability
 * universes at once. The rule: write on gmail/drive/docs/calendar, read-only on Google
 * admin.
 *
 * Each ACCOUNT grant is a different shape entirely and lives in its own `secrets/<door>-oauth.json` (see
 * `src/secrets/googleGrant.ts`). Both must resolve from the SAME home as the grant they authenticate,
 * which is why this takes `home` for the same reason {@link slackBotToken} does.
 *
 * @param home the Slopweaver home (defaults to {@link slopweaverHome})
 * @returns the client id, or undefined when unconfigured
 */
export function googleClientId({ home }: { home?: string } = {}): string | undefined {
  return tokenFromEnvOrHomeFile({
    envNames: ["GOOGLE_CLIENT_ID"],
    secretName: "google-client-id",
    ...(home !== undefined ? { home } : {}),
  });
}

/**
 * The USER-DATA Google OAuth CLIENT secret: `GOOGLE_CLIENT_SECRET`, else
 * `$SLOPWEAVER_HOME/secrets/google-client-secret`. The companion to {@link googleClientId}; a Desktop-app
 * client secret ships with the application rather than identifying a person, which is why the consent flow
 * applies PKCE regardless of it.
 *
 * @param home the Slopweaver home (defaults to {@link slopweaverHome})
 * @returns the client secret, or undefined when unconfigured
 */
export function googleClientSecret({ home }: { home?: string } = {}): string | undefined {
  return tokenFromEnvOrHomeFile({
    envNames: ["GOOGLE_CLIENT_SECRET"],
    secretName: "google-client-secret",
    ...(home !== undefined ? { home } : {}),
  });
}

/**
 * The ADMIN Google OAuth CLIENT id — `atlas google-admin connect` and nothing else:
 * `GOOGLE_ADMIN_CLIENT_ID`, else `$SLOPWEAVER_HOME/secrets/google-admin-client-id`.
 *
 * A SECOND Desktop-app client in the same Cloud project, and the second client is the whole mechanism.
 * Google's incremental authorisation merges over the `(client, account)` pair, so every scope a client has
 * ever been granted on an account can reappear in any later token it is issued, so a readonly admin
 * consent through a client once granted Gmail writes lands a grant carrying them. A client that has never been
 * shown a write scope cannot produce a token carrying one, which is why the separation is a second
 * client rather than a check in this repository's code.
 *
 * The same project is deliberate: the OAuth consent screen and its Data access scope list are per-PROJECT,
 * so the second client inherits the 26 administrator scopes already listed there and needs no second
 * verification.
 *
 * @param home the Slopweaver home (defaults to {@link slopweaverHome})
 * @returns the client id, or undefined when unconfigured
 */
export function googleAdminClientId({ home }: { home?: string } = {}): string | undefined {
  return tokenFromEnvOrHomeFile({
    envNames: ["GOOGLE_ADMIN_CLIENT_ID"],
    secretName: "google-admin-client-id",
    ...(home !== undefined ? { home } : {}),
  });
}

/**
 * Whether the configured admin client id names the SAME OAuth client as the user-data one — the split
 * {@link googleAdminClientId} exists for, collapsed on disk. Two byte-identical files (a second secret added
 * to the one client) would route every admin consent and refresh through the client holding the Gmail
 * writes. The admin door reads the user-data id through this and nothing else,
 * so it can compare against it without ever being able to consent with it.
 *
 * @param home the Slopweaver home (defaults to {@link slopweaverHome})
 * @returns true when both ids are configured and equal
 */
export function googleAdminClientSharesUserDataClient({ home }: { home?: string } = {}): boolean {
  const admin = googleAdminClientId(home !== undefined ? { home } : {});
  return admin !== undefined && admin === googleClientId(home !== undefined ? { home } : {});
}

/**
 * The ADMIN Google OAuth CLIENT secret:`GOOGLE_ADMIN_CLIENT_SECRET`, else
 * `$SLOPWEAVER_HOME/secrets/google-admin-client-secret`. The companion to {@link googleAdminClientId}, on
 * the same terms as {@link googleClientSecret}: it ships with the application, and PKCE is what actually
 * binds an authorisation code to the process that asked for it.
 *
 * @param home the Slopweaver home (defaults to {@link slopweaverHome})
 * @returns the client secret, or undefined when unconfigured
 */
export function googleAdminClientSecret({ home }: { home?: string } = {}): string | undefined {
  return tokenFromEnvOrHomeFile({
    envNames: ["GOOGLE_ADMIN_CLIENT_SECRET"],
    secretName: "google-admin-client-secret",
    ...(home !== undefined ? { home } : {}),
  });
}

/**
 * The SECOPS Google OAuth CLIENT id — `atlas google-secops connect` and nothing else:
 * `GOOGLE_SECOPS_CLIENT_ID`, else `$SLOPWEAVER_HOME/secrets/google-secops-client-id`.
 *
 * A THIRD Desktop-app client in the same Cloud project, for the reason {@link googleAdminClientId} gives:
 * a client that has never been shown a scope cannot be issued a token carrying it. The same project, because
 * the Data access scope list a consent is checked against is per-PROJECT.
 *
 * @param home the Slopweaver home (defaults to {@link slopweaverHome})
 * @returns the client id, or undefined when unconfigured
 */
export function googleSecopsClientId({ home }: { home?: string } = {}): string | undefined {
  return tokenFromEnvOrHomeFile({
    envNames: ["GOOGLE_SECOPS_CLIENT_ID"],
    secretName: "google-secops-client-id",
    ...(home !== undefined ? { home } : {}),
  });
}

/**
 * The SECOPS Google OAuth CLIENT secret: `GOOGLE_SECOPS_CLIENT_SECRET`, else
 * `$SLOPWEAVER_HOME/secrets/google-secops-client-secret`. The companion to {@link googleSecopsClientId}, on
 * the same terms as {@link googleClientSecret}.
 *
 * @param home the Slopweaver home (defaults to {@link slopweaverHome})
 * @returns the client secret, or undefined when unconfigured
 */
export function googleSecopsClientSecret({ home }: { home?: string } = {}): string | undefined {
  return tokenFromEnvOrHomeFile({
    envNames: ["GOOGLE_SECOPS_CLIENT_SECRET"],
    secretName: "google-secops-client-secret",
    ...(home !== undefined ? { home } : {}),
  });
}

/**
 * Whether the configured SecOps client id names the SAME OAuth client as the admin or the user-data one —
 * the collapse {@link googleAdminClientSharesUserDataClient} measured, checked for the third
 * client against both others, because sharing either would merge a SecOps grant into a token it must not
 * ride.
 *
 * @param home the Slopweaver home (defaults to {@link slopweaverHome})
 * @returns true when the SecOps id is configured and equals either other configured id
 */
export function googleSecopsClientSharesAnotherClient({ home }: { home?: string } = {}): boolean {
  const scoped = home !== undefined ? { home } : {};
  const secops = googleSecopsClientId(scoped);
  return secops !== undefined && (secops === googleClientId(scoped) || secops === googleAdminClientId(scoped));
}
