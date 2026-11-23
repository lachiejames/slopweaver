/**
 * The safe single-commit squash-rebase primitive `stack sync` and `stack adopt` both use to move a PR's one
 * commit onto its base's fresh tip.
 *
 * ## Why not `git rebase --onto <fresh> --fork-point <base>`
 *
 * That was this repository's original mechanism, and two rounds of adversarial testing against real,
 * disposable git repositories found it can silently corrupt history. `--fork-point` recovers the historical
 * fork point from the base branch's own reflog — mutable, expirable, local-only state. With an amended base
 * (exactly what `stack push`'s `amend()` produces every time a lower PR is updated) and an expired or
 * misleading reflog, live probes reproduced BOTH failure directions: the rebase silently dropping the PR's
 * entire change, and silently resurrecting content the fresh base had deliberately removed — while exiting
 * 0 either way. A follow-up design that verified the result via `git patch-id` was ALSO broken: patch-id is
 * documented as "reasonably unique" for duplicate detection, not a cryptographic proof, and a multi-commit
 * branch cherry-picked by its tip commit alone can pass that verification while silently dropping earlier
 * commits' content.
 *
 * ## The fix: stop guessing from local git state, ask GitHub
 *
 * GitHub's own pull-request API reports a commit's count and exact head SHA authoritatively — server-side
 * facts, not a local heuristic. Given that this PR has EXACTLY ONE commit (refused otherwise, no escape
 * hatch — the ambiguity a multi-commit fallback would need to resolve is exactly what broke the prior
 * designs), that one commit's own PARENT is a direct, unambiguous graph fact (read straight from the commit
 * object, not a `<headSha>^` revision expression — see {@link commitParents} for why), needing no reflog or
 * fork-point heuristic at all. `git rebase --onto <freshBase> <parentSha>` replays exactly that one commit,
 * deterministically, using git's own well-tested rebase/conflict machinery on the real checked-out branch —
 * the same trust boundary every ordinary rebase already rests on, not an invented verification layer on top
 * of it.
 *
 * The base's fresh tip is fetched into a uniquely-named PRIVATE ref, never the shared `FETCH_HEAD` — a
 * concurrent, unrelated `git fetch` anywhere in the same repository (including another worktree sync itself
 * discovers) can silently overwrite `FETCH_HEAD` between writing and reading it, a race live-reproduced
 * against a real repository.
 *
 * ## Two more live-reproduced findings, both fixed here
 *
 * A raw 40-hex SHA passed as a git argument is not unambiguous: git's own revision resolution can match a
 * LOCAL BRANCH whose name happens to be that exact hex string before it falls back to treating the string
 * as an object id — live-confirmed against a real repository (a `push <sha>:<dst>` moved the shadowing
 * branch's target, not the named commit). Every raw SHA this module passes to a git command is therefore
 * suffixed `^{commit}`, which forces object resolution and cannot be shadowed this way.
 *
 * A `git rebase --onto <fresh> <parent>` with no explicit third argument operates on whatever the CHECKED-
 * OUT branch happens to be at the moment it runs, not necessarily the `headSha` this module already
 * confirmed was checked out during preflight — the base fetch above can take real network time, during
 * which an external git process could move the checked-out branch. This re-confirms immediately before the
 * rebase call, narrowing that window from "however long the fetch takes" to two adjacent local git calls
 * with no I/O between them.
 *
 * ## A base rewound to something it already was, between the caller's GitHub read and this fetch
 *
 * A caller establishes "exactly one commit" from GitHub's live `commits` field, moments before calling this
 * function. That field is computed relative to whatever the base currently is — so a base force-pushed back
 * to an OLDER commit ON THE SAME LINEAGE this commit's own parent descends from, in the window between that
 * read and the fetch here, turns a genuinely-one-commit PR into a two-commit one invisibly to a check the
 * caller already ran. Replaying just this one commit onto that rewound base would then silently drop the
 * parent commit's own diff, while every other check (the head SHA never moved) still reports success.
 *
 * The narrow, git-native signal for exactly this: is the FETCHED base a strict ancestor of this commit's own
 * recorded PARENT? If so, the base has gone backward along the same lineage this commit forked from, and
 * replaying onto it drops the parent's content. This check is deliberately narrow rather than "the base must
 * be a descendant of the parent" — that broader version would refuse the single most common case this whole
 * module exists to serve: `stack push`'s own `amend()` REWRITES the base's tip on every push, producing a new
 * commit with NO ancestry relationship to the one it replaced. An amended base and a rewound-to-an-ancestor
 * base are NOT the same shape from git's perspective — amend produces UNRELATED history (safe to rebase
 * across, by this module's whole design philosophy of trusting whatever the base currently is), while a
 * rewind produces an ANCESTOR (unsafe, because it discards a diff this commit's own lineage already passed
 * through). Only the second shape is refused.
 *
 * **Known, accepted residual: a base swapped to a SIBLING of this commit's parent.** If the base is amended
 * more than once — tip P0, amended to sibling P1 (same parent, different content), main pointing at P1 when
 * this commit's "one commit" count was established — and an external actor then restores the base to P0
 * between that read and this fetch, `merge-base(P0, P1)` is P0/P1's own shared parent, not P0 itself: P0 is
 * NOT a strict ancestor of P1, so this check permits it, exactly as it permits an ordinary amend. Replaying
 * onto P0 then drops whatever P1 uniquely added. This is refused nowhere because it is GIT-INDISTINGUISHABLE
 * from a legitimate amend using any signal this module reads — telling them apart would require tracking
 * "which commit did we ourselves last observe as the base," out-of-band local state with exactly the
 * fragility `--fork-point`'s reflog-dependence was rejected for at the top of this file. Requires an external
 * actor with push access to the BASE branch flipping it between two specific prior states inside the fetch's
 * own network round trip; accepted as the design's philosophical floor, not chased further.
 */
