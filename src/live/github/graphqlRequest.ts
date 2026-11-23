/**
 * What one GitHub read seam call is sent with and answers: per-call transport overrides for ONE GraphQL request, the
 * Octokit `request` options they become, and the typed error a failed read becomes.
 *
 * Absent for every caller but the fleet read (`../../cli/commands/github/reviewStateFleet.ts`), which owns its
 * own retry strategy and a wall-clock budget. `retries: 0` switches off BOTH of the client's retry budgets for
 * that request (`../../corpus/github/retryPolicy.ts` says why the throttling one needs its own check);
 * `timeoutMs` aborts a request still unanswered after that long, where otherwise a stalled socket holds it until
 * undici's own 300-second header and body timeouts.
 *
 * `request` is one of `@octokit/graphql`'s NON_VARIABLE_OPTIONS, so what this builds travels as transport
 * options rather than as a query variable, and `@octokit/request` hands `request.signal` to `fetch`.
 */

import type { IngestError } from "#lib/ingestError.js";
import { isRecord } from "#lib/parsers.js";
import { type ProviderScope, type RateBlock, sharedRateBlock } from "#lib/rateBlock.js";
import { err, ok, type Result } from "#lib/result.js";

import { type GithubLiveError, GithubLiveErrors, type RateLimitedError } from "./errors.js";
import { githubRateLimitOf } from "./rateLimit.js";

/** The overrides one GraphQL request may carry. */
export interface GithubGraphqlRequestOptions {
  readonly retries?: number;
  readonly timeoutMs?: number;
}

/**
 * The Octokit `request` options one set of per-call overrides becomes.
 *
 * @param request the overrides the caller asked for
 * @returns `retries` passed through, and `timeoutMs` as an abort signal that fires after that long
 */
export function octokitRequestOptions({ request }: { request: GithubGraphqlRequestOptions }): {
  readonly retries?: number;
  readonly signal?: AbortSignal;
} {
  return {
    ...(request.retries === undefined ? {} : { retries: request.retries }),
    // `AbortSignal.timeout` throws ERR_OUT_OF_RANGE on a fraction or a negative, so the delay is whole and clamped.
    ...(request.timeoutMs === undefined
      ? {}
      : { signal: AbortSignal.timeout(Math.max(0, Math.floor(request.timeoutMs))) }),
  };
}

/**
 * Refuse, before sending, a time-bounded request while the shared GitHub rate block is closed AT ALL.
 *
 * `safeProviderCall` waits on that block BEFORE it runs the call, the abort signal only reaches `fetch`, and the wait
 * LOOPS when another caller extends the block mid-wait, so no timeout-sized allowance bounds it: a short block
 * extended by a later 429 to ten minutes holds the request ten minutes. An
 * OPEN block never enters that loop, because nothing between this check and the door's own check yields: a
 * `retryMode: "never"` call reaches `waitUntilOpen`'s first synchronous read in the same tick. The trade: a fleet
 * page refuses where it could have waited a few seconds, and the read ends `RATE_LIMITED` by name. A request with no
 * timeout keeps waiting as it always did.
 *
 * @param block the shared rate block the provider door waits on
 * @param scope the provider and token scope the block is counted against
 * @param request the overrides the caller asked for
 * @param nowMs the wall clock in epoch milliseconds, read only to name the reset
 * @returns the rate-limit failure to answer instead of sending, or undefined when the request may go
 */
export function refuseWhileBlocked({
  block,
  scope,
  request,
  nowMs,
}: {
  block: RateBlock;
  scope: ProviderScope;
  request: GithubGraphqlRequestOptions;
  nowMs: number;
}): RateLimitedError | undefined {
  const waitMs = block.remainingMs({ scope });
  if (request.timeoutMs === undefined || waitMs <= 0) {
    return undefined;
  }
  // A Retry-After past the Date range (the block accepts any finite duration) names no reset rather than throwing.
  const reset = new Date(nowMs + waitMs);
  return GithubLiveErrors.rateLimited({
    message: `an earlier GitHub rate limit blocks this token for another ${String(Math.ceil(waitMs / 1000))}s, and a request bounded to ${String(Math.floor(request.timeoutMs / 1000))}s cannot wait inside it, so it was not sent`,
    resetAt: Number.isNaN(reset.getTime()) ? undefined : reset.toISOString(),
  });
}

/**
 * The options one GraphQL call is sent with, or the rate-limit failure that means it must not be sent at all.
 *
 * With no override the options are the variables alone, so every caller but the fleet read sends exactly what it
 * always did and waits on the shared block as it always did.
 *
 * @param variables the query's own variables
 * @param request the per-call overrides, when the caller has any
 * @param scopeId the token scope the shared rate block is counted against
 * @param block the shared rate block; the process-wide one unless a test injects its own
 * @param nowMs the wall clock in epoch milliseconds, read only to name a reset
 * @returns the options to hand Octokit, or why the request was refused before it was sent
 */
