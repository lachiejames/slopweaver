/**
 * The OAuth client every Google door authenticates with, built from a stored grant.
 *
 * ## Why the transport is replaced, and the measurement that decided it
 *
 * `@googleapis/*` issues its calls through `gaxios`, which by default reaches for its own bundled
 * `node-fetch` rather than the process's global `fetch`. That is invisible in production and fatal to this
 * repo's integration lane: `src/__tests__/setup-polly.ts` records and replays by patching global `fetch`
 * only, and its `nock` guard blocks any other outbound socket in replay. Measured before this file was
 * written — a `users.messages.list` under a patched `globalThis.fetch` reached the real API and the patch
 * observed nothing:
 *
 *     node -e 'globalThis.fetch=async(u)=>{console.log("PATCHED",String(u));return new Response("{}")};
 *       const {gmail}=await import("@googleapis/gmail");const {OAuth2Client}=await import("google-auth-library");
 *       const a=new OAuth2Client({clientId:"x",clientSecret:"y"});a.setCredentials({access_token:"t"});
 *       await gmail({auth:a,version:"v1"}).users.messages.list({userId:"me"}).catch(e=>console.log(e.message))'
 *
 * Pointing the auth client's transport at a `fetchImplementation` that LATE-BINDS `globalThis.fetch` fixes
 * both halves in one line — the API calls and the token refresh both then run through whatever `fetch` is
 * installed at call time. Late binding is the load-bearing part: capturing `globalThis.fetch` by value at
 * construction would pin the pre-Polly implementation and defeat the whole point.
 *
 * ## Refresh, and where the new token lands
 *
 * `OAuth2Client` refreshes on its own when the cached access token is within its skew of expiring, and
 * emits `tokens` when it does. This file subscribes to that and hands the refreshed access token to the
 * caller's own `persist` seam — which is what makes it door-agnostic, since the mail door and the Drive
 * door write different files. A long-lived install then spends one refresh per hour rather than one per
 * invocation. Google does not re-issue a refresh token on refresh, so the stored one is carried forward
 * untouched.
 *
 * ## Why the auth client comes from `googleapis-common`
 *
 * `googleapis-common` re-exports `OAuth2Client` from the copy it vendors, and that is the exact class
 * `@googleapis/gmail` and `@googleapis/drive` type their `auth` option against. Importing it from a
 * separately installed `google-auth-library` instead resolves to a DIFFERENT class with the same name, and
 * the two do not unify: the compiler reports a private-field mismatch on `redirectUri`, which reads as a
 * nonsense error until you notice there are two copies. One import source, no `resolutions` entry, no drift.
 */
import { OAuth2Client } from "googleapis-common";

import type { Result } from "../../lib/result.js";
import type { GoogleGrant } from "../../secrets/googleGrant.js";

/**
 * A `fetch` that resolves `globalThis.fetch` at CALL time rather than at construction time, so a test-time
 * replacement (Polly's adapter) is honoured by a client built before it was installed. Exported for the Gmail client,
 * which wraps it in its write guard (`../gmail/guardedFetch.ts`) rather than capturing a global of its own.
 *
 * @returns the late-binding forwarder
 */
export function lateBoundFetch(): typeof fetch {
  // The parameter list is INHERITED from `typeof fetch` rather than restated, which is both what
  // `named-object-params` asks for and what keeps this wrapper honest if the signature ever changes.
  const forward: typeof fetch = (input, init) => globalThis.fetch(input, init);
  return forward;
}

/**
 * Build an `OAuth2Client` whose API calls AND token refreshes both run over the global `fetch`, handing each
 * refreshed access token to the door's own grant writer.
 *
 * @param grant the stored grant to authenticate as
 * @param clientId the Desktop-app OAuth client id
 * @param clientSecret the Desktop-app OAuth client secret
 * @param persist where a refreshed access token is written back — the door's own bound grant store
 * @returns the configured auth client
 */
export function makeGoogleAuthClient({
  grant,
  clientId,
  clientSecret,
  persist,
}: {
  grant: GoogleGrant;
  clientId: string;
  clientSecret: string;
  persist: (args: { grant: GoogleGrant }) => Result<string>;
}): OAuth2Client {
  const auth = new OAuth2Client({ clientId, clientSecret });
  // Set on the transporter the auth client already built rather than replacing it with a fresh `Gaxios`.
  // Replacing it needs a `Gaxios` CLASS to construct, and the only one in scope comes from a different copy
  // of the package than the one `transporter` is typed against — the same two-copies problem described
  // above, in a second place. Mutating the default reaches the identical option with no import at all, and
  // was verified to route both the refresh and the API call (see the `node -e` probe in this file's header).
  auth.transporter.defaults.fetchImplementation = lateBoundFetch();
  auth.setCredentials({
    refresh_token: grant.refreshToken,
    ...(grant.accessToken !== undefined ? { access_token: grant.accessToken } : {}),
    ...(grant.expiryMs !== undefined ? { expiry_date: grant.expiryMs } : {}),
  });
  auth.on("tokens", (tokens) => {
    if (typeof tokens.access_token !== "string") {
      return;
    }
    // Google does not re-issue a refresh token on refresh, so the stored one is carried forward. A failed
    // write is not allowed to fail the call it rode along with: the token in memory is still valid, and the
    // only cost of not persisting it is one extra refresh next invocation.
    persist({
      grant: {
        ...grant,
        accessToken: tokens.access_token,
        ...(typeof tokens.expiry_date === "number" ? { expiryMs: tokens.expiry_date } : {}),
      },
    });
  });
  return auth;
}
