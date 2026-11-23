/**
 * The one bounded `auth.test` `browser present`'s Slack-app route makes, beside the read seams in `./api.ts`
 * rather than inside them: its client is built per call with a request deadline, where every client there is
 * retried by the door, so the two never share a client or a retry policy.
 */
import { WebClient } from "@slack/web-api";

import type { IngestError } from "#lib/ingestError.js";
import { safeProviderCall, scopeIdForToken } from "#lib/providerCall.js";
import type { ResultAsync } from "#lib/result.js";

/**
 * One `auth.test`, at most once and bounded, for `browser present`'s Slack-app route: the token's team id and
 * workspace URL are what Slack's `slack://` deep link and the permalink's origin check need. It runs inside the
 * console voice's browser budget, so it never retries: no SDK retry, a 429 thrown rather than slept, the door's
 * `never` mode (no retry driver) and no pacing (`tier4` is not a paced class), and the client's own request `timeout` aborts the HTTP call
 * itself at `timeoutMs`, so nothing is left in flight once the caller has given up and taken the browser
 * instead. It still waits on the shared 429 block, which a fresh `browser present` process starts without.
 * The write transport's `whoAmI` it replaces retried transiently under a race that did not cancel it.
 *
 * @param token the Slack token whose workspace is asked
 * @param timeoutMs how long the one request may take before it is aborted
 * @returns Slack's raw `auth.test` body, or the typed failure
 */
export function slackWorkspaceLookupOnce({
  token,
  timeoutMs,
}: {
  token: string;
  timeoutMs: number;
}): ResultAsync<unknown, IngestError> {
  // devlint: sdk-factory -- a Slack READ client with a request deadline, for one call inside the voice's budget
  const client = new WebClient(token, slackLookupOnceClientOptions({ timeoutMs }));
  return safeProviderCall({
    execute: () => client.auth.test(),
    operation: "slack.auth.test",
    provider: "slack",
    retryMode: "never",
    scopeId: scopeIdForToken({ token }),
  });
}

/**
 * The `WebClient` options that hold `slackWorkspaceLookupOnce` to one bounded HTTP attempt: no SDK retry, a 429
 * thrown rather than slept, and the request aborted at `timeoutMs`.
 *
 * @param timeoutMs how long the one request may take before the client aborts it
 * @returns the options the lookup's client is built with
 */
export function slackLookupOnceClientOptions({ timeoutMs }: { timeoutMs: number }): {
  readonly rejectRateLimitedCalls: true;
  readonly retryConfig: { readonly retries: 0 };
  readonly timeout: number;
} {
  return { rejectRateLimitedCalls: true, retryConfig: { retries: 0 }, timeout: timeoutMs };
}
