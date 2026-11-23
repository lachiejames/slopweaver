/**
 * The classic-branch-protection half of the required-contexts read: the GraphQL query for `Ref.branchProtectionRule`
 * and the parser that shapes its answer, plus the required-contexts shape both halves answer. `./branchRules.ts` is
 * the ruleset half, and `./mergeQueue.ts` unions the two.
 */
import { optStr } from "../../corpus/slack/shape.js";
import { isRecord } from "../../lib/parsers.js";
import { err, ok, type Result } from "../../lib/result.js";
import { type GithubLiveError, GithubLiveErrors } from "./errors.js";

/**
 * The status-check contexts the base branch REQUIRES, which is what decides whether its queue gates at all.
 *
 * GitHub's merge queue takes its required contexts from the branch's "Require status checks to pass before
 * merging" rule rather than from any merge-queue setting of its own, so an EMPTY set means the queue merges
 * an entry on arrival without testing the merged result. MEASURED on `lachiejames/slopweaver`:
 * one entry was queued and its merge commit is committed 1.0 second
 * later, against a CI lap this repository measures at p50 9m23s (49 laps — see
 * `CHECKS_POLL_SCHEDULE_MS` in `./checks.ts` for the measurement and the command that reproduces it).
 */
export interface RequiredCheckContexts {
  readonly branch: string;
  readonly contexts: readonly string[];
  /**
   * Whether classic branch protection on this branch requires a CODE-OWNER review.
   *
   * `undefined` when the read could not establish it — a branch with no classic rule at all, whose
   * requirement may live in a ruleset this query does not reach. Three values rather than two, for the
   * reason `RequiredContextGate.unreadable` has three: *"this branch does not require code-owner review"*
   * and *"we never found out"* are different facts, and only the second must never read as the first.
   * A protection query that fetches only `requiredStatusCheckContexts` leaves this
   * setting unread, and an unread setting reads as no requirement at all.
   */
  readonly requiresCodeOwnerReviews: boolean | undefined;
}

/**
 * What CLASSIC branch protection says about one branch, as far as one GraphQL read can see it.
 *
 * Its own shape rather than a bare context list because the read now answers two questions and they fail
 * independently: a branch with no classic rule has no contexts AND no code-owner answer, while a branch with
 * a classic rule may require contexts and not code-owner review. Collapsing them would make the second
 * indistinguishable from the first.
 */
export interface ClassicProtection {
  readonly contexts: readonly string[];
  /** `undefined` when no classic rule was found at all — never `false`, which is a different claim. */
  readonly requiresCodeOwnerReviews: boolean | undefined;
}

export const PROTECTION_QUERY = `query SlopweaverBranchProtection($owner: String!, $repo: String!, $qualified: String!) {
  repository(owner: $owner, name: $repo) {
    ref(qualifiedName: $qualified) {
      branchProtectionRule { requiredStatusCheckContexts requiresCodeOwnerReviews }
    }
  }
}`;

/**
 * The contexts CLASSIC branch protection requires on a ref, empty when it protects the ref without them.
 *
 * A ref with no protection rule at all answers empty too: that is a state, not a fault, exactly as a
 * missing queue is. `null` for the ref itself means the branch does not exist, which the queue read has
 * already refused on by the time this runs.
 *
 * @param data the raw GraphQL response
 * @param identity the `owner/name` slug, named in a malformed-payload error
 * @returns the required contexts, or the typed read failure
 */
export function parseProtectionContexts({
  data,
  identity,
}: {
  data: unknown;
  identity: string;
}): Result<ClassicProtection, GithubLiveError> {
  const repository = isRecord(data) ? data["repository"] : undefined;
  if (!isRecord(repository)) {
    return err(GithubLiveErrors.notFound({ identity, kind: "repository" }));
  }
  const ref = repository["ref"];
  const rule = isRecord(ref) ? ref["branchProtectionRule"] : undefined;
  if (!isRecord(rule)) {
    return ok({ contexts: [], requiresCodeOwnerReviews: undefined });
  }
  const contexts = rule["requiredStatusCheckContexts"];
  const requires = rule["requiresCodeOwnerReviews"];
  return ok({
    contexts: Array.isArray(contexts)
      ? contexts.map((value) => optStr({ value })).filter((context): context is string => context !== undefined)
      : [],
    requiresCodeOwnerReviews: typeof requires === "boolean" ? requires : undefined,
  });
}
