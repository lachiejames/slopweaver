/**
 * Which repositories a fleet read must prove GitHub resolves before its zero counts as a reading, and what a verb
 * says about one that does not — shared by `github bump-drive` and `github review-state`.
 *
 * A fleet read is one `search`, and a search answers a `repo:` qualifier GitHub cannot resolve with an empty list
 * rather than an error (`../../../live/github/repositoryResolution.ts` carries the measurement). So a repository
 * that contributed NO row is ambiguous — nothing open, or nothing there — and only those are asked. One that
 * contributed a row is proven: a row's `repoSlug` is GitHub's own `nameWithOwner`. Compared case-insensitively, as
 * `./bumpDriveClose.ts`'s `supersedeKey` compares slugs.
 *
 * `github landing` and the session-start GitHub leg deliberately do NOT run this: each reports an unreadable
 * repository per repository and keeps the rest of its read, so a refusal of the whole read would be a regression.
 *
 * Residue, stated: a row is credited to a requested slug only by its spelling. If GitHub's search ever
 * answers a pre-rename `repo:` with rows under the new name, that requested slug still counts as rowless and is
 * asked, and refused, naming the slug, if `repository()` does not resolve the old name or the lookup FAILS (a 502, a
 * rate limit). That fails closed, never silent. Neither rename behaviour is measured here; crediting such a row
 * would need GitHub's repository id on every fleet row.
 */

import type { Result } from "../../../lib/result.js";
import type { GithubLiveError } from "../../../live/github/errors.js";
import type { ResolvedGithubRepository } from "../../../live/github/repositoryResolution.js";

/** The verbs that refuse a fleet read over a repository GitHub could not resolve, named in the refusal. */
export type RepositoryResolutionVerb = "github bump-drive" | "github review-state";

/** The seam that asks GitHub whether it resolves one repository, under the credential `home` names. */
export type ResolveGithubRepository = (args: {
  repoSlug: string;
  home: string | undefined;
}) => Promise<Result<ResolvedGithubRepository, GithubLiveError>>;

/**
 * The requested repositories no row came back from, deduplicated case-insensitively, in the order requested and
 * spelled as the first request spelled them.
 *
 * @param repos the repositories the pass read
 * @param rowRepos each row's repository, as GitHub named it
 * @returns the repositories whose resolution the pass has not yet seen
 */
export function repositoriesNeedingResolution({
  repos,
  rowRepos,
}: {
  repos: readonly string[];
  rowRepos: readonly string[];
}): readonly string[] {
  const seen = new Set(rowRepos.map((repo) => repo.toLowerCase()));
  const needed: string[] = [];
  for (const repo of repos) {
    const key = repo.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      needed.push(repo);
    }
  }
  return needed;
}

/**
 * The one diagnostic line a repository the read could not prove earns, distinguishing an absent repository from a
 * verification that proved nothing either way.
 *
 * @param verb the verb refusing, which opens the line
 * @param repoSlug the repository as requested
 * @param error what its resolution answered
 * @returns the line, naming the verb and the slug
 */
export function repositoryResolutionRefusalLine({
  verb,
  repoSlug,
  error,
}: {
  verb: RepositoryResolutionVerb;
  repoSlug: string;
  error: GithubLiveError;
}): string {
  if (error.code === "NOT_FOUND") {
    return (
      `${verb}: GitHub could not resolve repository ${repoSlug} — it may not exist or this credential ` +
      "cannot read it, so its zero open pull requests are not a reading; check the slug"
    );
  }
  return (
    `${verb}: repository ${repoSlug} could not be verified, so its zero open pull requests are not a reading — ` +
    error.message
  );
}

/**
 * Ask GitHub about every requested repository no row came back from, all at once, and render one refusal line per
 * repository it did not prove.
 *
 * @param verb the verb refusing, named on each line
 * @param home the state home whose credential the resolution reads under
 * @param repos the repositories the read requested
 * @param rowRepos each returned row's repository, as GitHub named it
 * @param resolveRepository the resolution seam
 * @returns one line per unproven repository, in the order requested; empty when every repository is proven
 */
export async function repositoryResolutionRefusalLines({
  verb,
  home,
  repos,
  rowRepos,
  resolveRepository,
}: {
  verb: RepositoryResolutionVerb;
  home: string | undefined;
  repos: readonly string[];
  rowRepos: readonly string[];
  resolveRepository: ResolveGithubRepository;
}): Promise<readonly string[]> {
  const candidates = repositoriesNeedingResolution({ repos, rowRepos });
  const answers = await Promise.all(candidates.map((repoSlug) => resolveRepository({ home, repoSlug })));
  const lines: string[] = [];
  answers.forEach((answer, index) => {
    if (answer.isErr()) {
      lines.push(repositoryResolutionRefusalLine({ error: answer.error, repoSlug: candidates[index]!, verb }));
    }
  });
  return lines;
}
