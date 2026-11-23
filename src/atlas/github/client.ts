/**
 * The seam between this atlas and GitHub: one paged read, made only from the closed inventory.
 *
 * ## Why this is an interface rather than an Octokit call
 *
 * The sync, the projection and every one of their tests are written against {@link GithubAtlasApi}, so all
 * of them exist and are provable before a network call is involved. A test supplies a plain fake — not a
 * mock — and a 403, a 404, an empty page and a truncated listing are settled by unit tests rather than by
 * luck against a live organisation whose configuration nobody controls.
 *
 * ## The route is not a parameter a caller invents
 *
 * {@link GithubAtlasApi.read} takes a ROUTE STRING, and every route it is ever given is built by
 * `inventory.ts`'s `githubCallRoute` from a row in the closed table. The seam cannot enforce that on its
 * own — a string is a string — so the property is held one level up, where the only callers are the sync's
 * own loops over `githubCallsAt`. What the seam does enforce is the METHOD: there is no parameter for one,
 * and the live implementation issues a GET.
 *
 * ## What a 403 means here, and why it is not an error
 *
 * GitHub answers 403 for an unpermissioned token, an unaccepted SSO authorisation, a non-owner role and a
 * feature the plan does not carry. All of them are ordinary states of a healthy installation, so
 * {@link GithubReadOutcome} carries the status through rather than throwing — the sync grades it against
 * the call's own `expectedRefusals` and records a coverage boundary instead of an alarm.
 */
import type { GithubClient } from "../../corpus/github/githubClient.js";
import { githubScopeId, makeGithubClient } from "../../corpus/github/githubClient.js";
import { isRecord } from "../../lib/parsers.js";
import { safeProviderCall } from "../../lib/providerCall.js";
import { errAsync, okAsync, type ResultAsync } from "../../lib/result.js";

import { type GithubAtlasError, GithubAtlasErrors } from "./errors.js";

/**
 * How many pages one listing may take before the read is declared incomplete.
 *
 * A ceiling rather than an unbounded loop, and — unlike `src/corpus/github/orgApi.ts`'s own 20-page stop —
 * hitting it is REPORTED. That file returns a clipped listing with no truncation flag at all, so a caller
 * cannot tell a complete enumeration from a partial one; here the ceiling produces an
 * `INCOMPLETE_READ`, which becomes a `deferred` coverage cell and a gap, and which `merge.ts` then refuses
 * to treat as proof enough to stale anything.
 *
 * @internal
 */
export const MAX_PAGES = 50;

/**
 * The rate-limit label every call this atlas makes is metered under.
 *
 * @internal
 */
export const GITHUB_ATLAS_OPERATION = "github.atlas.read";

/** GitHub's own per-page maximum for the listings this atlas reads. */
const PER_PAGE = 100;

/** What one read returned, including the statuses that are boundaries rather than failures. */
export interface GithubReadOutcome {
  /** Every record the listing produced, or the single document for a non-paged route. */
  readonly records: readonly unknown[];
  /** Whether paging ended because GitHub offered no further page, rather than at this atlas's ceiling. */
  readonly pagesExhausted: boolean;
  /** GitHub's own `total_count`, when the listing reports one. Most REST listings do not. */
  readonly reportedTotal: number | null;
}

/** The injected GitHub seam. One method, because the atlas only ever reads. */
export interface GithubAtlasApi {
  /**
   * Read one route, following pages when the call is a listing.
   *
   * @param route the concrete route, built from the closed inventory
   * @param paged whether to follow pages
   * @returns what the route returned, or the typed failure
   */
  read: (input: { route: string; paged: boolean }) => ResultAsync<GithubReadOutcome, GithubAtlasError>;
}

/**
 * The HTTP status a thrown Octokit error carried, when it carried one.
 *
 * @param error the caught value
 * @returns the status, or `null` when the failure was not an HTTP response
 */
function statusOf({ error }: { error: unknown }): number | null {
  if (typeof error !== "object" || error === null) {
    return null;
  }
  const status = (error as { status?: unknown }).status;
  return typeof status === "number" ? status : null;
}

/**
 * Turn a thrown Octokit failure into this atlas's own typed error.
 *
 * @param error the caught value
 * @param route the route that failed, so the message names it
 * @returns the typed failure
 *
 * @internal
 */
export function classifyGithubFailure({ error, route }: { error: unknown; route: string }): GithubAtlasError {
  const status = statusOf({ error });
  if (status === 401) {
    return GithubAtlasErrors.authFailed({ reason: `HTTP 401 on ${route}` });
  }
  if (status === 403) {
    return GithubAtlasErrors.scopeRefused({ route, scope: null });
  }
  if (status === 404) {
    return GithubAtlasErrors.routeAbsent({ route });
  }
  return GithubAtlasErrors.transportExhausted({ cause: error, route });
}