export function graphqlCallOptions({
  variables,
  request,
  scopeId,
  block = sharedRateBlock(),
  nowMs = Date.now(),
}: {
  variables: Record<string, unknown>;
  request: GithubGraphqlRequestOptions | undefined;
  scopeId: string;
  block?: RateBlock;
  nowMs?: number;
}): Result<Record<string, unknown>, RateLimitedError> {
  if (request === undefined) {
    return ok(variables);
  }
  const blocked = refuseWhileBlocked({ block, nowMs, request, scope: { provider: "github", scopeId } });
  return blocked === undefined ? ok({ ...variables, request: octokitRequestOptions({ request }) }) : err(blocked);
}

/** GitHub's own words for a path a commit does not hold, measured live off `Commit.file(path:)`. */
const MISSING_FILE_MESSAGE = /^Could not resolve file for path '.*'\.$/su;

/** True when `error` is GitHub's missing-file NOT_FOUND, attached to a field the answer's `data` holds as `null`. */
function isMissingFileError({ data, error }: { data: Record<string, unknown>; error: unknown }): boolean {
  if (!isRecord(error) || error["type"] !== "NOT_FOUND" || typeof error["message"] !== "string") {
    return false;
  }
  if (!MISSING_FILE_MESSAGE.test(error["message"]) || !Array.isArray(error["path"]) || error["path"].length === 0) {
    return false;
  }
  let node: unknown = data;
  for (const step of error["path"] as readonly unknown[]) {
    if (typeof step === "string" && isRecord(node) && step in node) {
      node = node[step];
    } else if (typeof step === "number" && Array.isArray(node) && step < node.length) {
      node = (node as readonly unknown[])[step];
    } else {
      return false;
    }
  }
  return node === null;
}

/**
 * The partial `data` of a GraphQL answer whose every error is a path a commit does not hold, or `undefined` for any
 * other throw. `Commit.file(path:)` answers such a path with a NOT_FOUND error beside a `null` alias, rather than
 * `null` alone, and `@octokit/graphql` throws the whole answer as a `GraphqlResponseError` carrying both. Any other
 * NOT_FOUND is a read that failed, never an absence.
 *
 * @param thrown what the GraphQL client threw
 * @returns the answer's own `data`, its missing paths `null`, when nothing but a missing file went wrong
 */
export function missingFileOnlyData({ thrown }: { thrown: unknown }): Record<string, unknown> | undefined {
  if (!isRecord(thrown) || !isRecord(thrown["data"]) || !Array.isArray(thrown["errors"])) {
    return undefined;
  }
  const data = thrown["data"];
  const errors: readonly unknown[] = thrown["errors"];
  const missingOnly = errors.length > 0 && errors.every((error) => isMissingFileError({ data, error }));
  return missingOnly ? data : undefined;
}

/**
 * Run one GraphQL call, answering {@link missingFileOnlyData}'s partial data in place of the throw when the caller
 * asked for a missing path as `null`; every other throw is rethrown as it came.
 *
 * @param execute the client's own call
 * @param missingFileReadsNull set only by the one caller asking whether a path exists (`./diffOnBase.ts`)
 * @returns what the call answered, or the partial data of an answer whose only errors were missing paths
 */
export async function withMissingFilesAsNull({
  execute,
  missingFileReadsNull,
}: {
  execute: () => Promise<unknown>;
  missingFileReadsNull: true | undefined;
}): Promise<unknown> {
  try {
    return await execute();
  } catch (thrown) {
    const partial = missingFileReadsNull === true ? missingFileOnlyData({ thrown }) : undefined;
    if (partial === undefined) {
      throw thrown;
    }
    return partial;
  }
}

/**
 * The typed error one failed read becomes: `RATE_LIMITED` with its reset when GitHub refused on the limit, so a
 * waiting caller can outlast it, and `READ_FAILED` for everything else, exactly as before.
 *
 * @param failure what the provider door answered
 * @returns the GitHub read error a caller branches on
 */
export function githubReadFailure({ failure }: { failure: IngestError }): GithubLiveError {
  const limit = githubRateLimitOf({ failure, nowMs: Date.now() });
  if (limit === undefined) {
    return GithubLiveErrors.readFailed({ cause: failure, message: failure.message });
  }
  return GithubLiveErrors.rateLimited({ cause: failure, message: failure.message, resetAt: limit.resetAt });
}
