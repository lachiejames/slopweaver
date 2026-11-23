/**
 * The prologue of one review-state read: which repositories it covers, the fleet read itself, and — for the one
 * verb that asks — whether GitHub resolves each requested repository no row came back from.
 *
 * The last step exists because the fleet read is a `search`, and an unresolvable `repo:` qualifier answers it
 * with an empty list rather than an error: `github review-state --repo <a slug GitHub cannot resolve>` used to
 * print `0 of 0 open` and exit 0 (reproduce on a commit before this module with
 * `slopweaver github review-state --repo acme/no-such-repo`). `./repositoryResolutionGate.ts` owns the selection
 * and the wording; this module only decides whether a read asks at all.
 */

import type { Repository } from "../../../config.js";
import { err, ok, type Result } from "../../../lib/result.js";
import type { GithubReviewStateApi, PrLiveState } from "../../../live/github/reviewState.js";
import {
  type RepositoryResolutionVerb,
  type ResolveGithubRepository,
  repositoryResolutionRefusalLines,
} from "./repositoryResolutionGate.js";
import { buildReviewStateQuery, type GithubReviewStateArgs } from "./reviewStateCore.js";
import { readSelection } from "./reviewStateFleet.js";

/** The seams the prologue reads through: the fleet read's own, plus the two that name repositories. */
type ProvenSelectionDeps = Parameters<typeof readSelection>[0]["deps"] & {
  readonly resolveRepo: (args: { explicit: string | undefined }) => Result<Repository>;
  readonly resolveRepository: ResolveGithubRepository;
};

/** Resolve `--repo`, falling back to the current checkout's own remote when none was typed. */
function reviewStateRepos({
  repos,
  resolveRepo,
}: {
  repos: readonly string[];
  resolveRepo: ProvenSelectionDeps["resolveRepo"];
}): Result<readonly string[]> {
  if (repos.length > 0) {
    return ok(repos);
  }
  const resolved = resolveRepo({ explicit: undefined });
  return resolved.isErr() ? err(resolved.error) : ok([`${resolved.value.owner}/${resolved.value.repo}`]);
}

/**
 * Read the open pull requests the selection matches and, when the calling verb asks, refuse the read if any
 * requested repository that contributed no row is one GitHub does not resolve.
 *
 * A caller passing no verb is one that reports an unreadable repository per repository and keeps the rest of its
 * read — `github landing`'s census and the session-start GitHub leg — and is asked nothing.
 *
 * @param api the review-state GitHub seam the fleet is read through
 * @param args a parsed invocation
 * @param deps the fleet read's clock, deadline and diagnostic seams, plus the two repository seams
 * @param verb the refusing verb, or undefined for a caller that does not refuse
 * @returns the pull requests and GitHub's match count, or the lines that stopped the read
 */
export async function readProvenSelection({
  api,
  args,
  deps,
  verb,
}: {
  api: GithubReviewStateApi;
  args: GithubReviewStateArgs;
  deps: ProvenSelectionDeps;
  verb: RepositoryResolutionVerb | undefined;
}): Promise<Result<{ readonly prs: readonly PrLiveState[]; readonly total: number }>> {
  const repos = reviewStateRepos({ repos: args.repos, resolveRepo: deps.resolveRepo });
  if (repos.isErr()) {
    return err(repos.error);
  }
  const query = buildReviewStateQuery({ ...args, repos: repos.value });
  const fleet = await readSelection({ api, args, deps, query });
  if (fleet.isErr()) {
    return err([fleet.error.message]);
  }
  // A `--number` read is `repository(owner,name).pullRequest`, never a search: its success already proves the
  // repository resolves, so only a fleet read is gated.
  if (verb !== undefined && args.number === undefined) {
    const unproven = await repositoryResolutionRefusalLines({
      home: args.home,
      repos: repos.value,
      resolveRepository: deps.resolveRepository,
      rowRepos: fleet.value.rowRepos,
      verb,
    });
    if (unproven.length > 0) {
      return err(unproven);
    }
  }
  return ok({ prs: fleet.value.prs, total: fleet.value.total });
}
