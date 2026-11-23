/**
 * The one place a verb gets a live Knock read seam from: resolve the key, bind the transport to it and its rate
 * scope, and hand back the seam.
 *
 * Its own module so every verb shares one credential path and one transport policy — a second construction site
 * is how a header or a scope quietly diverges. The reads underneath take the seam, never the key, so every branch
 * of them stays testable without a network.
 */
import { scopeIdForToken } from "../../lib/providerCall.js";
import { err, ok, type Result } from "../../lib/result.js";
import { resolveKnockCredential } from "./credential.js";
import type { KnockReadError } from "./errors.js";
import { type KnockGet, knockGet } from "./transport.js";

/** A bound read seam. */
export interface KnockSession {
  readonly get: KnockGet;
}

/**
 * Open a Knock read session for this install.
 *
 * @param home the state home whose `secrets/` holds `knock-api-key`
 * @returns the session, or the typed reason there is none — `TOKEN_MISSING` is the install's, not Knock's
 */
export function openKnockSession({ home }: { home: string }): Result<KnockSession, KnockReadError> {
  const credential = resolveKnockCredential({ home });
  if (credential.isErr()) {
    return err(credential.error);
  }
  const resolved = credential.value;
  const scopeId = scopeIdForToken({ token: resolved.apiKey });
  return ok({ get: ({ operation, url }) => knockGet({ credential: resolved, operation, scopeId, url }) });
}
