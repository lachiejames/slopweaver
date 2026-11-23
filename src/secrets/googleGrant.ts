/**
 * The Google OAuth GRANT store — the shape every user-consent credential in this repo is persisted in.
 *
 * Every static connector here is one line of text: a token typed once and read forever
 * (`src/secrets/store.ts`). A user-consent grant is not that shape. It is a refresh token, the scopes the
 * user actually approved (which may be narrower than what was asked for), the account it bound to, and a
 * short-lived access token that is rewritten on every refresh. So it gets its own owner-only JSON file
 * beside the single-line secrets rather than being crammed into one — `normaliseSecretInput` rejects a
 * multi-line value on purpose, and defeating that to store JSON would weaken the guard that keeps a
 * pasted-with-a-newline token from being written half-empty.
 *
 * ## One store, one file PER DOOR — and the one line the files CANNOT cross
 *
 * Each Google door binds its own grant file: the mail door's `gmail-oauth.json`, the Drive door's
 * `drive-oauth.json`, the Google Admin door's `google-admin-oauth.json`. Each door asks for its own
 * scopes, `connect --status` on one reports that door's own file, and `connect --revoke` on one deletes
 * that door's own file. The cost is one browser round trip per door, paid once.
 *
 * **A file is not a containment boundary, and a CLIENT is.** Google merges granted scopes over the
 * `(client, account)` pair, so every door consenting through one OAuth client converges on the union of
 * what that client was ever granted: a readonly consent through a client that once held write scopes lands
 * a grant carrying them.
 *
 * Two changes carry the rule — write on the owner's own Gmail, Drive, Docs and calendar,
 * read-only on Google admin. The mail, Drive and calendar doors consent through `google-client-id`; the
 * ADMIN door consents through `google-admin-client-id`, a second Desktop-app client in the same Cloud
 * project that has never been shown a write scope. And `oauth.ts`'s `buildConsentUrl` no longer sets
 * `include_granted_scopes`, so a grant file equals its own consent screen.
 *
 * Four rails hold it, all in `src/__tests__/unit/live/google/actsOnlyAsTheBoundAccount.test.ts` rather
 * than asserted here: nothing may send mail as another person, no Drive scope may reach a file this
 * application did not create, the admin door resolves the admin client and never the user-data one, and no
 * consent URL asks Google to merge granted scopes.
 *
 * What the per-door FILES buy remains narrow, and is worth saying plainly: which door asks for what, which
 * file a status call reports, and which file a revocation deletes. Withdrawal itself is per CLIENT — one
 * `--revoke` withdraws every door sharing that client, because that is Google's own shape.
 *
 * ## What is and is not in a grant file
 *
 * The refresh token is a long-lived credential for the bound account: anyone holding the file can read
 * (and, at the granted scopes, write) that account's data until the grant is revoked at
 * <https://myaccount.google.com/permissions>. It is written `0600` under the `0700` `secrets/` directory,
 * on the same terms as every other connector token, and is NEVER logged, printed, or returned by a status
 * call — {@link GoogleGrantStatus} carries the account, the scopes, when the grant landed and, when Google named
 * one, when its refresh token lapses, and no token material.
 *
 * The OAuth CLIENT id and secret are separate single-line secrets, because they are exactly that shape and
 * because a Google "Desktop app" client secret is not a user credential: it identifies the application, not
 * the account. There are TWO pairs — `google-client-id`/`google-client-secret` for the user-data doors and
 * `google-admin-client-id`/`google-admin-client-secret` for the Admin door — and each is named for the
 * half of the install it serves rather than for any one product.
 */
import { parseStrictIsoInstantMs } from "#lib/date.js";

import type { Result } from "../lib/result.js";
import { secretFilePath } from "../stateHome.js";
import type { SecretsError } from "./errors.js";
import { readGrantFile, removeGrantFile, writeGrantFile } from "./grantFile.js";

/** The persisted grant. `accessToken`/`expiryMs` are a cache — the refresh token is what actually matters. */
export interface GoogleGrant {
  /** The account the grant was bound to, from the `userinfo.email` scope. */
  readonly account: string;
  /** The scope URIs the user ACTUALLY approved, which may be narrower than what was requested. */
  readonly scopes: readonly string[];
  /** The long-lived credential. Google issues it once, on the first consent for a client. */
  readonly refreshToken: string;
  /** The cached short-lived token, absent until the first call refreshes one. */
  readonly accessToken?: string;
  /** When {@link accessToken} stops being usable, in epoch milliseconds. */
  readonly expiryMs?: number;
  /** When the consent was granted, ISO-8601 — so a status report can say how old the grant is. */
  readonly grantedAtIso: string;
  /**
   * When {@link refreshToken} stops working, ISO-8601 — present only when Google said so at consent, which it does
   * for a client whose consent screen is in Testing (seven days). Absent for a Production client and for every
   * grant written before this was read (`src/live/google/refreshLapse.ts`).
   */
  readonly refreshTokenExpiresAtIso?: string;
}

