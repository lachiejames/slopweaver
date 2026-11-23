/**
 * Resolving the Knock secret key, and saying honestly when there isn't one.
 *
 * One file under `$SLOPWEAVER_HOME/secrets/`, written by `slopweaver secrets set knock-api-key`, read through
 * `readOwnerOnlyFile` (no-follow, owner-only mode), with no environment fallback — exactly as the Twilio and
 * KnowBe4 doors read theirs. Knock documents its secret keys as `sk_`-prefixed bearer tokens; that prefix is the
 * one shape check, because a publishable `pk_` key pasted by mistake is the likely wrong value and no length or
 * suffix grammar is published.
 */
import { readOwnerOnlyFile } from "../../lib/ownerOnlyFile.js";
import { err, ok, type Result } from "../../lib/result.js";
import { secretFilePath } from "../../stateHome.js";

import { type KnockReadError, KnockReadErrors } from "./errors.js";

/** The secrets-store file holding the Knock secret key. */
export const KNOCK_API_KEY_SECRET = "knock-api-key";

/** A Knock secret key: `sk_` then letters, digits, `_` or `-`. The registry's row and this reader share it. */
export const KNOCK_API_KEY_SHAPE = /^sk_[A-Za-z0-9_-]+$/;

/** The resolved key, only ever handed to the transport. */
export interface KnockCredential {
  /** The `sk_…` secret key. Never rendered. */
  readonly apiKey: string;
}

/**
 * Resolve the key from the secrets store under `home`.
 *
 * @param home the state home whose `secrets/` directory holds the file
 * @returns the key, or the typed reason there is none
 */
export function resolveKnockCredential({ home }: { home: string }): Result<KnockCredential, KnockReadError> {
  const path = secretFilePath({ home, name: KNOCK_API_KEY_SECRET });
  const read = readOwnerOnlyFile({ label: KNOCK_API_KEY_SECRET, path });
  if (read.isErr()) {
    const failure = read.error;
    if (failure.code === "READ_FAILED" && errorCode({ error: failure.cause }) === "ENOENT") {
      return err(KnockReadErrors.tokenMissing());
    }
    if (failure.code === "READ_FAILED" && errorCode({ error: failure.cause }) === "ELOOP") {
      return err(KnockReadErrors.credentialUnreadable({ path, reason: "it is a symlink — re-run the hand step" }));
    }
    return err(KnockReadErrors.credentialUnreadable({ path, reason: failure.message }));
  }
  const apiKey = read.value;
  // Printable ASCII only, refused HERE naming no byte, because the header error `fetch` raises over a bad value
  // quotes the whole value back.
  if (!/^[\x21-\x7E]+$/.test(apiKey)) {
    return err(
      KnockReadErrors.credentialUnreadable({
        path,
        reason: "it holds a character an Authorization header cannot carry — re-run the hand step",
      }),
    );
  }
  if (!KNOCK_API_KEY_SHAPE.test(apiKey)) {
    return err(
      KnockReadErrors.credentialUnreadable({
        path,
        reason: "it is not a Knock secret key (`sk_…`) — a publishable `pk_` key cannot read messages",
      }),
    );
  }
  return ok({ apiKey });
}

/**
 * A caught filesystem error's `code`, when it carries one.
 *
 * @param error the caught value
 * @returns the code, such as `ENOENT`, or `null`
 */
function errorCode({ error }: { error: unknown }): string | null {
  if (typeof error === "object" && error !== null && "code" in error && typeof error.code === "string") {
    return error.code;
  }
  return null;
}
