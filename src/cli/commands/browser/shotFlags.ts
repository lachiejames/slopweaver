/**
 * The `browser shot` flag VALUES — `--url`, `--settle`, `--readiness-timeout` — and the bounds they enforce.
 *
 * Split from `./shotCore.ts` along the seam between reading one flag's value and resolving a whole shot:
 * each function here judges a single raw string and answers the number or address it means, or the one
 * reason it does not mean one. `./shotCore.ts` gathers those reasons into the verb's usage problems.
 *
 * Pure.
 */
import { DEFAULT_READINESS_TIMEOUT_MS, MAX_READINESS_TIMEOUT_MS } from "../../../browser/evidenceCaptureSnippet.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { BrowserVerbErrors, type BrowserVerbInvalidFlagValueError } from "./errors.js";

/** How long a RAW shot observes after load before it photographs, when the caller states none. */
export const SHOT_DEFAULT_SETTLE_MS = 2_000;

/**
 * The longest settle a caller may ask for.
 *
 * A flat 120 s process bound the client was killed at, which a 60-second settle sat a
 * whisker under, would leave a session reporting the kill rather than the page; so
 * the bound is DERIVED from the work each operation declared (`clientBoundMs`, `browser/relaySession.ts`),
 * so a 60-second settle gets 136 s rather than 120: this cap is now about how long a caller may reasonably hold
 * the owner's browser, not about a bound it could collide with.
 */
export const SHOT_MAX_SETTLE_MS = 60_000;

/**
 * Validate the address a shot was asked for.
 *
 * Refused unless it is absolute and `http`/`https`: the relay's lease binds to a URL's own ORIGIN, and a
 * `file:`, `chrome:` or `about:` address has none to bind to — so an unchecked one would reach
 * `acquireRelayLease` and fail there, naming a lease rather than the address that was wrong.
 *
 * @param url the raw `--url` value
 * @returns the address, or why it is not one this verb can open
 */
export function validUrl({ url }: { url: string }): Result<string, BrowserVerbInvalidFlagValueError> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return err(BrowserVerbErrors.urlNotAbsolute({ got: url }));
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return err(BrowserVerbErrors.urlNotHttp({ got: url }));
  }
  return ok(parsed.toString());
}

/**
 * Validate the settle a shot was asked for.
 *
 * @param raw the raw `--settle` value, or `undefined` when none was passed
 * @returns the milliseconds to observe for, or why the value is not one
 */
export function validSettleMs({ raw }: { raw: string | undefined }): Result<number, BrowserVerbInvalidFlagValueError> {
  if (raw === undefined) {
    return ok(SHOT_DEFAULT_SETTLE_MS);
  }
  if (!/^\d+$/.test(raw)) {
    return err(BrowserVerbErrors.settleNotWhole({ got: raw }));
  }
  const value = Number(raw);
  if (value > SHOT_MAX_SETTLE_MS) {
    return err(BrowserVerbErrors.settleTooLong({ got: raw, max: SHOT_MAX_SETTLE_MS }));
  }
  return ok(value);
}

/**
 * Validate the readiness wait an evidence shot was asked for.
 *
 * @param raw the raw `--readiness-timeout` value, or `undefined` when none was passed
 * @returns the milliseconds to wait for, or why the value is not one
 */
export function validReadinessTimeoutMs({
  raw,
}: {
  raw: string | undefined;
}): Result<number, BrowserVerbInvalidFlagValueError> {
  if (raw === undefined) {
    return ok(DEFAULT_READINESS_TIMEOUT_MS);
  }
  if (!/^\d+$/.test(raw)) {
    return err(BrowserVerbErrors.readinessTimeoutNotWhole({ got: raw }));
  }
  const value = Number(raw);
  if (value === 0 || value > MAX_READINESS_TIMEOUT_MS) {
    return err(BrowserVerbErrors.readinessTimeoutOutOfRange({ got: raw, max: MAX_READINESS_TIMEOUT_MS }));
  }
  return ok(value);
}
