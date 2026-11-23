/**
 * The CODEOWNERS read `slopweaver github review-state` makes once per repository in the fleet, parsed into the
 * rules `./reviewStateOwnership.ts` judges each pull request's owners against.
 */

import { parseRepositorySlug } from "../../../config.js";
import type { GithubReviewStateApi, PrLiveState } from "../../../live/github/reviewState.js";
import { parseCodeowners } from "../../../review/codeowners.js";
import type { RepoCodeowners } from "./reviewStateReport.js";

/**
 * Every distinct repository slug the fleet returned, so CODEOWNERS is fetched once per repository.
 *
 * @returns each non-empty slug once, in the order the fleet first named it
 */
export function repoSlugsOf({ prs }: { prs: readonly PrLiveState[] }): readonly string[] {
  return [...new Set(prs.map((pr) => pr.repoSlug))].filter((slug) => slug !== "");
}

/**
 * Fetch and parse each repository's CODEOWNERS, keyed by slug. A repository with none maps to empty rules.
 *
 * @returns each readable slug's parsed CODEOWNERS, empty rules when it has none or the read failed
 */
export async function readCodeowners({
  api,
  slugs,
  onProblem,
}: {
  api: GithubReviewStateApi;
  slugs: readonly string[];
  onProblem: (line: string) => void;
}): Promise<ReadonlyMap<string, RepoCodeowners>> {
  const byslug = new Map<string, RepoCodeowners>();
  for (const slug of slugs) {
    const parsed = parseRepositorySlug({ slug });
    if (parsed.isErr()) {
      continue;
    }
    const fetched = await api.codeowners({ owner: parsed.value.owner, repo: parsed.value.repo });
    if (fetched.isErr()) {
      onProblem(`could not read ${slug}'s CODEOWNERS: ${fetched.error.message}`);
      byslug.set(slug, { path: "", rules: [] });
      continue;
    }
    const blob = fetched.value;
    byslug.set(
      slug,
      blob === undefined
        ? { path: "", rules: [] }
        : { path: blob.path, rules: parseCodeowners({ content: blob.content }) },
    );
  }
  return byslug;
}
