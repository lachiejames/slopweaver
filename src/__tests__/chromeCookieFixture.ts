/**
 * Chrome's own cookie encryption, run forwards, so the real-Chrome tests exercise the real format rather
 * than a stand-in — and do it from ONE place.
 *
 * It was written twice: `cookieCrypto.test.ts` had it, and the jar's own row reader needed exactly the same
 * bytes. A second copy is a second place the format drifts, and the format is the whole subject — a
 * padding rule or a digest prefix that diverged between two copies would leave both tests passing against
 * each other while neither matched Chrome.
 *
 * Nothing here is a secret: the password is a literal invented for the fixture, and the key derived from it
 * decrypts nothing on any real machine.
 */
import { createCipheriv, createHash } from "node:crypto";

/** Chrome's own CBC initialisation vector: sixteen spaces. */
const IV = Buffer.alloc(16, 0x20);

/**
 * Encrypt exactly the way Chrome does: `v10`, then AES-128-CBC over `sha256(host_key)` + the value, padded
 * PKCS#7 by hand because Chrome's own writer does not use a library default here either.
 *
 * @param plaintext the cookie value, before Chrome prefixes it with its host digest
 * @param hostKey the row's `host_key`, which is what the embedded digest binds the value to
 * @param key the derived AES key, from `deriveCookieKey`
 * @returns the blob a jar row's `encrypted_value` column holds
 */
export function chromeEncrypt({
  plaintext,
  hostKey,
  key,
}: {
  plaintext: string;
  hostKey: string;
  key: Buffer;
}): Buffer {
  const body = Buffer.concat([createHash("sha256").update(hostKey).digest(), Buffer.from(plaintext, "utf8")]);
  const pad = 16 - (body.length % 16);
  const padded = Buffer.concat([body, Buffer.alloc(pad, pad)]);
  const cipher = createCipheriv("aes-128-cbc", key, IV);
  cipher.setAutoPadding(false);
  return Buffer.concat([Buffer.from("v10", "latin1"), cipher.update(padded), cipher.final()]);
}

/**
 * One jar row, in the shape `node:sqlite` hands back with `setReadBigInts(true)`.
 *
 * `expiresUtc` is a `bigint` because the column genuinely holds one — microseconds since 1601 is past
 * `Number.MAX_SAFE_INTEGER` for every live cookie, and a fixture that used a `number` would prove the
 * reader works on values the real jar never contains.
 *
 * @param name the cookie's name
 * @param hostKey the `host_key` the row is filed under, dot-prefixed for a domain cookie
 * @param key the derived AES key
 * @param value the plaintext, encrypted into the row
 * @param path the row's path, defaulting to the whole site
 * @param expiresUtc microseconds since 1601, or `0n` for a session cookie
 * @param httpOnly whether Chrome marked the row HttpOnly
 * @param secure whether Chrome marked the row Secure
 * @returns the row
 */
export function jarRow({
  name,
  hostKey,
  key,
  value,
  path = "/",
  expiresUtc = 0n,
  httpOnly = false,
  secure = true,
}: {
  name: string;
  hostKey: string;
  key: Buffer;
  value: string;
  path?: string;
  expiresUtc?: bigint;
  httpOnly?: boolean;
  secure?: boolean;
}): Record<string, unknown> {
  return {
    encrypted_value: new Uint8Array(chromeEncrypt({ hostKey, key, plaintext: value })),
    expires_utc: expiresUtc,
    host_key: hostKey,
    is_httponly: httpOnly ? 1n : 0n,
    is_secure: secure ? 1n : 0n,
    name,
    path,
  };
}
