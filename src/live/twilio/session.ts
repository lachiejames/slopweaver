/**
 * The one place a verb gets a live Twilio read seam from: resolve the key, bind the transport to it and its rate
 * scope, and hand back the account and the seam.
 *
 * Its own module so the three verbs share one credential path and one transport policy — a second construction
 * site is how a header or a scope quietly diverges. The reads underneath take the seam, never the key, so every
 * branch of them stays testable without a network.
 */
import { scopeIdForToken } from "../../lib/providerCall.js";
import { err, ok, type Result } from "../../lib/result.js";
import { resolveTwilioCredentials } from "./credential.js";
import type { TwilioReadError } from "./errors.js";
import { type TwilioGet, twilioGet } from "./transport.js";

/** A bound read seam, and the account its paths are built on. */
export interface TwilioSession {
  readonly accountSid: string;
  readonly get: TwilioGet;
}

/**
 * Open a Twilio read session for this install.
 *
 * @param home the state home whose `secrets/` holds the three Twilio files
 * @returns the session, or the typed reason there is none — `TOKEN_MISSING` is the install's, not Twilio's
 */
export function openTwilioSession({ home }: { home: string }): Result<TwilioSession, TwilioReadError> {
  const credentials = resolveTwilioCredentials({ home });
  if (credentials.isErr()) {
    return err(credentials.error);
  }
  const resolved = credentials.value;
  const scopeId = scopeIdForToken({ token: resolved.keySid });
  return ok({
    accountSid: resolved.accountSid,
    get: ({ url }) => twilioGet({ credentials: resolved, scopeId, url }),
  });
}
