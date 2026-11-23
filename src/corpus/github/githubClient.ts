/**
 * The one retry- and throttle-resilient Octokit client every GitHub read builds, and the scope key its quota
 * is counted against. It sends nothing itself: the live request seams that call through it stay in
 * `fetch.ts`, each inside its own `safeProviderCall`.
 */

import { retry } from "@octokit/plugin-retry";
import { throttling } from "@octokit/plugin-throttling";
import { Octokit } from "@octokit/rest";
import { scopeIdForToken } from "../../lib/providerCall.js";
import { shouldRetryGithubThrottle } from "./retryPolicy.js";

const ResilientOctokit = Octokit.plugin(retry, throttling);

/** A retry- + throttle-resilient octokit client (shared by the item lane + the member lane). */
export type GithubClient = InstanceType<typeof ResilientOctokit>;

/**
 * A retry- + throttle-resilient client bound to `token` (undefined ⇒ unauthenticated, public only).
 *
 * @param token the GitHub token (undefined ⇒ unauthenticated)
 * @returns the resilient octokit client
 */
export function makeGithubClient({ token }: { token: string | undefined }): GithubClient {
  return new ResilientOctokit({
    auth: token,
    throttle: {
      onRateLimit: (_wait, options, _client, retryCount) => shouldRetryGithubThrottle({ options, retryCount }),
      onSecondaryRateLimit: (_wait, options, _client, retryCount) => shouldRetryGithubThrottle({ options, retryCount }),
    },
  });
}

/**
 * The scope key GitHub's quota is counted against, for a token that may be absent.
 *
 * GitHub's limit is per-token, so an authenticated caller keys on a digest of its own token. An
 * UNAUTHENTICATED client has no token to digest, and GitHub meters those callers together by source
 * address — so they deliberately share one constant key rather than each getting a private scope that would
 * let them sail past a limit the others already hit. Spelled as a branch rather than `token ?? ""` because
 * the two cases are genuinely different quotas, not one value with a default.
 *
 * @param token the GitHub token, or undefined for an unauthenticated client
 * @returns the scope key for {@link ../../lib/providerCall.safeProviderCall}
 */
export function githubScopeId({ token }: { token: string | undefined }): string {
  if (token === undefined) {
    return "github-unauthenticated";
  }
  return scopeIdForToken({ token });
}