import { err, ok } from "../../../lib/result.js";
import { GithubVerbErrors, type GithubVerbResult } from "./errors.js";
import { deletePrivateRef, fetchBranchIntoPrivateRef, newPrivateFetchRef } from "./gitAncestry.js";
import type { GithubPushDeps } from "./pushRun.js";

export type StackSquashResult = GithubVerbResult<void>;

/**
 * One commit's own parent SHAs, from git's own graph model via `rev-list --parents` — never text-parsed out
 * of the raw commit object (an earlier version of this function did via `cat-file`, and scanning ANY
 * boundary-guessed slice of that free-form text turned out to be adversarially defeatable: a commit message
 * shaped to look like a header line, or a header/message separator that isn't a plain `\n\n`, could each
 * make text-scanning miscount the parents). `rev-list --parents -1 <sha>` prints exactly
 * `<sha> [parent1] [parent2...]` on one line — it is git's own answer to "what are this commit's parents",
 * not a guess reconstructed from bytes. `^{commit}` still guards the SHA itself against a same-named local
 * branch shadowing it (a real, separately-confirmed ambiguity when a bare 40-hex string names a ref).
 *
 * **Known, accepted limitation**: in a SHALLOW clone (`git clone --depth N`), `rev-list --parents` honors
 * the shallow boundary and can report a non-root commit as having 0 parents even though its real, recorded
 * parent exists beyond the fetched history. This makes {@link preflight} refuse with "no parent" rather than
 * proceeding — a false refusal, not a corruption, since it fails toward doing nothing rather than doing the
 * wrong thing. A normal PR worktree is not shallow; this is deliberately left undetected rather than adding
 * an `--is-shallow-repository` check and an auto-unshallow step for a git configuration nobody has reported
 * hitting in practice.
 */
function commitParents({
  commitSha,
  cwd,
  git,
}: {
  commitSha: string;
  cwd: string;
  git: GithubPushDeps;
}): readonly string[] {
  const line = git.readGit({ args: ["rev-list", "--parents", "-1", `${commitSha}^{commit}`], cwd });
  const [, ...parents] = line.split(/\s+/);
  return parents;
}

/**
 * Whether `ancestor` is an ancestor of, or identical to, `descendant` — via `git merge-base`, which is true
 * exactly when their merge-base IS `ancestor` itself. Two commits with no common history at all fail
 * `merge-base` outright; that is treated the same as "not an ancestor" rather than propagating the error,
 * since unrelated history is just as unsafe to rebase across as a diverged one.
 *
 * **Shares {@link commitParents}'s shallow-clone limitation.** In a shallow clone, `merge-base` also honors
 * the shallow boundary and can report "no common history" for two commits that DO share history beyond the
 * fetched depth — collapsing into the same "unrelated" (allowed) result as a genuine amend, rather than the
 * "ancestor" (refused) result a real rewind-past-the-boundary would otherwise produce. This fails OPEN rather
 * than closed here, unlike `commitParents`'s fail-closed shallow case — accepted for the same reason: a
 * normal PR worktree is not shallow.
 *
 * @param ancestor the commit that must be reachable from `descendant`
 * @param descendant the commit to check ancestry from
 * @param cwd the worktree to run git in
 * @param git the injectable Git primitives
 * @returns true when `ancestor` is `descendant` or one of its ancestors
 */
function isAncestorOrSelf({
  ancestor,
  descendant,
  cwd,
  git,
}: {
  ancestor: string;
  descendant: string;
  cwd: string;
  git: GithubPushDeps;
}): boolean {
  try {
    const mergeBase = git.readGit({
      args: ["merge-base", `${ancestor}^{commit}`, `${descendant}^{commit}`],
      cwd,
    });
    return mergeBase === ancestor;
  } catch {
    return false;
  }
}

