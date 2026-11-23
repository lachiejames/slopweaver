/**
 * Decrypting one cookie value out of the owner's REAL Chrome cookie jar — the pure half, with no keychain,
 * no filesystem and no SQLite anywhere in it.
 *
 * ## Why this file exists at all
 *
 * The owner's real work Chrome is the only browser anything here may use, and a dedicated
 * Playwright profile under `$SLOPWEAVER_HOME` is not a security boundary — "the security boundary you're
 * setting is just theatre given you could always just open a claude in chrome as me already on any page and
 * click as me". `docs/browser-route.md` carries the whole ruling, and
 * `docs/browser-route/screenshot-reading-and-retirement.md` what it retired.
 *
 * One consequence is mechanical rather than editorial. A pipeline that needs a signed-in **cookie** and no
 * rendered page — `github attach`'s upload endpoints are the only one — used to obtain it by launching a
 * Chromium against its own profile directory and asking the owner to sign in. The owner's real Chrome is already
 * signed in to every one of those sites, all day, so the cookie is a READ rather than a login. This module
 * is that read's cryptography.
 *
 * ## The format, measured rather than assumed
 *
 * On macOS, a Chrome cookie's `encrypted_value` is `v10` + AES-128-CBC ciphertext, the key is
 * PBKDF2-HMAC-SHA1 over the `Chrome Safe Storage` keychain password with the salt `saltysalt` and 1003
 * iterations, and the IV is sixteen spaces. Since Chrome 130 the PLAINTEXT is prefixed with a 32-byte
 * digest, and that digest is `sha256(host_key)` — verified, not inferred, so this module CHECKS it instead
 * of stripping 32 bytes and hoping. A jar whose prefix does not match its own row's host is refused.
 *
 * Reproduce the whole format on this machine, without printing a credential
 * (`logged_in` is `yes` on a signed-in profile and `no` otherwise):
 *
 * ```bash
 * slopweaver browser cookies --origin https://github.com --json
 * ```
 */
import { createDecipheriv, createHash, pbkdf2Sync } from "node:crypto";

import { err, ok, type Result } from "../lib/result.js";
import { type RealChromeError, RealChromeErrors } from "./errors.js";

/** The version prefixes this module knows how to read. `v11` is the Linux variant of the same scheme. */
const KNOWN_PREFIXES: ReadonlySet<string> = new Set(["v10", "v11"]);

/** Chrome's own fixed PBKDF2 salt on every desktop platform. */
const SALT = "saltysalt";

/** Chrome's own key length, in bytes — AES-128. */
const KEY_BYTES = 16;

/** Chrome's own CBC initialisation vector: sixteen spaces. */
const IV = Buffer.alloc(16, 0x20);

/**
 * macOS's iteration count. Chrome uses 1003 there and 1 on Linux, which is why the count is derived from
 * the platform rather than being a single constant.
 */
const MACOS_ITERATIONS = 1003;

/** Linux's iteration count, for the `v11` jar a Linux install would present. */
const LINUX_ITERATIONS = 1;

/** How many leading plaintext bytes Chrome 130+ spends on the domain digest. */
const DOMAIN_DIGEST_BYTES = 32;

/**
 * Derive the AES key from the platform keyring password.
 *
 * @param password the `Chrome Safe Storage` secret, exactly as the keyring returned it
 * @param platform `process.platform`, which selects Chrome's own iteration count
 * @returns the 16-byte key
 */
export function deriveCookieKey({ password, platform }: { password: string; platform: string }): Buffer {
  const iterations = platform === "darwin" ? MACOS_ITERATIONS : LINUX_ITERATIONS;
  return pbkdf2Sync(password, SALT, iterations, KEY_BYTES, "sha1");
}

/**
 * Decrypt one row's `encrypted_value`, verifying that the plaintext's own domain digest matches the host
 * the row was filed under.
 *
 * The digest check is the reason this returns a `Result` rather than a string: a value that decrypts to
 * bytes bound to a DIFFERENT host is not a cookie for the origin the caller asked about, and silently
 * handing it over is how a jar read becomes a wrong `Cookie` header. Never includes a plaintext value in
 * any error it returns.
 *
 * @param encrypted the raw `encrypted_value` blob
 * @param hostKey the row's own `host_key`, which the plaintext digest must match
 * @param key the derived AES key
 * @returns the cookie's value, or why the row could not be read
 */
export function decryptCookieValue({
  encrypted,
  hostKey,
  key,
}: {
  encrypted: Buffer;
  hostKey: string;
  key: Buffer;
}): Result<string, RealChromeError> {
  const prefix = encrypted.subarray(0, 3).toString("latin1");
  if (!KNOWN_PREFIXES.has(prefix)) {
    return err(RealChromeErrors.jarUnreadable({ detail: `a cookie value carries the unknown prefix ${prefix}` }));
  }
  let padded: Buffer;
  try {
    const decipher = createDecipheriv("aes-128-cbc", key, IV);
    decipher.setAutoPadding(false);
    padded = Buffer.concat([decipher.update(encrypted.subarray(3)), decipher.final()]);
  } catch (cause: unknown) {
    return err(RealChromeErrors.jarUnreadable({ detail: cause instanceof Error ? cause.message : String(cause) }));
  }
  const unpadded = stripPkcs7({ padded });
  if (unpadded === undefined) {
    return err(RealChromeErrors.keyWrong());
  }
  if (unpadded.length < DOMAIN_DIGEST_BYTES) {
    return ok(unpadded.toString("utf8"));
  }
  const expected = createHash("sha256").update(hostKey).digest();
  if (!expected.equals(unpadded.subarray(0, DOMAIN_DIGEST_BYTES))) {
    return err(RealChromeErrors.keyWrong());
  }
  return ok(unpadded.subarray(DOMAIN_DIGEST_BYTES).toString("utf8"));
}

/**
 * Remove PKCS#7 padding, refusing a block whose final byte cannot be a pad length.
 *
 * Padding is stripped here rather than by `setAutoPadding(true)` because a WRONG key fails as bad padding,
 * and Node throws for that — an exception carrying no indication of which of the two things went wrong.
 * Doing it by hand turns the commonest real failure (the keyring returned a password for a different
 * Chrome install) into a typed error the caller can print.
 *
 * @param padded the decrypted, still-padded bytes
 * @returns the plaintext, or `undefined` when the padding is not valid PKCS#7
 */
function stripPkcs7({ padded }: { padded: Buffer }): Buffer | undefined {
  const pad = padded.at(-1);
  if (pad === undefined || pad === 0 || pad > 16 || pad > padded.length) {
    return undefined;
  }
  for (let i = padded.length - pad; i < padded.length; i += 1) {
    if (padded[i] !== pad) {
      return undefined;
    }
  }
  return padded.subarray(0, padded.length - pad);
}