/** What a status call may report: everything about the grant EXCEPT its token material. */
export interface GoogleGrantStatus {
  readonly account: string;
  readonly scopes: readonly string[];
  readonly grantedAtIso: string;
  readonly path: string;
  /** When the refresh token lapses, only when the grant recorded one. Not token material. */
  readonly refreshTokenExpiresAtIso?: string;
}

/**
 * One door's bound grant store. Every function is already carrying that door's filename and its own
 * vocabulary, so a caller never repeats either and two doors cannot drift apart on the message they print.
 *
 * @internal — the declared shape {@link googleGrantStore} returns; callers reach its members directly.
 */
export interface GoogleGrantStore {
  /** Where this door's grant file lives under a given home. */
  readonly path: (args: { home: string }) => string;
  /** Persist a completed grant, returning the path it was written to. */
  readonly write: (args: { home: string; grant: GoogleGrant }) => Result<string>;
  /** Read the grant back — `undefined` when none is stored, an error when a stored one will not parse. */
  readonly read: (args: { home: string }) => Result<GoogleGrant | undefined>;
  /** The token-free view of a stored grant, safe to print into a transcript. */
  readonly status: (args: { home: string; grant: GoogleGrant }) => GoogleGrantStatus;
  /**
   * Delete this door's grant file, returning the path that went. The file's whole lifecycle lives here
   * rather than in the caller that withdrew the grant at Google, so the one module holding a refresh token
   * is also the one module that removes it — and the direct filesystem seam stays inside the sanctioned
   * store rather than spreading to a second file.
   */
  readonly remove: (args: { home: string }) => Result<string>;
}

/**
 * Narrow an unknown parsed value to a {@link GoogleGrant}. Deliberately structural rather than a Zod schema:
 * this file is read on every Google door call, and the shape is five fields the writer below is the only
 * producer of, so a schema would be ceremony over a hand-written guard that reads exactly as clearly.
 */
function isGrant(value: unknown): value is GoogleGrant {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const record: Record<string, unknown> = { ...value };
  const lapse = record["refreshTokenExpiresAtIso"];
  // Absent is every grant written before the lapse was read; present must be an instant, or the lapse check
  // would read a corrupt value as a grant that never lapses.
  const lapseReadable =
    lapse === undefined || (typeof lapse === "string" && parseStrictIsoInstantMs({ text: lapse }) !== undefined);
  return (
    typeof record["account"] === "string" &&
    typeof record["refreshToken"] === "string" &&
    typeof record["grantedAtIso"] === "string" &&
    Array.isArray(record["scopes"]) &&
    record["scopes"].every((scope) => typeof scope === "string") &&
    lapseReadable
  );
}

/** The `readonly string[]` a {@link GoogleGrantStore} member has always returned — the one boundary it is mapped at. */
function asLines({ error }: { error: SecretsError }): readonly string[] {
  return [error.message];
}

/**
 * Bind a grant store to one door's file and vocabulary.
 *
 * @param secretName the grant's filename under `$SLOPWEAVER_HOME/secrets`
 * @param productName how the door names itself to the owner ("Gmail", "Google Drive")
 * @param connectVerb the command that re-establishes the grant, named in every failure message
 * @returns the bound store
 */
export function googleGrantStore({
  secretName,
  productName,
  connectVerb,
}: {
  secretName: string;
  productName: string;
  connectVerb: string;
}): GoogleGrantStore {
  const pathFor = ({ home }: { home: string }): string => secretFilePath({ home, name: secretName });
  return {
    path: pathFor,
    read: ({ home }) =>
      readGrantFile({ connectVerb, isGrant, path: pathFor({ home }), productName }).mapErr((error) =>
        asLines({ error }),
      ),
    remove: ({ home }) =>
      removeGrantFile({ path: pathFor({ home }), productName }).mapErr((error) => asLines({ error })),
    status: ({ home, grant }) => ({
      account: grant.account,
      grantedAtIso: grant.grantedAtIso,
      path: pathFor({ home }),
      scopes: grant.scopes,
      ...(grant.refreshTokenExpiresAtIso === undefined
        ? {}
        : { refreshTokenExpiresAtIso: grant.refreshTokenExpiresAtIso }),
    }),
    write: ({ home, grant }) =>
      writeGrantFile({ grant, home, path: pathFor({ home }), productName }).mapErr((error) => asLines({ error })),
  };
}
