/**
 * The production `revoke` seam every Google door hands the connect shell — built once here rather than
 * four times, on the same argument `connectShell.ts` itself is built on: the doors differ in their client,
 * their grant store and their vocabulary, and in nothing about the mechanism.
 *
 * The client id is resolved LAZILY, per call, because `--home` is a flag: a seam that captured the id when
 * the deps object was constructed would read the operator's own home and then revoke a grant in somebody
 * else's. It is needed for the rate-limit scope and not for the revocation itself — Google's revocation
 * endpoint takes the token alone, with no client authentication at all.
 */
import { err, type Result } from "../../../lib/result.js";
import { productionConsentDeps } from "../../../live/google/consent.js";
import { type RevokeOutcome, runGoogleRevoke } from "../../../live/google/revoke.js";
import type { GoogleGrantStore } from "../../../secrets/googleGrant.js";

import type { GoogleConnectDoor } from "./connectShell.js";

/**
 * Build one door's `revoke` seam.
 *
 * @param door the door's vocabulary and failure factory
 * @param store the door's own grant store
 * @param provider the rate-limit registry entry, which also prefixes the operation label
 * @param productName the door's own name, as the owner would say it
 * @param resolveClientId reads the OAuth client id this door consents through, out of the given home
 * @param clientAbsent the door's own refusal for an unconfigured OAuth client
 * @returns the seam `GoogleConnectDeps.revoke` takes
 */
export function productionRevokeSeam<TError, TCapability extends string>({
  door,
  store,
  provider,
  productName,
  resolveClientId,
  clientAbsent,
}: {
  door: GoogleConnectDoor<TError, TCapability>;
  store: GoogleGrantStore;
  provider: string;
  productName: string;
  resolveClientId: (args: { home: string }) => string | undefined;
  clientAbsent: () => TError;
}): (args: { home: string }) => Promise<Result<RevokeOutcome | undefined, TError>> {
  return async ({ home }) => {
    const clientId = resolveClientId({ home });
    if (clientId === undefined) {
      return err(clientAbsent());
    }
    const consentDeps = productionConsentDeps({
      clientId,
      errors: door,
      productName,
      provider,
      writeLine: () => {
        // Revocation opens no browser and prints no consent URL, so this door's one writer is unused here.
      },
    });
    return runGoogleRevoke({ deps: { postForm: consentDeps.postForm }, errors: door, home, provider, store });
  };
}
