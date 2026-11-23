/**
 * The production read seam behind `github exposure`: the one place a call id becomes a route.
 *
 * It rides the repository's resilient read client (`makeGithubClient`) through the shared provider door
 * (`safeProviderCall`, `provider: "github"`), exactly as `github read` and `github run-log` do. No raw `gh`, no
 * `fetch` outside the door, and no method but GET: every route comes from {@link GITHUB_EXPOSURE_CALLS}.
 */

import { githubScopeId, makeGithubClient } from "../../corpus/github/githubClient.js";
import { errorStatus, type IngestError } from "../../lib/ingestError.js";
import { safeProviderCall } from "../../lib/providerCall.js";
import { err, ok, type Result } from "../../lib/result.js";
import type { GithubExposureSeam } from "./exposureListing.js";
import { GITHUB_EXPOSURE_CALLS, type GithubExposureReadFailure } from "./exposureModel.js";

/**
 * The door's answer as the seam's: the value, or the failure with GitHub's status when it answered one. Pure.
 *
 * @param called what the door returned
 * @returns the seam's answer
 */
export function githubExposureAnswer({
  called,
}: {
  called: Result<unknown, IngestError>;
}): Result<unknown, GithubExposureReadFailure> {
  return called.isErr()
    ? err({ message: called.error.message, status: errorStatus({ error: called.error }) })
    : ok(called.value);
}

/**
 * Build the production seam over one token.
 *
 * @param token the GitHub token
 * @returns the REST and GraphQL reads, each answering a typed failure rather than throwing
 */
export function productionGithubExposureSeam({ token }: { token: string }): GithubExposureSeam {
  const client = makeGithubClient({ token });
  const scopeId = githubScopeId({ token });
  return {
    get: async ({ call, params }) => {
      // Widened to `string`, as `github run-log`'s door does: the route is one row of a closed table, but its
      // params are a runtime record, which Octokit cannot check against a union of literal routes.
      const route: string = GITHUB_EXPOSURE_CALLS[call].route;
      const called = await safeProviderCall({
        execute: async () => (await client.request(route, { ...params })).data,
        operation: "github.exposure.rest",
        provider: "github",
        retryMode: "transient",
        scopeId,
      });
      return githubExposureAnswer({ called });
    },
    graphql: async ({ query, variables }) => {
      const called = await safeProviderCall({
        execute: () => client.graphql(query, { ...variables }),
        operation: "github.exposure.graphql",
        provider: "github",
        retryMode: "transient",
        scopeId,
      });
      return githubExposureAnswer({ called });
    },
  };
}
