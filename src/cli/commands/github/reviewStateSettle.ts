/**
 * Settling the fleet read's `UNKNOWN` mergeability before a row is judged on it — one re-read, matched by
 * repository, number AND head.
 *
 * Split from `./reviewStateRun.ts` along the seam the fleet pipeline already has: the read, then each
 * settling pass over what it returned (this one, `./reviewStateChecksCompletion.ts`'s whole check lists, the
 * base distance), then the judgment.
 */

import type { PrLiveState } from "../../../live/github/reviewState.js";
import { asGithubMergeable, type GithubMergeable } from "../../../review/reviewState.js";
import type { GithubReviewStateDeps } from "./reviewStateRun.js";

/**
 * The key one pull request is settled under — the REPOSITORY and the number, never the number alone.
 *
 * `github landing` reads two repositories in one invocation, so a bare number collides. A Codex review found
 * the collision pressing a pull request whose re-read said `CONFLICTING`: with `acme/bad#7` conflicting and
 * `acme/good#7` mergeable, the second overwrote the first under key `7` and both read mergeable, which is
 * exactly the false green this whole re-read exists to remove.
 *
 * The HEAD is part of the key too. A fleet read pages, and nothing deduplicates a pull request that appears
 * on two pages at two heads; without the head, the answer matched against one row's head would then be
 * applied to the other row as well, which is the graft the head check exists to stop. A Codex review built
 * that sequence and watched both rows read `merge-now`.
 *
 * @param pr the pull request
 * @returns `owner/name#number@head`
 */
function prKey({ pr }: { pr: PrLiveState }): string {
  return `${pr.repoSlug}#${String(pr.number)}@${pr.headOid}`;
}

/** The token GitHub gives for a mergeability it has not computed yet. */
const MERGEABLE_UNKNOWN: GithubMergeable = "UNKNOWN";

/**
 * Ask GitHub again for the pull requests it answered `UNKNOWN`, once.
 *
 * GitHub computes mergeability lazily, so the fleet read's own query is what STARTS the job — which is why
 * this runs after every page is in rather than inside the pager, and why one further request is the whole
 * mechanism. MEASURED over twenty pull requests nobody had queried: the cold read answered
 * `UNKNOWN` on 15 of 20, and a single aliased re-read 871 ms later resolved every one, with two further
 * rounds changing nothing. Reproduce over pull requests nobody has queried:
 * `slopweaver github review-state --repo acme/acme-admin --json | jq '[.pullRequests[].conflict.mergeable]
 * | group_by(.) | map({(.[0]): length}) | add'` twice in a row, and compare the `UNKNOWN` counts. The reader
 * itself is `../../../live/github/mergeableRecheck.ts`.
 *
 * A pull request the re-read could not answer keeps the `UNKNOWN` it already had, so this can only ever
 * REPLACE an uncomputed answer with a computed one — never turn a known answer into an unknown, and never
 * fail the run.
 *
 * @param prs every pull request the fleet read returned
 * @param deps the injected edges, for the re-read seam
 * @param home the state home whose credential the re-read uses
 * @returns the same pull requests, with a settled `mergeable` wherever GitHub could give one
 */
export async function settleMergeable({
  prs,
  deps,
  home,
}: {
  prs: readonly PrLiveState[];
  deps: Pick<GithubReviewStateDeps, "mergeableRecheck">;
  home: string | undefined;
}): Promise<readonly PrLiveState[]> {
  const pending = prs.filter((pr) => pr.mergeable === MERGEABLE_UNKNOWN);
  if (pending.length === 0) {
    return prs;
  }
  const answers = await deps.mergeableRecheck({ home })({ subjects: pending });
  const settled = new Map<string, GithubMergeable>();
  for (const [index, pr] of pending.entries()) {
    const answer = answers[index];
    if (answer?.kind !== "read" || answer.value.mergeable === MERGEABLE_UNKNOWN) {
      continue;
    }
    // The head can move between the fleet read and this one, and a re-read names a pull request by NUMBER.
    // Writing the new head's mergeability onto the old head's checks, threads and truncation flags would
    // assemble a row out of two different commits — a Codex review found that combination passing all six
    // landing tests over a head whose CI was red. An answer about a head we did not judge is dropped, so the
    // row keeps its `UNKNOWN` and reads `unknown` rather than being pressed on a mixture.
    if (answer.value.headOid !== pr.headOid) {
      continue;
    }
    settled.set(prKey({ pr }), asGithubMergeable({ token: answer.value.mergeable }));
  }
  return prs.map((pr) => {
    const mergeable = settled.get(prKey({ pr }));
    return mergeable === undefined ? pr : { ...pr, mergeable };
  });
}
