/**
 * The one thing a Hex client needs — a token — resolved into a configuration, with the API origin fixed.
 *
 * ## Why the origin is not a setting
 *
 * The published Hex OpenAPI document declares exactly one server, and the atlas pins that document by
 * digest (`src/atlas/hex/generated/specLock.ts`). This module takes the origin FROM that pin rather than
 * from an environment variable, so a live read and the surface map can never disagree about which host
 * they describe — and so no caller can point the bearer token at a host of its own choosing. A single-tenant
 * Hex deployment would change the pin, and the atlas would report the drift first.
 *
 * ## Nothing here ever renders the token
 *
 * The configuration is the token plus the origin, and the only thing a message ever carries is the fact
 * that a token is absent. That is the same discipline `src/datadog/config.ts` keeps and for the same reason:
 * a value that reaches a log line reaches a transcript.
 */
import { HEX_SPEC_PINS } from "../atlas/hex/generated/specLock.js";
import { hexApiToken } from "../config.js";
import { err, ok, type Result } from "../lib/result.js";
import { type HexReadError, HexReadErrors } from "./errors.js";

/** A resolved Hex configuration — the only thing the client constructor accepts. */
export interface HexConfig {
  /** The bearer token. Never rendered. */
  readonly token: string;
  /** The API origin every path is appended to, e.g. `https://app.hex.tech/api`. From the atlas's pin. */
  readonly apiOrigin: string;
}

/**
 * The API origin the pinned document declares. One host, because Hex publishes one document.
 *
 * `HEX_SPEC_PINS` is a non-empty tuple by construction; the absent case is answered out loud rather than
 * coalesced because the type is a `readonly HexSpecPin[]`.
 *
 * @returns the origin, e.g. `https://app.hex.tech/api`
 */
export function hexApiOrigin(): string {
  const pin = HEX_SPEC_PINS[0];
  const host = pin?.hosts[0];
  if (host === undefined) {
    throw new Error("the Hex spec lock declares no host — regenerate it with `yarn tsx tools/generateHexSpecLock.ts`");
  }
  return host;
}

/**
 * Resolve the Hex configuration from the environment and the secret store.
 *
 * @param env the environment record to read `HEX_API_TOKEN` from — injected so a test can prove "no token
 *   anywhere" without the ambient shell
 * @param home the state home whose `secrets/hex-api-token` is the file fallback; omitted takes `$SLOPWEAVER_HOME`
 * @returns the configuration, or the typed reason there is none
 */
export function resolveHexConfig({
  env,
  home,
}: {
  env: Readonly<Record<string, string | undefined>>;
  home?: string;
}): Result<HexConfig, HexReadError> {
  const token = hexApiToken({ env, ...(home === undefined ? {} : { home }) });
  if (token === undefined) {
    return err(HexReadErrors.tokenMissing());
  }
  return ok({ apiOrigin: hexApiOrigin(), token });
}
