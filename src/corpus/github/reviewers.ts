/**
 * A pull request's requested reviewers — read and add, split out as its own module matching `./labels.ts`'s
 * shape (this lane's siblings are already split by concern, not merged into `write.ts`).
 *
 * GitHub's `POST .../requested_reviewers` accepts any login or team slug and returns 422 for one that is not
 * a collaborator — it does not invent an account the way `POST .../labels` invents a label, so there is no
 * repository-side preflight equivalent to `repoLabelsVia`. The preflight this verb needs instead is the
 * DIRECTORY check (`../../outbound/github/reviewerIndex.ts`), which happens before any of this is called.
 */
import { absentAsEmpty } from "#lib/absent.js";
import type { IngestError } from "../../lib/ingestError.js";
import { isRecord } from "../../lib/parsers.js";
import { safeProviderCall } from "../../lib/providerCall.js";
import type { ResultAsync } from "../../lib/result.js";
import type { PrRef, WriteCtx } from "./write.js";

/** Who a pull request currently has review requested from — logins and team slugs, never merged. */
export interface RequestedReviewers {
  readonly users: readonly string[];
  readonly teams: readonly string[];
}

/** Narrow one `simple-user`/`team` array to the string field a caller can address by. */
function namesOf({ entries, field }: { entries: readonly unknown[]; field: "login" | "slug" }): readonly string[] {
  return entries.flatMap((entry) => {
    const value = isRecord(entry) ? entry[field] : undefined;
    return typeof value === "string" && value.length > 0 ? [value] : [];
  });
}

/**
 * Read one pull request's currently requested reviewers. Repeatable, so transient retries are allowed.
 *
 * @param ctx the shared client and rate-limit scope
 * @param input the pull request to read
 * @returns the requested user logins and team slugs, or the provider failure
 */
export function requestedReviewersVia({
  ctx,
  input,
}: {
  ctx: WriteCtx;
  input: PrRef;
}): ResultAsync<RequestedReviewers, IngestError> {
  const { owner, repo, number } = input;
  return safeProviderCall({
    execute: async () => {
      const res = await ctx.client.rest.pulls.listRequestedReviewers({ owner, pull_number: number, repo });
      return {
        teams: namesOf({ entries: res.data.teams, field: "slug" }),
        users: namesOf({ entries: res.data.users, field: "login" }),
      };
    },
    operation: "github.pulls.listRequestedReviewers",
    provider: "github",
    retryMode: "transient",
    scopeId: ctx.scopeId,
  });
}

/**
 * Request review from the given users and/or teams. Sent once; the caller confirms with a separate
 * `requestedReviewersVia` read-back, matching every other write in this lane.
 *
 * Additive by GitHub's own semantics — this endpoint never removes an existing request — so a reviewer
 * already requested is left exactly as they are rather than re-requested.
 *
 * @param ctx the shared client and rate-limit scope
 * @param input the pull request, plus the reviewer logins and/or team slugs to request
 * @returns the requested logins and slugs GitHub reports after the write, or the provider failure
 */
export function requestReviewersVia({
  ctx,
  input,
}: {
  ctx: WriteCtx;
  input: PrRef & { reviewers: readonly string[]; teamReviewers: readonly string[] };
}): ResultAsync<RequestedReviewers, IngestError> {
  const { owner, repo, number, reviewers, teamReviewers } = input;
  return safeProviderCall({
    execute: async () => {
      const res = await ctx.client.rest.pulls.requestReviewers({
        owner,
        pull_number: number,
        repo,
        reviewers: [...reviewers],
        team_reviewers: [...teamReviewers],
      });
      return {
        teams: namesOf({ entries: absentAsEmpty({ value: res.data.requested_teams }), field: "slug" }),
        users: namesOf({ entries: absentAsEmpty({ value: res.data.requested_reviewers }), field: "login" }),
      };
    },
    operation: "github.pulls.requestReviewers",
    provider: "github",
    retryMode: "never",
    scopeId: ctx.scopeId,
  });
}
