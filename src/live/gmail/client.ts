/**
 * The Gmail SDK client, bound to a stored grant.
 *
 * The transport, the refresh and the two-copies-of-`OAuth2Client` trap are all handled once in
 * `src/live/google/authClient.ts`; read that file's header before changing anything about how this
 * authenticates, because every one of those decisions was measured rather than assumed. What is this file's
 * own is the narrow part: resolve the MAIL grant, check it against the capabilities the calling verb needs,
 * and hand back a `gmail_v1` surface.
 *
 * ## The one place the Gmail SDK is constructed, and why that is the write guard
 *
 * Before `gmail(...)` is built, the auth client's transport `fetch` becomes `./guardedFetch.ts`'s guard over the
 * late-bound global, carrying a privacy capability built from the `home` THIS call was given — the verb's own. So
 * every Gmail write any verb sends is judged under that verb's home, reads pass untouched, and no verb can forget the
 * guard. Nothing else in production calls `gmail(...)`; `src/__tests__/unit/live/gmail/constructionCensus.test.ts`
 * holds that. Calendar builds its own auth client and does not inherit this guard.
 */
import { gmail, type gmail_v1 } from "@googleapis/gmail";
import type { OAuth2Client } from "googleapis-common";

import { err, ok, type Result } from "../../lib/result.js";
import { gmailWritePrivacy } from "../../outbound/gmail/writePrivacy.js";
import { gmailGrantStore } from "../../secrets/gmailGrant.js";
import { googleClientId, googleClientSecret } from "../../secrets/googleClients.js";
import { lateBoundFetch, makeGoogleAuthClient } from "../google/authClient.js";
import { missingScopes } from "../google/scopes.js";
import { type GmailError, GmailErrors } from "./errors.js";
import { type GmailFetch, guardedGmailFetch } from "./guardedFetch.js";
import { GMAIL_SCOPE_TABLE, type GmailCapability } from "./scopes.js";

/**
 * A Gmail client bound to one grant, plus the facts a caller needs about that grant.
 *
 * @internal — the declared shape of `resolveGmailClient`'s success value; callers destructure it.
 */
export interface BoundGmailClient {
  /** The `@googleapis/gmail` surface. Named `client` on purpose: the boundary-residue gate watches it. */
  readonly client: gmail_v1.Gmail;
  /** The mailbox the grant bound to. */
  readonly account: string;
  /** The scopes the grant actually carries. */
  readonly scopes: readonly string[];
  /**
   * The OAuth client itself, so a caller can build a SECOND Google surface on the same grant.
   *
   * Exposed for one caller — {@link ./docs.makeGoogleDocsApi}, which reads the Google Doc a Gemini
   * meeting-notes email links. Exposing the auth client rather than adding a `docs` field here keeps this
   * function about resolving a GRANT: it authenticates, and what is built on top is the caller's business.
   */
  readonly auth: OAuth2Client;
}

/**
 * Resolve the stored grant, check it against the capabilities a verb needs, and build a bound client.
 *
 * @param home the state home whose grant and client credentials are used, and whose private terms judge every write
 * @param capabilities every capability the calling verb needs
 * @param transport the `fetch` under the write guard: the late-bound global when omitted, a counting one in a test
 * @returns the bound client, or the typed reason one could not be built
 */
export function resolveGmailClient({
  home,
  capabilities,
  transport,
}: {
  home: string;
  capabilities: readonly GmailCapability[];
  transport?: GmailFetch | undefined;
}): Result<BoundGmailClient, GmailError> {
  const stored = gmailGrantStore.read({ home });
  if (stored.isErr()) {
    return err(GmailErrors.credentialUnreadable({ message: stored.error.join("; ") }));
  }
  const grant = stored.value;
  if (grant === undefined) {
    return err(GmailErrors.notConnected());
  }
  const missing = missingScopes({ capabilities, granted: grant.scopes, table: GMAIL_SCOPE_TABLE });
  if (missing.length > 0) {
    return err(GmailErrors.scopeMissing({ missing }));
  }
  const clientId = googleClientId({ home });
  const clientSecret = googleClientSecret({ home });
  if (clientId === undefined || clientSecret === undefined) {
    return err(
      GmailErrors.credentialUnreadable({
        message:
          "the Gmail OAuth client id/secret are not configured — run `slopweaver secrets set google-client-id` and " +
          "`slopweaver secrets set google-client-secret`",
      }),
    );
  }
  const auth = makeGoogleAuthClient({
    clientId,
    clientSecret,
    grant,
    persist: ({ grant: refreshed }) => gmailGrantStore.write({ grant: refreshed, home }),
  });
  const client = guardedGmailSdk({ account: grant.account, auth, home, transport });
  return ok({ account: grant.account, auth, client, scopes: grant.scopes });
}

/**
 * Install the write guard on an auth client's transport, judging under `home`, and only then build the Gmail SDK on
 * it. The one production call of `gmail(...)`; the integration lane, which builds its auth from a cassette grant
 * rather than a stored one, calls this too.
 *
 * @param auth the OAuth client the SDK authenticates with; its transport `fetch` is replaced by the guard
 * @param account the mailbox the grant is bound to, which a held write's key covers
 * @param home the state home whose private terms judge every write
 * @param transport the `fetch` under the guard: the late-bound global when omitted
 * @returns the guarded `gmail_v1` surface
 */
export function guardedGmailSdk({
  auth,
  account,
  home,
  transport,
}: {
  auth: OAuth2Client;
  account: string;
  home: string;
  transport?: GmailFetch | undefined;
}): gmail_v1.Gmail {
  let underlying = lateBoundFetch();
  if (transport !== undefined) {
    underlying = transport;
  }
  auth.transporter.defaults.fetchImplementation = guardedGmailFetch({
    fetch: underlying,
    privacy: { ...gmailWritePrivacy({ home }), principal: account },
  });
  return gmail({ auth, version: "v1" });
}
