/**
 * Withdrawing a stored Google grant — the other end of `consent.ts`, and the only thing in this product
 * that retires a scope rather than asking for one.
 *
 * ## Why a withdrawal verb exists at all
 *
 * Google's authorisation server remembers what a client has been granted on an account for as long as the
 * grant stands, and there is no API that gives one scope back. Deleting the grant FILE stops this repo
 * using the credential and leaves the client holding everything it ever approved — so an install that
 * narrowed what it asks for still shows the old, wider approval on
 * <https://myaccount.google.com/permissions>, and a future consent could pick it up again.
 *
 * `POST https://oauth2.googleapis.com/revoke` with the REFRESH token is the one lever: it withdraws the
 * whole `(client, account)` grant at once. That is all-or-nothing by Google's design, which is exactly why
 * it is a deliberate flag and not something a `connect` ever does on its own — on the user-data client, one
 * revocation takes the mail, Drive and calendar grants together, and all three need re-consenting after it.
 *
 * The effect is ordered so a failure leaves the credential usable: Google is asked FIRST, and the file is
 * deleted only once the revocation succeeded. The reverse order would answer "revoked" while leaving a
 * live grant nobody could see. The deletion itself is the STORE's (`secrets/googleGrant.ts`), which is
 * where every other touch of a grant file lives — this module holds no filesystem seam of its own.
 */
import { err, ok, type Result } from "../../lib/result.js";
import type { GoogleGrantStore } from "../../secrets/googleGrant.js";

import type { ConsentErrorFactory } from "./consent.js";
import { GOOGLE_REVOKE_ENDPOINT, parseRevokeResponse, tokenRevokeBody } from "./oauth.js";

/** What one completed revocation withdrew. `undefined` from {@link runGoogleRevoke} means there was none. */
export interface RevokeOutcome {
  /** The account the withdrawn grant was bound to. */
  readonly account: string;
  /** The grant file that was deleted. */
  readonly path: string;
}

/** The one effect {@link runGoogleRevoke} performs beyond the filesystem, injected so the shell is fakeable. */
export interface RevokeDeps<TError> {
  /** POST a form-encoded body and return the raw response text. */
  readonly postForm: (args: { url: string; body: string; operation: string }) => Promise<Result<string, TError>>;
}

/**
 * Withdraw one door's stored grant at Google, then delete the file.
 *
 * @param home the Slopweaver home holding the grant
 * @param store the door's own grant store
 * @param provider the rate-limit registry entry, which also prefixes the operation label
 * @param errors the door's own failure factory
 * @param deps the injected effect seam
 * @returns what was withdrawn, `undefined` when nothing was stored, or the door's typed error
 */
export async function runGoogleRevoke<TError>({
  home,
  store,
  provider,
  errors,
  deps,
}: {
  home: string;
  store: GoogleGrantStore;
  provider: string;
  errors: ConsentErrorFactory<TError>;
  deps: RevokeDeps<TError>;
}): Promise<Result<RevokeOutcome | undefined, TError>> {
  const stored = store.read({ home });
  if (stored.isErr()) {
    return err(errors.consentFailed({ message: stored.error.join("; ") }));
  }
  const grant = stored.value;
  if (grant === undefined) {
    return ok(undefined);
  }
  const path = store.path({ home });
  const posted = await deps.postForm({
    body: tokenRevokeBody({ refreshToken: grant.refreshToken }),
    operation: `${provider}.oauth.revoke`,
    url: GOOGLE_REVOKE_ENDPOINT,
  });
  if (posted.isErr()) {
    return err(posted.error);
  }
  const parsed = parseRevokeResponse({ body: posted.value });
  if (parsed.isErr()) {
    return err(errors.consentFailed({ message: parsed.error.message }));
  }
  const removed = store.remove({ home });
  if (removed.isErr()) {
    return err(errors.consentFailed({ message: `Google withdrew the grant, but ${removed.error.join("; ")}` }));
  }
  return ok({ account: grant.account, path });
}
