/**
 * The privileged reads `github merge --admin`'s preflight decides from — administrator standing, branch
 * protection, the required-context gate and the review rules. Split from `./mergeAdminRun.ts`, which owns the
 * decision, the door and the report; nothing here writes.
 */

import type { BranchProtection } from "../../../corpus/github/write.js";
import { err, ok } from "../../../lib/result.js";
import { type RequiredContextGate, requiredContextGate } from "../../../live/github/requiredContexts.js";
import type { ReviewGate } from "../../../live/github/reviewRules.js";
import type { GithubAdminMergeApi } from "../../../outbound/github/adminMerge.js";
import { GithubVerbErrors, type GithubVerbResult } from "./errors.js";

/**
 * Judge the head against the contexts its base requires, or say why that could not be established.
 *
 * A failed read answers `unreadable` rather than propagating an error, deliberately: the two reads behind it
 * are a GraphQL protection query and a REST rules query, and a token that cannot see either would otherwise
 * turn every admin merge into a refusal about permissions rather than about the merge. The preflight prints
 * the reason as a note, so a run that could not rule the false green out says so on the page.
 *
 * @param branch the base branch whose required contexts the head is judged against
 * @param number the pull request whose checks are read
 * @returns the gate, or `unreadable` carrying the failed read's message
 */
async function readRequiredContextGate({
  api,
  owner,
  repo,
  number,
  branch,
}: {
  api: GithubAdminMergeApi;
  owner: string;
  repo: string;
  number: number;
  branch: string;
}): Promise<RequiredContextGate> {
  const required = await api.requiredContexts({ branch, owner, repo });
  if (required.isErr()) {
    return { kind: "unreadable", reason: required.error.message };
  }
  const checks = await api.checks({ number, owner, repo });
  if (checks.isErr()) {
    return { kind: "unreadable", reason: checks.error.message };
  }
  return requiredContextGate({
    branch,
    checks: checks.value.checks,
    mergeable: checks.value.mergeable,
    required: required.value.contexts,
    truncated: checks.value.truncated,
  });
}

/**
 * Read every preflight fact, or the first failure that stopped one from being established.
 *
 * @param branch the base branch whose protection and review rules are read
 * @param number the pull request whose checks feed the required-context gate
 * @returns every fact, or the typed failure of the administrator or protection read
 */
export async function readPreflightFacts({
  api,
  owner,
  repo,
  number,
  branch,
}: {
  api: GithubAdminMergeApi;
  owner: string;
  repo: string;
  number: number;
  branch: string;
}): Promise<
  GithubVerbResult<{ isAdmin: boolean; protection: BranchProtection; gate: RequiredContextGate; reviews: ReviewGate }>
> {
  const isAdmin = await api.isAdmin({ owner, repo });
  if (isAdmin.isErr()) {
    return err(GithubVerbErrors.adminUnestablished({ cause: isAdmin.error.message, owner, repo }));
  }
  const protection = await api.protection({ branch, owner, repo });
  if (protection.isErr()) {
    // A DENIED read refuses in its own words; the plan-gated 403 never reaches here, it is a state on `value`.
    return err(
      protection.error.code === "PROTECTION_PERMISSION_DENIED"
        ? GithubVerbErrors.protectionPermissionDenied({ branch, denial: protection.error.message })
        : GithubVerbErrors.protectionUnread({ branch, cause: protection.error.cause.message }),
    );
  }
  const gate = await readRequiredContextGate({ api, branch, number, owner, repo });
  const reviews = await api.reviewRules({ branch, owner, repo });
  return ok({ gate, isAdmin: isAdmin.value, protection: protection.value, reviews });
}
