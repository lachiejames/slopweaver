/**
 * Resolving a relative window (`15m`, `now-7d`) to an absolute epoch-ms pair, ONCE, against one `now`.
 *
 * ## The bug this exists to prevent
 *
 * A claim and the link offered as evidence for it must describe the same window. A window resolved twice —
 * once for the query, once for its evidence link — risks resolving against two different instants of `now`,
 * which is how a claim of "100,766 matched" ships beside a link that opens live and shows 47. Resolving both
 * ends against a single `nowMs` is what makes the two the same instant rather than nearly the same.
 *
 * So the resolved absolute pair is sent to the API **and** to the link — Datadog's logs aggregate endpoint
 * accepts an epoch-ms string in `filter.from`/`filter.to`, so the query and its evidence link are driven by
 * identical numbers rather than by two grammars that agree only in principle.
 *
 * ## Why `resolveWindow` returns a total `Result` rather than a partial window
 *
 * A partial `{ fromMs?, toMs? }` window has exactly one honest consumer — a caller that backfills a missing
 * bound from some default — and that backfill is itself a silent narrowing exactly like every other one this
 * package refuses. Collapsing to ONE function returning a `Result<AbsoluteWindow>` removes the partial state
 * entirely: a window either resolves to two absolute numbers or the `Result` says which token defeated it.
 * There is deliberately no silent lookback default at any layer — the caller always states one.
 */
import { err, ok, type Result } from "../lib/result.js";
import { type DatadogDomainError, DatadogDomainErrors } from "./domainErrors.js";

const UNIT_MS: Readonly<Record<string, number>> = {
  s: 1000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
  w: 604_800_000,
};

/** A window with both ends pinned to absolute epoch milliseconds. The only window this package passes around. */
export interface AbsoluteWindow {
  readonly fromMs: number;
  readonly toMs: number;
}

/**
 * Strip Datadog's `now-<dur>` and `now-<dur>..now` prefixes down to a bare duration.
 *
 * Both forms are what a person copies out of the console. A `now-<dur>..now-<dur>` range is not a single
 * duration and is deliberately left alone to fail as an unparseable token rather than be silently
 * reinterpreted as its first half.
 *
 * @param token the raw window token
 * @returns the token with any `now-` prefix and `..now` suffix removed
 */
function stripNowPrefix({ token }: { token: string }): string {
  const trimmed = token.trim();
  const range = trimmed.endsWith("..now") ? trimmed.slice(0, -"..now".length) : trimmed;
  return range.toLowerCase().startsWith("now-") ? range.slice("now-".length) : range;
}

/**
 * Parse a relative duration token to milliseconds.
 *
 * @param token a duration (`30m`, `8h`, `7d`), optionally written `now-8h` or `now-8h..now`
 * @returns the duration in milliseconds, or `null` when the token is not a duration
 */
export function durationToMs({ token }: { token: string }): number | null {
  // Case-insensitive because `8H` is what a person types and refusing it buys nothing.
  const match = /^(\d+)\s*(s|m|h|d|w)$/i.exec(stripNowPrefix({ token }));
  if (match === null) {
    return null;
  }
  // Non-null: a successful match against `(\d+)\s*(s|m|h|d|w)` always captures both groups.
  const amount = Number.parseInt(match[1]!, 10);
  const unit = UNIT_MS[match[2]!.toLowerCase()];
  if (!Number.isFinite(amount) || unit === undefined) {
    return null;
  }
  return amount * unit;
}

/**
 * Resolve one window bound against a fixed `now`.
 *
 * @param token `now` or empty for the present, a duration for "that long ago", or a bare epoch-ms integer
 * @param nowMs the single instant the whole window is resolved against
 * @returns the absolute epoch-ms bound, or `null` when the token is neither a duration nor an integer
 */
export function resolveBound({ token, nowMs }: { token: string; nowMs: number }): number | null {
  const trimmed = token.trim();
  if (trimmed === "" || trimmed.toLowerCase() === "now") {
    return nowMs;
  }
  const duration = durationToMs({ token: trimmed });
  if (duration !== null) {
    return nowMs - duration;
  }
  // Only a string that is EXACTLY an integer is an absolute epoch: `Number.parseInt` would happily take
  // the `8` out of `8x` and resolve a typo to 1970, which reads as a legitimate empty result downstream.
  return /^\d+$/.test(trimmed) ? Number.parseInt(trimmed, 10) : null;
}

/**
 * Resolve a `from`/`to` pair to an absolute window, or say which token defeated it.
 *
 * Both bounds are resolved against the SAME `nowMs`, which is the whole contract — see the file header.
 * `nowMs` is a required parameter rather than a `Date.now()` default so a test pins the instant and the
 * caller cannot accidentally resolve the two ends against two different clocks.
 *
 * @param from the window's start token — a duration, `now`, or an epoch-ms integer
 * @param to the window's end token, usually `now`
 * @param nowMs the single instant both bounds are resolved against
 * @returns the absolute window, or every reason it could not be built
 */
export function resolveWindow({
  from,
  to,
  nowMs,
}: {
  from: string;
  to: string;
  nowMs: number;
}): Result<AbsoluteWindow, DatadogDomainError> {
  const errors: string[] = [];
  const fromMs = resolveBound({ token: from, nowMs });
  const toMs = resolveBound({ token: to, nowMs });
  if (fromMs === null) {
    errors.push(`--from '${from}' is not a window: expected a duration (30m, 8h, 7d), 'now', or epoch milliseconds`);
  }
  if (toMs === null) {
    errors.push(`--to '${to}' is not a window: expected a duration (30m, 8h, 7d), 'now', or epoch milliseconds`);
  }
  if (fromMs === null || toMs === null) {
    return err(DatadogDomainErrors.windowBoundsInvalid({ reasons: errors }));
  }
  // An inverted or empty window returns zero results from a healthy Datadog, which is indistinguishable
  // from "nothing happened" at every layer above. Rejecting it here is the difference between a caller
  // learning they typed the bounds backwards and a caller believing their service went quiet.
  if (fromMs >= toMs) {
    return err(DatadogDomainErrors.windowEmpty({ fromMs, toMs }));
  }
  return ok({ fromMs, toMs });
}

/**
 * Render a window as the epoch-ms strings Datadog's query filters take.
 *
 * @param window the resolved absolute window
 * @returns the `from`/`to` pair as strings
 */
export function windowAsQueryBounds({ window }: { window: AbsoluteWindow }): { from: string; to: string } {
  return { from: String(window.fromMs), to: String(window.toMs) };
}
