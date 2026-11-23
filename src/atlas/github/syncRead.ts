/**
 * The READ half of `github sync`: every admitted call, for every scope it was handed, each one settled into
 * what it read or the typed reason it read nothing.
 *
 * Nothing here folds, merges or publishes — `sync.ts` owns what happens to these outcomes. What this half
 * owns is the boundary: a call whose route cannot be built for its scope, a call GitHub refused (graded
 * against the call's own declared refusals), and a 200 whose records omit a field GitHub declares required
 * (`requiredFields.ts`) each leave here as a failure, so no fold downstream ever sees a read it cannot trust.
 */
import type { ResultAsync } from "../../lib/result.js";

import type { GithubAtlasApi, GithubReadOutcome } from "./client.js";
import type { GithubAtlasError } from "./errors.js";
import { githubCallsAt } from "./inventory.js";
import { type GithubCall, githubCallRoute } from "./inventoryShape.js";
import { permissionGraded } from "./refusalGrade.js";
import { refuseMissingRequiredFields } from "./requiredFields.js";

/** The scopes one sync covers. Handed in — see `sync.ts`'s header on why nothing there discovers them. */
export interface GithubSyncScopes {
  readonly organisations: readonly string[];
  /** `owner/repo` coordinates. */
  readonly repositories: readonly string[];
}

/** What one call's read came to, before it is folded into a kind: what it read, or why it read nothing. */
export type CallOutcome = { readonly call: GithubCall; readonly route: string; readonly scopeRef: string } & (
  | { readonly outcome: GithubReadOutcome; readonly error: null }
  | { readonly outcome: null; readonly error: GithubAtlasError }
);

/** Run one admitted call for one scope, settling it into what it read or why it read nothing. */
async function readScope({
  api,
  call,
  scopeRef,
}: {
  api: GithubAtlasApi;
  call: GithubCall;
  scopeRef: string;
}): Promise<CallOutcome> {
  const route = githubCallRoute({ call, scopeRef });
  if (route === null) {
    return {
      call,
      error: {
        code: "UNUSABLE_RESPONSE",
        message: `${call.id} cannot be built for scope ${scopeRef} — the scope does not fit the call's level`,
        route: call.path,
      },
      outcome: null,
      route: call.path,
      scopeRef,
    };
  }
  const read: ResultAsync<GithubReadOutcome, GithubAtlasError> = api.read({ paged: call.paging === "page", route });
  const settled = await read;
  if (settled.isErr()) {
    return { call, error: permissionGraded({ call, error: settled.error, route }), outcome: null, route, scopeRef };
  }
  const usable = refuseMissingRequiredFields({ call, read: settled.value, route });
  if (usable.isErr()) {
    return { call, error: usable.error, outcome: null, route, scopeRef };
  }
  return { call, error: null, outcome: usable.value, route, scopeRef };
}

/**
 * Run every admitted call for every scope, in order, collecting outcomes rather than stopping at a failure.
 *
 * Serial on purpose. GitHub's secondary rate limit punishes concurrency on the same token far harder than
 * it punishes a steady sequence, and this atlas would rather take longer than have a run half-refused for a
 * reason that has nothing to do with the account's configuration. The consequence is real and worth
 * stating: the run's duration is one call's latency times every repository-scope call in the inventory
 * times every repository in scope — so a whole-organisation sync grows linearly with the organisation's
 * repository count, one serial call at a time. `--repos` is how a caller bounds it.
 *
 * @param api the injected GitHub seam
 * @param scopes the organisations and repositories to read
 * @param progress where a line of progress goes; omitted discards it
 * @returns one outcome per call, in the order they were made
 */
export async function readEveryScope({
  api,
  scopes,
  progress,
}: {
  api: GithubAtlasApi;
  scopes: GithubSyncScopes;
  progress?: (input: { line: string }) => void;
}): Promise<readonly CallOutcome[]> {
  const outcomes: CallOutcome[] = [];
  for (const [level, refs] of [
    // De-duplicated, and not only to save requests. A repeated scope runs each call twice against the SAME
    // coverage key, so the second attempt replaces the first — and a review's counterexample was exactly
    // that: one organisation named twice, its first read refused and its second successful, reported as
    // fully covered. One scope is read once.
    ["organization", [...new Set(scopes.organisations)]],
    ["repository", [...new Set(scopes.repositories)]],
  ] as const) {
    for (const scopeRef of refs) {
      for (const call of githubCallsAt({ level })) {
        progress?.({ line: `github atlas: ${call.id} ${scopeRef}` });
        outcomes.push(await readScope({ api, call, scopeRef }));
      }
    }
  }
  return outcomes;
}
