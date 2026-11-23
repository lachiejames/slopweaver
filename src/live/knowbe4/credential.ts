/**
 * Resolving the KnowBe4 Reporting API token, and saying honestly when there isn't one.
 *
 * ONE route: `$SLOPWEAVER_HOME/secrets/knowbe4-api-token`, the file `slopweaver secrets set knowbe4-api-token`
 * writes. No environment fallback — a scheduled run has no shell profile to export from, and a second route is
 * one more place a stale token could win.
 *
 * The owner provisions this token personally (the seat never creates or copies an API key),
 * so an absent file is the expected starting state and ends as ONE hand step, {@link KNOWBE4_TOKEN_HAND_STEP}.
 * KnowBe4 has held several Reporting API tokens per account, so the step mints a DEDICATED
 * one: the token Vanta's connector reads is never regenerated, and so never broken.
 */
import { closeSync, constants, fstatSync, openSync, readFileSync, realpathSync } from "node:fs";
import { basename, dirname, join } from "node:path";

import { errorMessage } from "../../lib/errorMessage.js";
import { err, ok, type Result } from "../../lib/result.js";
import { othersCanWrite, othersCanWriteReason } from "../../secrets/store.js";
import { secretFilePath } from "../../stateHome.js";

import { type Knowbe4ReadError, Knowbe4ReadErrors } from "./errors.js";

/** The secrets-store file name the token is written to. */
export const KNOWBE4_API_TOKEN_SECRET = "knowbe4-api-token";

/** The shortest token the reader accepts — far below a real Reporting API JWT, far above any run in a fixed sentence. */
export const KNOWBE4_TOKEN_MIN_LENGTH = 20;

/** The one step only the owner can take when no token is stored: where it is minted, and which file it goes in. */
export const KNOWBE4_TOKEN_HAND_STEP =
  "create a NEW Reporting API token in training.knowbe4.com → Account Settings → Account Integrations → API → " +
  "Reporting API (Create New API Token — never regenerate the existing one, which Vanta's connector reads), then " +
  "run `slopweaver secrets set knowbe4-api-token` and paste it";

/**
 * Resolve the token from the secrets store under `home`.
 *
 * @param home the state home whose `secrets/` directory holds the token
 * @returns the token, or the typed reason there is none
 */
export function resolveKnowbe4Token({ home }: { home: string }): Result<string, Knowbe4ReadError> {
  const path = secretFilePath({ home, name: KNOWBE4_API_TOKEN_SECRET });
  try {
    // The token is read only from a real file in a real secrets directory, never through a symlink to somewhere
    // else: a symlinked directory is refused, and the file is opened no-follow.
    const dir = dirname(path);
    const realDir = realpathSync(dir);
    const realHome = realpathSync(dirname(dir));
    if (realDir !== join(realHome, basename(dir))) {
      return err(
        Knowbe4ReadErrors.credentialUnreadable({ path, reason: `${dir} is a symlink — re-run the hand step` }),
      );
    }
    if (othersCanWrite({ dir: realHome })) {
      return err(Knowbe4ReadErrors.credentialUnreadable({ path, reason: othersCanWriteReason({ dir: realHome }) }));
    }
    const fd = openSync(join(realDir, basename(path)), constants.O_RDONLY | constants.O_NOFOLLOW);
    let raw: string;
    try {
      const stat = fstatSync(fd);
      if (!stat.isFile()) {
        return err(Knowbe4ReadErrors.credentialUnreadable({ path, reason: "it is not a regular file" }));
      }
      // The store's contract is `0600`, and the reader is where it is enforced: a token its group or others can
      // read is refused rather than used.
      if ((stat.mode & 0o077) !== 0) {
        return err(
          Knowbe4ReadErrors.credentialUnreadable({
            path,
            reason: `its mode is ${(stat.mode & 0o777).toString(8)}, not 600, so its group or others can read it — chmod 600 ${path}`,
          }),
        );
      }
      raw = readFileSync(fd, "utf8");
    } finally {
      closeSync(fd);
    }
    const value = raw.trim();
    const refused = tokenShapeRefusal({ value });
    if (refused !== null) {
      return err(Knowbe4ReadErrors.credentialUnreadable({ path, reason: refused }));
    }
    return ok(value);
  } catch (error: unknown) {
    if (isNotFound({ error })) {
      return err(Knowbe4ReadErrors.tokenMissing({ checked: [path] }));
    }
    if (isSymlinkRefused({ error })) {
      return err(Knowbe4ReadErrors.credentialUnreadable({ path, reason: "it is a symlink — re-run the hand step" }));
    }
    return err(Knowbe4ReadErrors.credentialUnreadable({ path, reason: errorMessage({ error }) }));
  }
}

/**
 * Why a stored token's text cannot be used, naming no byte of it, or `null` when it can.
 *
 * @param value the file's contents, trimmed
 * @returns the reason it is refused, or `null`
 */
function tokenShapeRefusal({ value }: { value: string }): string | null {
  if (value.length === 0) {
    return "the file is empty";
  }
  // A bearer token is printable ASCII. Anything else is refused HERE, naming no byte of it, because the header
  // error `fetch` raises over one quotes the whole value back.
  if (!/^[\x21-\x7E]+$/.test(value)) {
    return "the token holds a character an Authorization header cannot carry — re-run the hand step";
  }
  // A Reporting API token is a long signed JWT. A short one is refused because a failure that quotes the token
  // is replaced by a fixed sentence, and a token that short could be a word of that sentence.
  if (value.length < KNOWBE4_TOKEN_MIN_LENGTH) {
    return `the token is shorter than ${String(KNOWBE4_TOKEN_MIN_LENGTH)} characters, which no Reporting API token is — re-run the hand step`;
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
 * @returns `true` when the token path is a symlink
 */
function isSymlinkRefused({ error }: { error: unknown }): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ELOOP";
}
