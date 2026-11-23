/**
 * The Vanta access token, SHARED across processes — the fix for a class of partial sync this installation
 * measured.
 *
 * ## What was measured, and how to reproduce it
 *
 * Vanta allows exactly ONE active access token per Manage application: minting a second immediately
 * revokes the first. `./oauth.ts` knew that and cached its token in MEMORY, which protects concurrent
 * callers inside one process and nothing else. Two `slopweaver` invocations therefore each minted, and the
 * second silently killed the first's token mid-run.
 *
 * Two consecutive whole-estate syncs, same credential, minutes apart:
 * `slopweaver atlas vanta sync > /tmp/v.log 2>&1; echo $?; grep -c INCOMPLETE /tmp/v.log`
 * — each reported incomplete surfaces on HTTP 401, and the two sets did not match in size or membership.
 * A scope or entitlement problem is stable; a set that changes run to run is contention. The atlas
 * still published, so the failure arrived as an atlas quietly missing every record those surfaces hold
 * rather than as a refusal.
 *
 * The mint lock (`admit/operationLock.ts`) did not close it and could not: it serialises the two MINTS, and
 * the damage is done by the second mint existing at all, whenever it happens. What closes it is a second
 * process not needing to mint — so the token and its expiry are written where the next process can find
 * them, and read back inside the same lock the mint takes.
 *
 * ## It holds a live credential, so it is written like one
 *
 * `0700` on the directory and `0600` on the file, the same treatment `secrets/store.ts` gives a stored
 * secret, and never logged. An unreadable or malformed cache is treated as no cache — the caller mints,
 * which is correct rather than merely safe: refusing here would take an atlas offline because a cache file
 * was corrupt.
 *
 * The record is deliberately NOT under `atlas/vanta/`: it is a credential, not part of a generation, and a
 * generation directory is archived and restored by `atlas vanta reset`.
 */
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { isRecord } from "../../lib/parsers.js";
import { safeJsonParse, safeJsonStringify } from "../../lib/safeJson.js";
import { stateHomePaths } from "../../stateHome.js";

/** A token and the instant it stops being usable, as the cache holds them. */
export interface SharedVantaToken {
  readonly accessToken: string;
  readonly expiresAtMs: number;
}

/**
 * Where the shared token lives, keyed by a digest of the client id so two credentials on one machine never
 * read each other's token.
 *
 * The DIRECTORY comes from `stateHome.ts` rather than being joined here — that file owns every path under
 * the Slopweaver home, and `stateHome.guard.test.ts` refuses a second place that builds one.
 *
 * @param home the state home
 * @param key the digest naming this credential
 * @returns the cache file's path
 */
export function vantaTokenCachePath({ home, key }: { readonly home: string; readonly key: string }): string {
  return join(stateHomePaths({ home }).vantaTokenDir, `${key}.json`);
}

/**
 * The shared token, when one is cached and still usable.
 *
 * @param path the cache file
 * @param nowMs the current instant in epoch milliseconds
 * @param skewMs how long before real expiry a token is treated as already expired
 * @returns the token, or `null` when there is nothing usable to read
 */
export function readSharedVantaToken({
  path,
  nowMs,
  skewMs,
}: {
  readonly path: string;
  readonly nowMs: number;
  readonly skewMs: number;
}): SharedVantaToken | null {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return null;
  }
  let decoded: unknown;
  try {
    decoded = safeJsonParse({ label: "vanta token cache", text });
  } catch {
    return null;
  }
  return usableToken({ decoded, nowMs, skewMs });
}

/**
 * The token a decoded record holds, when it holds a usable one. Pure, so the expiry rule is testable
 * without a filesystem.
 *
 * @param decoded the parsed JSON of one cache file
 * @param nowMs the current instant in epoch milliseconds
 * @param skewMs how long before real expiry a token is treated as already expired
 * @returns the token, or `null` when the record is malformed or too close to expiry
 */
export function usableToken({
  decoded,
  nowMs,
  skewMs,
}: {
  readonly decoded: unknown;
  readonly nowMs: number;
  readonly skewMs: number;
}): SharedVantaToken | null {
  if (!isRecord(decoded)) {
    return null;
  }
  const accessToken = decoded["accessToken"];
  const expiresAtMs = decoded["expiresAtMs"];
  if (typeof accessToken !== "string" || accessToken.length === 0 || typeof expiresAtMs !== "number") {
    return null;
  }
  // `Number.isFinite`, not just `typeof number`. `JSON.parse` turns `1e400` into `Infinity`, and an
  // infinite expiry is never within the refresh skew — so a corrupt cache carrying one would hand every
  // process the same dead token forever, which is the exact failure this file was written to end. Found by
  // a Codex review pass, against this module's own header promising a malformed cache mints.
  if (!Number.isFinite(expiresAtMs)) {
    return null;
  }
  if (expiresAtMs - skewMs <= nowMs) {
    return null;
  }
  return { accessToken, expiresAtMs };
}

/**
 * Record a freshly minted token where the next process will find it.
 *
 * A write that fails is SWALLOWED rather than propagated, and that is the right direction: the token in
 * hand is valid, and failing the sync because the cache could not be written would turn a lost
 * optimisation into an outage. The cost of the miss is one extra mint next time, which is the behaviour
 * this file replaced.
 *
 * @param path the cache file
 * @param token the token just minted
 */
export function writeSharedVantaToken({
  path,
  token,
}: {
  readonly path: string;
  readonly token: SharedVantaToken;
}): void {
  try {
    const dir = dirname(path);
    mkdirSync(dir, { mode: 0o700, recursive: true });
    chmodSync(dir, 0o700);
    writeFileSync(path, safeJsonStringify({ label: "vanta token cache", value: token }), { mode: 0o600 });
    chmodSync(path, 0o600);
  } catch {
    // Deliberately silent: never log a path that names a credential's cache, and never fail a valid mint.
  }
}
