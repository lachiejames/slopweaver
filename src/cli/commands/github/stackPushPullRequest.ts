/**
 * Which pull request a `github stack push` describes: the branch's open one, or one not yet opened.
 *
 * Re-run on a branch that already has an open pull request, a stack push is an update: it amends, pushes, and its
 * create step ends at the reservation's duplicate refusal, which names `pr update`. Both description reviews it asks
 * (the early one before the amend, and the create's own) must then describe THAT pull request, existing comments
 * included, or the reviewed packet is one no later write sends. This module makes the ONE read that decides it, and
 * `./stackPushRun.ts` hands the same answer to both checks.
 */
import { err, ok } from "#lib/result.js";

import type { GithubWriteApi, WrittenPr } from "../../../corpus/github/write.js";
import { GithubVerbErrors, type GithubVerbResult } from "./errors.js";
import type { DescriptionPullRequest } from "./prDescriptionReviewCore.js";
import type { GithubStackPushPlan } from "./stackPushCore.js";

/** The open pull request GitHub reported for the branch, read as the pull request the form addresses. */
function describedPullRequest({
  found,
  plan,
}: {
  found: WrittenPr | undefined;
  plan: GithubStackPushPlan;
}): GithubVerbResult<DescriptionPullRequest> {
  if (found === undefined) {
    return ok({ kind: "new" });
  }
  const { base, head } = plan.form.target;
  if (found.baseRef !== base) {
    // The read filters on the head alone, so another base is not proof of either answer: refuse.
    return err(
      GithubVerbErrors.stackPushOpenPrBaseMismatch({
        actualBase: found.baseRef,
        expectedBase: base,
        head,
        number: found.number,
      }),
    );
  }
  return ok({ kind: "existing", number: found.number });
}

/**
 * Read once whether the branch already has an open pull request, before anything is amended or pushed.
 *
 * A failed read refuses rather than answering `new`: a guess there would review a packet with no existing comments
 * for a pull request that has some.
 *
 * @param api the one GitHub read this needs
 * @param plan the gate-checked plan, whose form names the repository, head and base
 * @returns the pull request both description reviews describe, or why it could not be established
 */
export async function resolveStackPushPullRequest({
  api,
  plan,
}: {
  api: Pick<GithubWriteApi, "findOpenPrByHead">;
  plan: GithubStackPushPlan;
}): Promise<GithubVerbResult<DescriptionPullRequest>> {
  const { owner, repo, head } = plan.form.target;
  const found = await api.findOpenPrByHead({ head, owner, repo });
  if (found.isErr()) {
    return err(GithubVerbErrors.stackPushOpenPrUnread({ cause: found.error.message, head, repo: `${owner}/${repo}` }));
  }
  return describedPullRequest({ found: found.value, plan });
}
