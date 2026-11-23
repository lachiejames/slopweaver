/**
 * The authenticated Google SecOps surface, bound to a stored grant — the Google Admin door's shape
 * (`src/live/googleAdmin/client.ts`), on the THIRD client.
 *
 * It hands back the OAuth client rather than an SDK surface: `@google-cloud/chronicle` exposes every write on
 * the same client and authenticates through application-default credentials, and the operations this door
 * may call are the GET rows of the pinned inventory, driven through `transport.ts`'s one GET.
 */
import type { OAuth2Client } from "googleapis-common";

import { err, ok, type Result } from "../../lib/result.js";
import {
  googleSecopsClientId,
  googleSecopsClientSecret,
  googleSecopsClientSharesAnotherClient,
} from "../../secrets/googleClients.js";
import { googleSecopsGrantStore } from "../../secrets/googleSecopsGrant.js";
import { makeGoogleAuthClient } from "../google/authClient.js";
import { missingScopes } from "../google/scopes.js";
import { type GoogleSecopsDoorError, GoogleSecopsDoorErrors } from "./errors.js";
import { GOOGLE_SECOPS_SCOPE_TABLE, type GoogleSecopsCapability } from "./scopes.js";

/**
 * An authenticated SecOps surface, plus the facts a caller needs about the grant behind it.
 *
 * @internal — the declared shape of `resolveGoogleSecopsClient`'s success value; callers destructure it.
 */
export interface BoundGoogleSecopsClient {
  /** The OAuth client every SecOps request rides. Named `client` on purpose: the boundary-residue gate watches it. */
  readonly client: OAuth2Client;
  /** The account the grant bound to. */
  readonly account: string;
  /** The scopes the grant ACTUALLY carries. */
  readonly scopes: readonly string[];
}

/**
 * The SecOps door's refusal when no SecOps OAuth client of its own is configured — one text, read by the
 * consent, the revoke and the read paths alike.
 *
 * @returns the door's typed credential failure
 */
export function secopsClientAbsent(): GoogleSecopsDoorError {
  return GoogleSecopsDoorErrors.credentialUnreadable({
    message:
      "no Google SecOps OAuth client is configured. This door consents through its own Desktop-app client, " +
      "separate from the mail and admin clients, because Google merges granted scopes over the " +
      "(client, account) pair. Create a THIRD Desktop-app OAuth client in a Cloud project with the Chronicle API enabled, then " +
      "`slopweaver secrets set google-secops-client-id` and `slopweaver secrets set google-secops-client-secret`. " +
      "There is no fallback to either other client",
  });
}

/**
 * Choose the OAuth client the SecOps door consents, refreshes and revokes through, refusing the
 * configurations in which it would not be a client of its own.
 *
 * @param clientId the configured SecOps client id, undefined when unset
 * @param clientSecret the configured SecOps client secret, undefined when unset
 * @param sharesAnotherClient whether that id equals the admin or the user-data client's id
 * @returns the SecOps pair, or the door's credential failure saying which configuration was refused
 */
export function secopsClientPair({
  clientId,
  clientSecret,
  sharesAnotherClient,
}: {
  clientId: string | undefined;
  clientSecret: string | undefined;
  sharesAnotherClient: boolean;
}): Result<{ clientId: string; clientSecret: string }, GoogleSecopsDoorError> {
  if (clientId === undefined || clientSecret === undefined) {
    return err(secopsClientAbsent());
  }
  if (sharesAnotherClient) {
    return err(
      GoogleSecopsDoorErrors.credentialUnreadable({
        message:
          "`google-secops-client-id` names the SAME OAuth client as `google-client-id` or `google-admin-client-id`, " +
          "so a SecOps consent would merge into that client's grant and a revoke would withdraw it. Create a NEW " +
          "Desktop-app OAuth client and set `google-secops-client-id` and `google-secops-client-secret` to its values",
      }),
    );
  }
  return ok({ clientId, clientSecret });
}

/**
 * The SecOps client pair out of one home, compared against that home's other two clients.
 *
 * @param home the state home whose client secrets are read
 * @returns the SecOps pair, or the refusal {@link secopsClientPair} names
 */
export function secopsClientPairIn({ home }: { home: string }): ReturnType<typeof secopsClientPair> {
  return secopsClientPair({
    clientId: googleSecopsClientId({ home }),
    clientSecret: googleSecopsClientSecret({ home }),
    sharesAnotherClient: googleSecopsClientSharesAnotherClient({ home }),
  });
}

/**
 * Resolve the stored grant, check it against the capabilities a caller needs, and build a bound client.
 *
 * @param home the state home whose grant and client credentials are used
 * @param capabilities every capability the caller needs
 * @returns the bound client, or the typed reason one could not be built
 * @internal — the fill verb is its first caller
 */
export function resolveGoogleSecopsClient({
  home,
  capabilities,
}: {
  home: string;
  capabilities: readonly GoogleSecopsCapability[];
}): Result<BoundGoogleSecopsClient, GoogleSecopsDoorError> {
  const stored = googleSecopsGrantStore.read({ home });
  if (stored.isErr()) {
    return err(GoogleSecopsDoorErrors.credentialUnreadable({ message: stored.error.join("; ") }));
  }
  const grant = stored.value;
  if (grant === undefined) {
    return err(GoogleSecopsDoorErrors.notConnected());
  }
  const missing = missingScopes({ capabilities, granted: grant.scopes, table: GOOGLE_SECOPS_SCOPE_TABLE });
  if (missing.length > 0) {
    return err(GoogleSecopsDoorErrors.scopeMissing({ missing }));
  }
  // The SECOPS pair, never another: a refresh token is issued to ONE client and only that client can exchange it.
  const pair = secopsClientPairIn({ home });
  if (pair.isErr()) {
    return err(pair.error);
  }
  const auth = makeGoogleAuthClient({
    clientId: pair.value.clientId,
    clientSecret: pair.value.clientSecret,
    grant,
    persist: ({ grant: refreshed }) => googleSecopsGrantStore.write({ grant: refreshed, home }),
  });
  return ok({ account: grant.account, client: auth, scopes: grant.scopes });
}
