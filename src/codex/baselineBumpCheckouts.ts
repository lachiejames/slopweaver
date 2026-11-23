/**
 * Where the ratchet-bump witness read (`./baselineBumpWitnessRun.ts`) runs its git reads, and the merge commit it
 * judges. Any checkout of the pull request's repository on this machine — the one the verb runs in, every one a
 * pass record names, and every declared main checkout — preferring one that already holds both commits. Only a
 * full-history checkout is eligible: a shallow one can hold both commits and still lack the merge base or a
 * manifest's older base. When none holds both, the first full-history one is asked to fetch the missing commits
 * from `origin` by name (objects only: no ref and no `FETCH_HEAD` is written), which is what lets a press of
 * somebody else's pull request answer at all.
 */

import { originRepositoryOf } from "../config.js";
import { gitLines, gitSucceeds } from "../devLint/gitAtCommit.js";
import { mainCheckoutsFromProfile } from "../profileStore.js";
import { resolveRepoRoot } from "./gitDiff.js";

/** Whether a checkout holds a commit object. */
const holds = ({ root, commit }: { root: string; commit: string }): boolean =>
  gitSucceeds({ args: ["cat-file", "-e", `${commit}^{commit}`], root });

/** Every checkout the witness may ask, in preference order, and which of them the verb runs in. */
export interface CandidateCheckoutRoots {
  /** The checkout the landing verb runs in, or `undefined` when it is none. */
  readonly ownRoot: string | undefined;
  /** The distinct candidates: the verb's own, every one a pass record names, then every declared main checkout. */
  readonly roots: readonly string[];
}

/**
 * Every checkout this machine knows of that might be one of the pull request's repository: the verb's own, every
 * one a pass record names, and every declared main checkout. Nothing here asks a checkout's `origin` — that is
 * asked lazily, by {@link rootHoldingBoth} and by `qualifyingCheckouts`, because asking it of every one of
 * several hundred worktrees up front is what made a press outlast its budget (`./branchEvidenceRoots.ts`). IO edge.
 *
 * @param cwd the checkout the landing verb runs in
 * @param home the state home whose profile declares the main checkouts
 * @param recordRoots the checkouts the pass records name
 * @returns the distinct candidates in a stable order, and the verb's own root
 */
export function candidateCheckoutRoots({
  cwd,
  home,
  recordRoots,
}: {
  cwd: string;
  home: string;
  recordRoots: readonly string[];
}): CandidateCheckoutRoots {
  const own = resolveRepoRoot({ cwd });
  const ownRoot = own.isOk() ? own.value : undefined;
  const declared = mainCheckoutsFromProfile({ home }).map((checkout) => checkout.path);
  const roots = new Set([...(ownRoot === undefined ? [] : [ownRoot]), ...recordRoots, ...declared]);
  return { ownRoot, roots: [...roots] };
}

/** Whether a checkout's `origin` is the pull request's repository. */
const ofRepository = ({ root, repository }: { root: string; repository: string }): boolean => {
  const origin = originRepositoryOf({ cwd: root });
  return origin.isOk() && `${origin.value.owner}/${origin.value.repo}` === repository;
};

/**
 * Whether a checkout carries its whole history. A shallow one can hold both commits and still lack the merge
 * base or a manifest's older base, which would read as a conflict or a foreign base.
 */
const fullHistory = ({ root }: { root: string }): boolean =>
  gitLines({ args: ["rev-parse", "--is-shallow-repository"], root })?.[0] === "false";

/**
 * Whether a checkout holds a commit once `origin` has been asked for it by name when it did not (objects only:
 * no ref, no `FETCH_HEAD`). In a full-history checkout the fetch brings the commit's ancestry with it.
 */
function heldAfterFetch({ root, commit }: { root: string; commit: string }): boolean {
  if (!holds({ commit, root })) {
    gitSucceeds({ args: ["fetch", "--quiet", "--no-tags", "--no-write-fetch-head", "origin", commit], root });
  }
  return holds({ commit, root });
}

/** Which checkout the witness reads in, or how many checkouts of the repository there were when none would do. */
export type RootHoldingBothResult =
  | { readonly kind: "found"; readonly root: string }
  | { readonly kind: "missing"; readonly repositoryCheckouts: number };

/**
 * The first full-history checkout of the repository holding both commits, fetching what is missing from `origin`
 * into the first full-history one when none does. A shallow checkout is never chosen, however many objects it
 * holds. IO edge.
 *
 * LAZY, in candidate order: a checkout's origin is asked only when it is reached, its history only when its origin
 * matches, and the walk stops at the first ready one — the same checkout the eager version chose after asking all
 * of them, and the same fetch target when none is ready, because reaching that branch means every candidate was
 * asked.
 *
 * @param roots the candidate checkouts, in preference order, of any repository
 * @param commits the commits the chosen checkout must hold
 * @param repository the pull request's `owner/name`, which a checkout's `origin` must name
 * @returns the checkout, or `missing` with the count of the repository's checkouts when no full-history checkout
 *   holds both and the fetch did not supply them
 */
export function rootHoldingBoth({
  roots,
  commits,
  repository,
}: {
  roots: readonly string[];
  commits: readonly string[];
  repository: string;
}): RootHoldingBothResult {
  let repositoryCheckouts = 0;
  const complete: string[] = [];
  for (const root of roots) {
    if (!ofRepository({ repository, root })) {
      continue;
    }
    repositoryCheckouts += 1;
    if (!fullHistory({ root })) {
      continue;
    }
    complete.push(root);
    if (commits.every((commit) => holds({ commit, root }))) {
      return { kind: "found", root };
    }
  }
  const fetchedInto = complete[0];
  if (fetchedInto === undefined) {
    return { kind: "missing", repositoryCheckouts };
  }
  if (commits.every((commit) => heldAfterFetch({ commit, root: fetchedInto }))) {
    return { kind: "found", root: fetchedInto };
  }
  return { kind: "missing", repositoryCheckouts };
}

/**
 * The merge commit landing would produce — main's commit merged with the pull request's head — written as
 * loose objects only, never a ref. CI judges GitHub's synthesized merge commit, so landing judges the same
 * tree: a raw head forked before main landed a manifest would otherwise read as deleting it.
 * IO edge.
 *
 * @param root a checkout holding both commits
 * @param base main's commit, the merge's first parent
 * @param head the pull request's head commit
 * @returns the commit, or `undefined` when the two do not merge cleanly or git refused
 */
export function candidateMerge({ root, base, head }: { root: string; base: string; head: string }): string | undefined {
  // A conflicted merge exits non-zero, which `gitLines` reports as `undefined` — never a tree.
  const merged = gitLines({ args: ["merge-tree", "--write-tree", base, head], root });
  const tree = merged?.[0];
  if (tree === undefined) {
    return undefined;
  }
  const identity = ["-c", "user.name=slopweaver landing", "-c", "user.email=landing@slopweaver.invalid"];
  const written = gitLines({
    args: [...identity, "commit-tree", tree, "-p", base, "-p", head, "-m", "landing candidate"],
    root,
  });
  return written?.[0];
}
