/**
 * How many pull requests the fleet landed on each UTC day — the denominator of the token pass's cost per
 * landed change.
 *
 * The fleet pushes and lands as the token's own account, so a merged pull request AUTHORED BY `@me` is one it
 * landed. `@me` is GitHub's own alias for the token's viewer, so no login is ever written into the repository
 * (a per-install id resolves from `$SLOPWEAVER_HOME`, never a constant). A change a teammate
 * authored and the fleet merged is not counted; the report says so rather than guessing.
 *
 * One search per day per repository, each asking only for `issueCount` — a week over two repositories is
 * fourteen one-point GraphQL calls.
 */
import { err, ok, type Result } from "../../lib/result.js";
import { COUNT_QUERY } from "./coderabbitYieldQueries.js";
import { fieldOf } from "./coderabbitYieldWalk.js";
import { type GithubLiveError, GithubLiveErrors } from "./errors.js";
import type { GithubReadGraphql } from "./read.js";

/** Changes landed on one UTC day. */
export interface LandedOnDay {
  readonly day: string;
  readonly landed: number;
}

/**
 * The search string for one repository's merged pull requests on one UTC day.
 *
 * @param repo `owner/name`
 * @param day `YYYY-MM-DD`, read as a UTC day
 * @returns the GitHub search query
 */
export function landedSearchQuery({ repo, day }: { repo: string; day: string }): string {
  return `is:pr is:merged repo:${repo} author:@me merged:${day}T00:00:00+00:00..${day}T23:59:59+00:00`;
}

/**
 * Count the changes landed on each day, summed across the repositories.
 *
 * @param graphql the one-door GraphQL read
 * @param repos `owner/name` for each repository counted
 * @param days the UTC days of the window
 * @returns one entry per day, or the first read that failed
 */
export async function countLandedByDay({
  graphql,
  repos,
  days,
}: {
  graphql: GithubReadGraphql;
  repos: readonly string[];
  days: readonly string[];
}): Promise<Result<readonly LandedOnDay[], GithubLiveError>> {
  const counted: LandedOnDay[] = [];
  for (const day of days) {
    let landed = 0;
    for (const repo of repos) {
      const response = await graphql({ query: COUNT_QUERY, variables: { q: landedSearchQuery({ day, repo }) } });
      if (response.isErr()) {
        return err(response.error);
      }
      const count = fieldOf({ key: "issueCount", value: fieldOf({ key: "search", value: response.value }) });
      if (typeof count !== "number") {
        return err(GithubLiveErrors.readFailed({ message: `GitHub returned no issueCount for ${repo} on ${day}` }));
      }
      landed += count;
    }
    counted.push({ day, landed });
  }
  return ok(counted);
}
