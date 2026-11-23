/**
 * The one way Storage is chosen other than off the running local stack: the console's browser lane
 * (`src/__tests__/e2e/`), where CI has a plain Postgres and no Supabase stack, starts a loopback Storage fake and names
 * it in a PAIR of variables. A published page the lane's console serves then comes out of Storage exactly as it does
 * on the owner's machine, through the same client, signing and verification.
 *
 * The override narrows rather than widens what `./selection.ts` guards. Both variables or neither: one alone is a
 * refusal, never a fall back to docker, so a half-set environment cannot quietly reach the real stack. The address must
 * be a plain `http://` loopback origin with an explicit port, so the key it travels with cannot leave the machine. The
 * key is the lane's own, minted per run, and no refusal here prints either value.
 *
 * What it does NOT prove is that the listener is the lane's fake: a pair naming
 * any loopback service, the local stack's gateway with its real key included, is taken as named. That is the trust
 * `SLOPWEAVER_STORE_URL` already carries — whoever sets this process's environment chooses its store — and the real
 * stack's key is read off docker on each open and exported nowhere, so no ambient pair can name it by accident.
 * Identifying the fake would mean a network probe inside a synchronous selection, for a caller that already holds
 * the environment.
 */
import { err, ok, type Result } from "#lib/result.js";

import { type ObjectStoreError, ObjectStoreErrors } from "./errors.js";

/** The browser lane's Storage address: a loopback origin, no path. */
export const E2E_OBJECTS_API_URL_ENV = "SLOPWEAVER_E2E_OBJECTS_API_URL";

/** The browser lane's Storage key, generated for one run and kept nowhere. */
export const E2E_OBJECTS_SERVICE_KEY_ENV = "SLOPWEAVER_E2E_OBJECTS_SERVICE_KEY";

/** A generated key's shape: 32 or more URL-safe characters, which is what 24 random bytes encode to. */
const GENERATED_KEY = /^[A-Za-z0-9_-]{32,}$/u;

/** An IPv4 loopback host, each octet checked by `isLoopbackHost`. */
const IPV4_LOOPBACK = /^127\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/u;

/**
 * Whether a parsed hostname is this machine's loopback: `127.x.x.x` or `[::1]`.
 *
 * @param hostname a WHATWG URL's hostname, so an IPv4 shorthand is already spelled out
 * @returns true for a loopback host
 */
function isLoopbackHost({ hostname }: { hostname: string }): boolean {
  if (hostname === "[::1]") {
    return true;
  }
  const octets = IPV4_LOOPBACK.exec(hostname);
  if (octets === null) {
    return false;
  }
  return octets.slice(1).every((octet) => Number(octet) <= 255);
}

/**
 * Whether an address is a plain loopback origin: `http`, no credentials, an explicit port, no path, query or fragment.
 *
 * @param apiUrl what the lane named
 * @returns true when the key may be sent there
 */
export function isLoopbackOrigin({ apiUrl }: { apiUrl: string }): boolean {
  if (!URL.canParse(apiUrl)) {
    return false;
  }
  const url = new URL(apiUrl);
  const plain =
    url.protocol === "http:" &&
    url.username === "" &&
    url.password === "" &&
    url.port !== "" &&
    url.pathname === "/" &&
    url.search === "" &&
    url.hash === "" &&
    !apiUrl.includes("?") &&
    !apiUrl.includes("#");
  return plain && isLoopbackHost({ hostname: url.hostname });
}

/**
 * The browser lane's Storage selection, when it names one.
 *
 * @param env the environment the pair is read from
 * @returns `undefined` when neither variable is set, the lane's selection when both are valid, or the refusal
 */
export function e2eStoreObjectsSelection({
  env,
}: {
  env: Readonly<Record<string, string | undefined>>;
}): Result<{ readonly apiUrl: string; readonly serviceKey: string } | undefined, ObjectStoreError> {
  const apiUrl = env[E2E_OBJECTS_API_URL_ENV];
  const serviceKey = env[E2E_OBJECTS_SERVICE_KEY_ENV];
  if (apiUrl === undefined && serviceKey === undefined) {
    return ok(undefined);
  }
  if (apiUrl === undefined) {
    return err(ObjectStoreErrors.e2ePairIncomplete({ present: E2E_OBJECTS_SERVICE_KEY_ENV }));
  }
  if (serviceKey === undefined) {
    return err(ObjectStoreErrors.e2ePairIncomplete({ present: E2E_OBJECTS_API_URL_ENV }));
  }
  if (!isLoopbackOrigin({ apiUrl })) {
    return err(ObjectStoreErrors.e2eApiUrlNotLoopback());
  }
  if (!GENERATED_KEY.test(serviceKey)) {
    return err(ObjectStoreErrors.e2eServiceKeyInvalid());
  }
  return ok({ apiUrl: new URL(apiUrl).origin, serviceKey });
}