/** Preflight checks before touching anything — every one refuses rather than guesses. */
function preflight({
  worktreePath,
  headSha,
  git,
}: {
  worktreePath: string;
  headSha: string;
  git: GithubPushDeps;
}): GithubVerbResult<string> {
  const localHead = git.readGit({ args: ["rev-parse", "HEAD"], cwd: worktreePath });
  if (localHead !== headSha) {
    return err(GithubVerbErrors.squashHeadMismatch({ headSha, localHead }));
  }
  const parents = commitParents({ commitSha: headSha, cwd: worktreePath, git });
  if (parents.length > 1) {
    return err(GithubVerbErrors.squashMergeCommit({ headSha, parents: parents.length }));
  }
  if (parents.length === 0) {
    return err(GithubVerbErrors.squashParentless({ headSha }));
  }
  return ok(parents[0]!);
}

/**
 * Whether the fetched base has gone backward to a strict ancestor of this commit's own recorded parent —
 * not merely being unrelated to it, which is what an ordinary `amend()` produces on every push. Replaying
 * onto that shape would silently drop the parent's own diff. See the module doc's "rewound to something it
 * already was" section for why only this narrow shape is refused.
 *
 * @param fetchedBaseSha the base's freshly fetched tip
 * @param parentSha this commit's own recorded parent
 * @param worktreePath the worktree to run git in
 * @param git the injectable Git primitives
 * @returns the refusal reason, or `undefined` when this shape is not present
 */
function backwardBaseRefusal({
  fetchedBaseSha,
  parentSha,
  worktreePath,
  git,
}: {
  fetchedBaseSha: string;
  parentSha: string;
  worktreePath: string;
  git: GithubPushDeps;
}): string | undefined {
  if (
    fetchedBaseSha !== parentSha &&
    isAncestorOrSelf({ ancestor: fetchedBaseSha, cwd: worktreePath, descendant: parentSha, git })
  ) {
    return (
      `the fetched base (${fetchedBaseSha}) is a strict ancestor of this commit's own recorded parent ` +
      `(${parentSha}) — the base has gone backward to something it already was, and replaying just this ` +
      "one commit onto it would silently drop the parent commit's own content"
    );
  }
  return undefined;
}

/**
 * Move a PR's one commit onto its base's fresh tip, safely — see the module doc for why this replaces
 * `--fork-point`. Refuses rather than guesses at every step; never touches history it cannot fully verify.
 *
 * @param worktreePath the worktree the branch is checked out in
 * @param baseBranch the base branch to fetch and rebase onto
 * @param remote the configured Git remote
 * @param headSha the PR's GitHub-reported head SHA — the exact, sole commit this replays
 * @param git the injectable Git primitives
 * @returns ok on a clean rebase, or the refusal reason (a real conflict, a stale checkout, a merge commit)
 */
export function rebaseSingleCommitOntoFreshBase({
  worktreePath,
  baseBranch,
  remote,
  headSha,
  git,
}: {
  worktreePath: string;
  baseBranch: string;
  remote: string;
  headSha: string;
  git: GithubPushDeps;
}): StackSquashResult {
  const pre = preflight({ git, headSha, worktreePath });
  if (pre.isErr()) {
    return err(pre.error);
  }
  // Allocated BEFORE the fetch, so cleanup below has a target even when the fetch itself reports failure —
  // Git may have already updated the ref locally before returning an error. See the module doc.
  const ref = newPrivateFetchRef();
  try {
    const fetched = fetchBranchIntoPrivateRef({ branch: baseBranch, cwd: worktreePath, git, ref, remote });
    if (fetched.isErr()) {
      return err(GithubVerbErrors.baseUnfetched({ baseBranch, cause: fetched.error.message, remote }));
    }
    const { sha } = fetched.value;
    const backward = backwardBaseRefusal({ fetchedBaseSha: sha, git, parentSha: pre.value, worktreePath });
    if (backward !== undefined) {
      return err(GithubVerbErrors.factRefused({ reason: backward, subject: sha }));
    }
    // The fetch above can take real network time; re-confirm the checked-out branch has not moved in that
    // window before handing an unpinned rebase whatever HEAD now is — see the module doc.
    const stillHead = git.readGit({ args: ["rev-parse", "HEAD"], cwd: worktreePath });
    if (stillHead !== headSha) {
      return err(GithubVerbErrors.squashHeadMoved({ now: stillHead, was: headSha }));
    }
    return git
      .writeGit({
        args: ["rebase", "--no-update-refs", "--onto", `${sha}^{commit}`, `${pre.value}^{commit}`],
        cwd: worktreePath,
      })
      .mapErr((cause) => GithubVerbErrors.upstreamRefused({ operation: "rebase", reasons: [cause] }));
  } finally {
    // Surfaced, never swallowed: a leaked ref used to be silently "untidy, never unsafe", but a caller that
    // fetched successfully and then failed to clean up should not read as having run without a trace.
    const deleted = deletePrivateRef({ cwd: worktreePath, git, ref });
    if (deleted.isErr()) {
      git.out({ line: `warning: could not delete private ref ${ref}: ${deleted.error.message}` });
    }
  }
}
