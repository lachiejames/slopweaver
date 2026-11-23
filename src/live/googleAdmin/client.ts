/**
 * The authenticated Google Admin surface, bound to a stored grant.
 *
 * The transport, the refresh and the two-copies-of-`OAuth2Client` trap are all handled once in
 * `src/live/google/authClient.ts`; read that file's header before changing anything about how this
 * authenticates, because every one of those decisions was measured rather than assumed.
 *
 * ## Why this hands back an auth client rather than an SDK surface
 *
 * Every other Google door here resolves to a product SDK — `drive_v3.Drive`, `gmail_v1.Gmail` — because
 * one door means one product. This door serves an ATLAS across FIVE services (`admin.googleapis.com` and
 * four siblings), and the operations it may call are not hand-written at all: they come from
 * `src/atlas/googleAdmin/generated/surfaces.ts`, which carries every method's own base URL, path, verb,
 * parameters and declared scopes, generated from Google's pinned discovery documents. Installing five SDK
 * packages to re-express a table this repository already generates would add five dependencies, five
 * hand-maintained mappings and a second place for the surface to drift — while the generated table is the
 * reviewed boundary by construction.
 *
 * So the door returns the OAuth client and `read.ts` drives one planned call through it. The library is
 * still doing the work libraries should: `OAuth2Client` holds the refresh and the transport, and
 * `src/lib/providerCall.ts` holds the pacing and the retry.
 */
import type { OAuth2Client } from "googleapis-common";

import { err, ok, type Result } from "../../lib/result.js";
import { googleAdminGrantStore } from "../../secrets/googleAdminGrant.js";
import { googleAdminClientId, googleAdminClientSecret } from "../../secrets/googleClients.js";
import { makeGoogleAuthClient } from "../google/authClient.js";
import { missingScopes } from "../google/scopes.js";
import { type GoogleAdminDoorError, GoogleAdminDoorErrors } from "./errors.js";
import { GOOGLE_ADMIN_SCOPE_TABLE, type GoogleAdminCapability } from "./scopes.js";

/**
 * An authenticated Admin surface, plus the facts a caller needs about the grant behind it.
 *
 * @internal — the declared shape of `resolveGoogleAdminClient`'s success value; callers destructure it.
 */
export interface BoundGoogleAdminClient {
  /** The OAuth client every Admin request rides. Named `client` on purpose: the boundary-residue gate watches it. */
  readonly client: OAuth2Client;
  /** The account the grant bound to. */
  readonly account: string;
  /** The scopes the grant ACTUALLY carries, which is what decides which operations may be attempted. */
  readonly scopes: readonly string[];
}

/**
 * Resolve the stored grant, check it against the capabilities a caller needs, and build a bound client.
 *
 * @param home the state home whose grant and client credentials are used
 * @param capabilities every capability the caller needs; an empty list accepts any stored grant, which is
 *   what a surface-wide fill wants — it decides operation by operation from the scopes it gets back
 * @returns the bound client, or the typed reason one could not be built
 */
export function resolveGoogleAdminClient({
  home,
  capabilities,
}: {
  home: string;
  capabilities: readonly GoogleAdminCapability[];
}): Result<BoundGoogleAdminClient, GoogleAdminDoorError> {
  const stored = googleAdminGrantStore.read({ home });
  if (stored.isErr()) {
    return err(GoogleAdminDoorErrors.credentialUnreadable({ message: stored.error.join("; ") }));
  }
  const grant = stored.value;
  if (grant === undefined) {
    return err(GoogleAdminDoorErrors.notConnected());
  }
  const missing = missingScopes({ capabilities, granted: grant.scopes, table: GOOGLE_ADMIN_SCOPE_TABLE });
  if (missing.length > 0) {
    return err(GoogleAdminDoorErrors.scopeMissing({ missing }));
  }
  // The ADMIN pair, never the user-data one. A refresh token is issued to ONE client and only that client
  // can exchange it, so reading `google-client-id` here would fail every refresh on a grant the admin
  // client minted — and, before the split, was what let one client accumulate both capability universes.
  const clientId = googleAdminClientId({ home });
  const clientSecret = googleAdminClientSecret({ home });
  if (clientId === undefined || clientSecret === undefined) {
    return err(
      GoogleAdminDoorErrors.credentialUnreadable({
        message:
          "the Google Admin OAuth client id/secret are not configured — run `slopweaver secrets set " +
          "google-admin-client-id` and `slopweaver secrets set google-admin-client-secret`. This door has its " +
          "OWN client, separate from `google-client-id`, so that no admin consent can carry a write scope",
      }),
    );
  }
  const auth = makeGoogleAuthClient({
    clientId,
    clientSecret,
    grant,
    persist: ({ grant: refreshed }) => googleAdminGrantStore.write({ grant: refreshed, home }),
  });
  return ok({ account: grant.account, client: auth, scopes: grant.scopes });
}
