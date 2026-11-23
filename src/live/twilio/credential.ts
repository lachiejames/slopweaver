/**
 * Resolving the Twilio API key, and saying honestly when there isn't one.
 *
 * Three files under `$SLOPWEAVER_HOME/secrets/`, each written by `slopweaver secrets set`: the account SID the
 * paths are built on, the API key SID, and the API key secret. Twilio authenticates an API key with HTTP Basic,
 * key SID as the user and secret as the password, so only the secret is credential material; the two SIDs are
 * identifiers that are useless without it. ONE route per file and no environment fallback, exactly as the
 * KnowBe4 door reads its token: a scheduled run has no shell profile, and a second route is one more place a
 * stale key could win.
 *
 * The owner mints the key personally (it is a write in Twilio), so an absent file is the expected starting state
 * and ends as ONE hand step, `TWILIO_KEY_HAND_STEP`. Every file goes through `readOwnerOnlyFile`, which opens
 * no-follow and refuses a mode its group or others can read.
 */
import { readOwnerOnlyFile } from "../../lib/ownerOnlyFile.js";
import { err, ok, type Result } from "../../lib/result.js";
import { secretFilePath } from "../../stateHome.js";

import { type TwilioReadError, TwilioReadErrors } from "./errors.js";

/** The secrets-store file holding the account SID — an identifier, not a credential. */
export const TWILIO_ACCOUNT_SID_SECRET = "twilio-account-sid";

/** The secrets-store file holding the API key SID — the Basic-auth user, an identifier. */
export const TWILIO_API_KEY_SID_SECRET = "twilio-api-key-sid";

/** The secrets-store file holding the API key secret — the one credential of the three. */
export const TWILIO_API_KEY_SECRET_SECRET = "twilio-api-key-secret";

/** The shortest key secret the reader accepts. Twilio's are 32 characters; a short one is a paste gone wrong. */
export const TWILIO_SECRET_MIN_LENGTH = 20;

/** `AC` then 32 lowercase hex — the shape every Twilio account SID has. */
const ACCOUNT_SID = /^AC[0-9a-f]{32}$/;

/** `SK` then 32 lowercase hex — the shape every Twilio API key SID has. */
const KEY_SID = /^SK[0-9a-f]{32}$/;

/** The resolved key, only ever handed to the transport. */
export interface TwilioCredentials {
  /** The account every path is built on. */
  readonly accountSid: string;
  /** The API key SID, the Basic-auth user. */
  readonly keySid: string;
  /** The API key secret, the Basic-auth password. Never rendered. */
  readonly keySecret: string;
}

/**
 * Resolve all three files from the secrets store under `home`.
 *
 * @param home the state home whose `secrets/` directory holds the files
 * @returns the key, or the typed reason there is none — every absent file named at once, so one hand step covers them
 */
export function resolveTwilioCredentials({ home }: { home: string }): Result<TwilioCredentials, TwilioReadError> {
  const names = [TWILIO_ACCOUNT_SID_SECRET, TWILIO_API_KEY_SID_SECRET, TWILIO_API_KEY_SECRET_SECRET] as const;
  const values: string[] = [];
  const missing: string[] = [];
  for (const name of names) {
    const read = readSecret({ home, name });
    if (read.isErr()) {
      return err(read.error);
    }
    if (read.value === null) {
      missing.push(name);
    } else {
      values.push(read.value);
    }
  }
  if (missing.length > 0) {
    return err(TwilioReadErrors.tokenMissing({ missing }));
  }
  const [accountSid, keySid, keySecret] = values;
  if (accountSid === undefined || keySid === undefined || keySecret === undefined) {
    throw new Error("resolveTwilioCredentials: three files read and fewer than three values kept");
  }
  const refused = shapeRefusal({ accountSid, home, keySecret, keySid });
  if (refused !== null) {
    return err(refused);
  }
  return ok({ accountSid, keySecret, keySid });
}

/**
 * Read one secret file, telling an absent file (`null`) from an unusable one (an error).
 *
 * @param home the state home
 * @param name the secret's file name
 * @returns the trimmed value, `null` when the file does not exist, or why it cannot be used
 */
function readSecret({ home, name }: { home: string; name: string }): Result<string | null, TwilioReadError> {
  const path = secretFilePath({ home, name });
  const read = readOwnerOnlyFile({ label: name, path });
  if (read.isOk()) {
    return ok(read.value);
  }
  const failure = read.error;
  if (failure.code === "READ_FAILED" && isNotFound({ error: failure.cause })) {
    return ok(null);
  }
  if (failure.code === "READ_FAILED" && isSymlinkRefused({ error: failure.cause })) {
    return err(TwilioReadErrors.credentialUnreadable({ path, reason: "it is a symlink — re-run the hand step" }));
  }
  return err(TwilioReadErrors.credentialUnreadable({ path, reason: failure.message }));
}

/**
 * Why three present values cannot be used, naming the file and no byte of its contents, or `null` when they can.
 *
 * @param home the state home, so a refusal names the file to fix
 * @param accountSid the account SID file's contents
 * @param keySid the key SID file's contents
 * @param keySecret the key secret file's contents
 * @returns the refusal, or `null`
 */
function shapeRefusal({
  home,
  accountSid,
  keySid,
  keySecret,
}: {
  home: string;
  accountSid: string;
  keySid: string;
  keySecret: string;
}): TwilioReadError | null {
  if (!ACCOUNT_SID.test(accountSid)) {
    return TwilioReadErrors.credentialUnreadable({
      path: secretFilePath({ home, name: TWILIO_ACCOUNT_SID_SECRET }),
      reason: "it is not an account SID (`AC` then 32 hex characters)",
    });
  }
  if (!KEY_SID.test(keySid)) {
    return TwilioReadErrors.credentialUnreadable({
      path: secretFilePath({ home, name: TWILIO_API_KEY_SID_SECRET }),
      reason: "it is not an API key SID (`SK` then 32 hex characters) — an auth token is not an API key",
    });
  }
  const secretPath = secretFilePath({ home, name: TWILIO_API_KEY_SECRET_SECRET });
  // Printable ASCII only, refused HERE naming no byte, because the header error `fetch` raises over a bad value
  // quotes the whole value back.
  if (!/^[\x21-\x7E]+$/.test(keySecret)) {
    return TwilioReadErrors.credentialUnreadable({
      path: secretPath,
      reason: "it holds a character an Authorization header cannot carry — re-run the hand step",
    });
  }
  if (keySecret.length < TWILIO_SECRET_MIN_LENGTH) {
    return TwilioReadErrors.credentialUnreadable({
      path: secretPath,
      reason: `it is shorter than ${String(TWILIO_SECRET_MIN_LENGTH)} characters, which no Twilio key secret is — re-run the hand step`,
    });
  }
  return null;
}

/**
 * Whether a caught filesystem error is an ordinary "no such file".
 *
 * @param error the caught value
 * @returns `true` when the file simply does not exist
 */
function isNotFound({ error }: { error: unknown }): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

/**
 * Whether a caught open error is `O_NOFOLLOW` refusing a symlink — `ELOOP` on Linux and macOS.
 *
 * @param error the caught value
 * @returns `true` when the secret path is a symlink
 */
function isSymlinkRefused({ error }: { error: unknown }): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ELOOP";
}
