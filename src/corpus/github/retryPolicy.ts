/**
 * Whether the throttling plugin may retry a rate-limited GitHub request.
 *
 * ## Why a per-call `retries: 0` has to be honoured here as well
 *
 * `makeGithubClient` is an `Octokit.plugin(retry, throttling)`, and the two plugins keep SEPARATE budgets.
 * `@octokit/plugin-retry` reads a per-call `request.retries` override; `@octokit/plugin-throttling` never does
 * — it counts its own `retryCount` and asks the `onRateLimit`/`onSecondaryRateLimit` callbacks. So a caller
 * that opts out with `retries: 0` still sat through a secondary-limit wait (60s by default in throttling
 * 11.0.5) and a retry. The fleet read (`../../cli/commands/github/reviewStateFleet.ts`) is that caller: it owns
 * its own retry strategy and a wall-clock budget, and an Octokit wait it cannot see is exactly what the budget
 * exists to stop.
 *
 * A per-call value other than zero is NOT read as a new maximum: nothing here asks for that, and widening a
 * rate-limit wait on a caller's say-so is a different decision from refusing one.
 */

import { isRecord } from "#lib/parsers.js";

/** How many times a rate-limited request is retried when its caller did not opt out. */
export const MAX_THROTTLE_RETRIES = 3;

/**
 * Decide one throttling retry.
 *
 * @param options the request options the throttling plugin hands its callback, carrying any per-call override
 * @param retryCount how many throttling retries this request has already had
 * @returns false when the caller opted out with `retries: 0`, else whether the default budget has room
 */
export function shouldRetryGithubThrottle({
  options,
  retryCount,
}: {
  // `unknown`, narrowed below: the plugin hands over its own `Required<EndpointDefaults>`, whose `request` is an
  // index-signature bag no narrower shape here can be assigned from.
  options: { readonly request?: unknown };
  retryCount: number;
}): boolean {
  if (isRecord(options.request) && options.request["retries"] === 0) {
    return false;
  }
  return retryCount < MAX_THROTTLE_RETRIES;
}
