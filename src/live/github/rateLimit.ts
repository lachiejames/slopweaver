/**
 * Whether a failed GitHub read was the RATE LIMIT, and when that limit resets.
 *
 * A rate limit is the one read failure a waiting caller should outlast rather than die on: it names its own
 * end. It reaches this repository in three shapes, and a classifier that knew only one of them is how a
 * `github checks --until merge` watch died two and a half hours in with no reset time printed:
 *
 * - **GraphQL over HTTP 200.** `@octokit/graphql` throws a `GraphqlResponseError` whose message reads
 *   `Request failed due to following response errors: - API rate limit already exceeded for user ID …`. It
 *   carries no status at all, only the response `headers` and the `errors` array — which is why
 *   `toIngestError` classifies it as plain `http` and nothing downstream knew to wait.
 * - **REST over 403 or 429.** A `RequestError` carrying `response.headers`, with `x-ratelimit-remaining: 0`
 *   for the primary limit or a `secondary rate limit` message and a `retry-after` for the secondary one.
 * - **`@octokit/plugin-throttling`'s own error**, `GraphQL Rate Limit Exceeded`, once its retries run out.
 *
 * A spent quota header ALONE is not a refusal: the request that spends the last point is ANSWERED, so a
 * NOT_FOUND read carrying `x-ratelimit-remaining: 0` is a NOT_FOUND. The header counts only on a refused
 * status, 403 or 429.
 *
 * The reset instant comes from `x-ratelimit-reset` (epoch seconds) when the response carried it, else from
 * a `Retry-After` hint, else it is unknown — and unknown is said, never guessed.
 */

import { epochSecondsToIso } from "../../lib/date.js";
import type { IngestError } from "../../lib/ingestError.js";
import { isRecord } from "../../lib/parsers.js";

/** GitHub's own phrasings of an exhausted primary or secondary limit, and the throttling plugin's. */
const RATE_LIMIT_MESSAGE = /rate limit (?:already )?exceeded|secondary rate limit|GraphQL Rate Limit Exceeded/i;

/** A rate-limited read: when the limit resets, or `undefined` when the response did not say. */
export interface GithubRateLimit {
  readonly resetAt: string | undefined;
}

/** The response headers a thrown Octokit error carries, wherever that shape keeps them. */
function headersOf({ cause }: { cause: unknown }): Record<string, unknown> | undefined {
  if (!isRecord(cause)) {
    return undefined;
  }
  if (isRecord(cause["headers"])) {
    return cause["headers"];
  }
  const response = cause["response"];
  return isRecord(response) && isRecord(response["headers"]) ? response["headers"] : undefined;
}

/**
 * What the GraphQL error entries' own TYPES say, wherever the thrown shape keeps the list: `limited` when one is
 * `RATE_LIMITED`, `other` when any entry carries some other type, `untyped` when there are none or every one is bare.
 *
 * A typed answer outranks the message. GitHub echoes input into an error message, so a `NOT_FOUND` for a node id
 * spelled "GraphQL Rate Limit Exceeded" would otherwise read as a rate limit.
 */
function entryVerdict({ cause }: { cause: unknown }): "limited" | "other" | "untyped" {
  if (!isRecord(cause)) {
    return "untyped";
  }
  const response = cause["response"];
  const responseData = isRecord(response) ? response["data"] : undefined;
  const lists = [
    cause["errors"],
    isRecord(cause["data"]) ? cause["data"]["errors"] : undefined,
    isRecord(responseData) ? responseData["errors"] : undefined,
  ];
  const entries: unknown[] = lists.flatMap((list) => (Array.isArray(list) ? list : []));
  const types = entries.map((entry) => (isRecord(entry) ? entry["type"] : undefined));
  if (types.includes("RATE_LIMITED")) {
    return "limited";
  }
  return types.some((type) => typeof type === "string") ? "other" : "untyped";
}

/** `x-ratelimit-reset` as an instant, when present and a number. */
function resetFromHeader({ headers }: { headers: Record<string, unknown> | undefined }): string | undefined {
  const raw = headers === undefined ? undefined : headers["x-ratelimit-reset"];
  if (raw === undefined || raw === null || raw === "") {
    return undefined;
  }
  return epochSecondsToIso({ seconds: Number(raw) });
}

/**
 * Classify one failed GitHub read as rate-limited, or not.
 *
 * @param failure the typed boundary failure `safeProviderCall` returned for the read
 * @param nowMs the clock a `Retry-After` hint is measured from, read by the caller at the failure
 * @returns the reset, when the failure was a rate limit; `undefined` for every other failure
 */
export function githubRateLimitOf({
  failure,
  nowMs,
}: {
  failure: IngestError;
  nowMs: number;
}): GithubRateLimit | undefined {
  const headers = headersOf({ cause: failure.cause });
  const remaining = headers === undefined ? undefined : headers["x-ratelimit-remaining"];
  const entries = entryVerdict({ cause: failure.cause });
  // A refusal comes back unanswered (GraphQL over 200, the throttle's own error) or as a 403/429. Any other
  // status is some other failure, whatever its body claims — a 500 quoting input, or one carrying a
  // RATE_LIMITED entry.
  const refusalStatus = failure.status === undefined || failure.status === 403 || failure.status === 429;
  const limited =
    refusalStatus &&
    (entries === "limited" ||
      (entries === "untyped" &&
        (failure.kind === "rate-limit" ||
          (failure.status !== undefined && String(remaining) === "0") ||
          RATE_LIMIT_MESSAGE.test(failure.message))));
  if (!limited) {
    return undefined;
  }
  const fromHeader = resetFromHeader({ headers });
  if (fromHeader !== undefined) {
    return { resetAt: fromHeader };
  }
  // Through the range-checked converter: a Retry-After past the representable dates is an unknown reset, never
  // a thrown RangeError that ends the watch with no line at all.
  if (failure.retryAfterMs !== undefined) {
    return { resetAt: epochSecondsToIso({ seconds: (nowMs + failure.retryAfterMs) / 1000 }) };
  }
  return { resetAt: undefined };
}