/**
 * The records one response body contributes.
 *
 * GitHub answers a listing as a bare array, and a few as an object wrapping one under a named key beside a
 * `total_count`. Both shapes are read, because the difference is GitHub's and not something a caller of
 * this atlas should have to know.
 *
 * **The numeric `total_count` is what marks a wrapper**, and nothing else does. A singleton document carries
 * arrays of its own — a repository's `topics` — and reading the first array-valued field of ANY object
 * unwrapped `topics: []` into zero records, so every repository-settings read stored nothing. MEASURED on a
 * user-owned repository with no topics: `slopweaver atlas github sync --repos <owner/repo>`, then
 * `slopweaver atlas github read --kind repository-settings --accept-unproven-empty` reported
 * `0 record(s) from /repos/<owner>/<repo>`. Every wrapper the inventory admits (secrets, variables,
 * environments, installations, custom roles) carries a numeric `total_count`.
 *
 * A wrapper with no array beside its `total_count` contributes NO record, never itself: the wrapper is not a
 * member of the listing. Its total is still returned, so a nonzero one with nothing read is refused as an
 * incomplete read by the completeness check rather than stored as a listing of one.
 *
 * @param body the parsed response body
 * @returns the records it carried, and the total it reported
 *
 * @internal
 */
export function recordsIn({ body }: { body: unknown }): { records: readonly unknown[]; reportedTotal: number | null } {
  if (Array.isArray(body)) {
    return { records: body, reportedTotal: null };
  }
  if (!isRecord(body)) {
    return { records: [], reportedTotal: null };
  }
  const total = body["total_count"];
  if (typeof total !== "number") {
    return { records: [body], reportedTotal: null };
  }
  for (const value of Object.values(body)) {
    if (Array.isArray(value)) {
      return { records: value, reportedTotal: total };
    }
  }
  return { records: [], reportedTotal: total };
}

/**
 * One request, wrapped at the boundary.
 *
 * A page at a time rather than a whole listing inside one wrapper, and that is the shape the boundary gate
 * wants for a reason worth keeping: the typed failure then names the PAGE that failed rather than the
 * listing, so a read that died on page seven of nine says so.
 *
 * @param client the resilient Octokit
 * @param route the concrete route, built from the closed inventory
 * @param scopeId the quota scope this token is metered under
 * @param page the page to ask for, or `undefined` for a non-paged route
 * @returns the response body, or the typed failure
 */
function requestOnce({
  client,
  route,
  scopeId,
  page,
}: {
  client: GithubClient;
  route: string;
  scopeId: string;
  page: number | undefined;
}): ResultAsync<unknown, GithubAtlasError> {
  return safeProviderCall({
    execute: async (): Promise<unknown> => {
      const response =
        page === undefined
          ? await client.request(`GET ${route}`)
          : await client.request(`GET ${route}`, { page, per_page: PER_PAGE });
      return response.data;
    },
    // The atlas relies on Octokit's own retry and throttle plugins, so a second retry layer here would
    // multiply the wait a secondary rate limit already imposes.
    //
    // ONE static label for every call this atlas makes, rather than one per route. That is what
    // `operation-labels` requires and it is also right: the label's job is to name the RATE CLASS, every
    // call here is a GET of the same class, and an unmapped label silently inherits a fallback that on
    // another provider means one request every 75 seconds. The route is already in the typed error and in
    // the coverage cell, which is where a reader looks for which call failed.
    operation: GITHUB_ATLAS_OPERATION,
    provider: "github",
    retryMode: "never",
    scopeId,
  }).mapErr((failure): GithubAtlasError => classifyGithubFailure({ error: failure.cause, route }));
}

/**
 * The live GitHub seam: a resilient Octokit issuing GETs against the routes the inventory built.
 *
 * @param token the GitHub token, or `undefined` for an unauthenticated client that will see almost nothing
 * @returns the bound seam
 */
export function makeGithubAtlasApi({ token }: { token: string | undefined }): GithubAtlasApi {
  const client: GithubClient = makeGithubClient({ token });
  const scopeId = githubScopeId({ token });
  return {
    read: ({ route, paged }) => {
      if (!paged) {
        return requestOnce({ client, page: undefined, route, scopeId }).map((body): GithubReadOutcome => {
          const read = recordsIn({ body });
          return { pagesExhausted: true, records: read.records, reportedTotal: read.reportedTotal };
        });
      }
      return readEveryPage({ client, route, scopeId });
    },
  };
}

/**
 * Follow a listing's pages until GitHub offers no further one, or the ceiling is reached.
 *
 * Reaching the ceiling is an `INCOMPLETE_READ` rather than a quiet truncation — see {@link MAX_PAGES}.
 *
 * @param client the resilient Octokit
 * @param route the concrete route
 * @param scopeId the quota scope
 * @returns everything the listing produced, or the typed failure
 */
function readEveryPage({
  client,
  route,
  scopeId,
}: {
  client: GithubClient;
  route: string;
  scopeId: string;
}): ResultAsync<GithubReadOutcome, GithubAtlasError> {
  const collected: unknown[] = [];
  const step = (input: {
    page: number;
    reportedTotal: number | null;
  }): ResultAsync<GithubReadOutcome, GithubAtlasError> =>
    requestOnce({ client, page: input.page, route, scopeId }).andThen(
      (body): ResultAsync<GithubReadOutcome, GithubAtlasError> => {
        const read = recordsIn({ body });
        const reportedTotal = read.reportedTotal ?? input.reportedTotal;
        collected.push(...read.records);
        if (read.records.length < PER_PAGE) {
          return okAsync({ pagesExhausted: true, records: collected, reportedTotal });
        }
        if (input.page >= MAX_PAGES) {
          return errAsync(GithubAtlasErrors.incompleteRead({ observed: collected.length, route }));
        }
        return step({ page: input.page + 1, reportedTotal });
      },
    );
  return step({ page: 1, reportedTotal: null });
}
