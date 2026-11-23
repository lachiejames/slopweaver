/**
 * The LOCAL half of a whole-forest restack: replay one branch onto its new base in a scratch worktree,
 * stage the result in a private ref, and touch neither the remote nor any worktree the operator is using.
 *
 * ## Why a scratch worktree rather than the branch's own
 *
 * `./stackSquash.ts`'s primitive rebases in the worktree that has the branch checked out, so an entry with
 * no worktree — or one checked out twice — is refused at plan time, and everything above it with it.
 * MEASURED by `github stack sync --dry-run` in acme/acme-admin: of the six stacks it walked,
 * five were stopped at position 1 for exactly that, one of them with a bottom branch sitting
 * in two worktrees at once. A scratch worktree has no such precondition — `git worktree add --detach` needs
 * only the commit — so the restack is planned from what GitHub says exists rather than from what this
 * machine happens to have checked out.
 *
 * ## Why `--onto <new base> <old base>` rather than a single-commit replay
 *
 * The one-commit rule the stack verbs carry today exists because a lone commit can be replayed with no
 * fork-point heuristic. It has a cost the owner's ruling makes unignorable: GitHub counts a pull request's commits
 * against its BASE, so orphaning an entry inflates that count — one pull request read one commit before its
 * base moved out from under it and three after — and the repair verb then refuses precisely the state the
 * defect created. Here the old base is never guessed: a child's is its parent's head as measured at the
 * start of this run, before this run moved it, and a root's is its own merge-base with its base branch. With
 * both ends known exactly, `git rebase --onto` replays a range of any length deterministically.
 *
 * ## Nothing here reaches the network, and the scratch worktree runs no repository hook
 *
 * Every function in this module is local Git. The staged result lives at
 * `refs/slopweaver/restack/<generation>/<branch>` so the rewritten commits stay reachable after the scratch
 * worktree is removed, and the operator's own branch is only moved when no worktree holds it, under a
 * compare-and-swap against the value it had.
 *
 * A Codex review pass broke the first half of that claim with a counterexample it
 * reproduced against a disposable bare origin: a repository whose `core.hooksPath` carries a `post-checkout`
 * hook that pushes gets that push run by `git worktree add`, so a verb that reaches no remote of its own
 * still causes a remote write. Every scratch-worktree call therefore points `core.hooksPath` at a path
 * inside the scratch directory that is never created, which is git's own "no hooks here" answer. This is not
 * a general hook opt-out: the scratch worktree is a machine-internal artefact that exists for one replay, so
 * running a developer's checkout hooks in it was never wanted independently of what they might do.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { err, ok } from "../../../lib/result.js";
import { GithubVerbErrors, type GithubVerbResult } from "./errors.js";
import type { GithubPushDeps } from "./pushPrimitives.js";

/**
 * Where one branch's restacked commits are staged, so removing the scratch worktree cannot lose them.
 *
 * Namespaced by GENERATION rather than by branch alone. A fixed per-branch ref is silently overwritten by
 * the next run — including one that died half way — so a reader of `refs/slopweaver/restack/<branch>` could
 * never tell which run's result it was holding, and anything later built on that ref would inherit the
 * ambiguity. One generation is one whole-forest replay, and its refs are only ever written by it.
 *
 * @param branch the branch whose replayed commits the ref holds
 * @param generationId the id of the replay that produced them
 * @returns the private ref name
 */
export function restackStagingRef({ branch, generationId }: { branch: string; generationId: string }): string {
  return `refs/slopweaver/restack/${generationId}/${branch}`;
}

/**
 * `git update-ref`'s own old-value for "this ref must not exist yet", which is how a branch is CREATED under
 * the same compare-and-swap that moves an existing one. Not a coalesced empty string: it is git's protocol.
 */
const NO_SUCH_REF_YET = "";

/** One branch's replay: the range to move, and the two ends that define it. */
export interface RestackTarget {
  readonly branch: string;
  /** The whole-forest replay this branch belongs to — see {@link restackStagingRef}. */
  readonly generationId: string;
  /** The tip of the range being replayed — the pull request's live head. */
  readonly headSha: string;
  /** What the range is currently forked from; everything after it is replayed. */
  readonly oldBaseSha: string;
  /** The commit the range must land on. */
  readonly newBaseSha: string;
}

/** What replaying one branch produced. */
export type RestackOutcome =
  | { readonly kind: "restacked"; readonly branch: string; readonly fromSha: string; readonly toSha: string }
  | { readonly kind: "conflict"; readonly branch: string; readonly reason: string }
  | { readonly kind: "failed"; readonly branch: string; readonly reason: string };

/**
 * The `-c` prefix that stops one git invocation running any repository hook, pointed at a path under the
 * scratch directory that this module never creates — see the module doc for the review that forced it.
 */
function noHooks({ scratch }: { scratch: string }): readonly string[] {
  return ["-c", `core.hooksPath=${join(scratch, ".slopweaver-no-hooks")}`];
}

/** Best-effort teardown: abort any rebase still in progress, then drop the scratch worktree and its dir. */
function tearDown({ deps, repoRoot, scratch }: { deps: GithubPushDeps; repoRoot: string; scratch: string }): void {
  deps.writeGit({ args: [...noHooks({ scratch }), "rebase", "--abort"], cwd: scratch });
  deps.writeGit({ args: [...noHooks({ scratch }), "worktree", "remove", "--force", scratch], cwd: repoRoot });
  rmSync(scratch, { force: true, recursive: true });
}

/** The conflicting paths a stopped rebase left, as one line, or a plain note when none can be read. */
function conflictDetail({ deps, scratch }: { deps: GithubPushDeps; scratch: string }): string {
  try {
    const text = deps.readGit({ args: ["diff", "--name-only", "--diff-filter=U"], cwd: scratch });
    const paths = text
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    if (paths.length === 0) {
      return "the replay stopped and left no unmerged paths to name";
    }
    return `conflicting: ${paths.join(", ")}`;
  } catch {
    return "the replay stopped and its unmerged paths could not be read";
  }
}

/**
 * Replay one branch's commits onto a new base, entirely locally, staging the result in a private ref.
 *
 * @param target the branch, the range's two ends, and where it must land
 * @param repoRoot the repository the scratch worktree is added to
 * @returns what the replay produced — never a partially applied rebase, since a conflict is aborted here
 */
export function restackOneBranch({
  deps,
  repoRoot,
  target,
}: {
  deps: GithubPushDeps;
  repoRoot: string;
  target: RestackTarget;
}): RestackOutcome {
  const scratch = mkdtempSync(join(tmpdir(), "slopweaver-restack-"));
  const added = deps.writeGit({
    args: [...noHooks({ scratch }), "worktree", "add", "--detach", scratch, target.headSha],
    cwd: repoRoot,
  });
  if (added.isErr()) {
    rmSync(scratch, { force: true, recursive: true });
    return { branch: target.branch, kind: "failed", reason: `could not open a scratch worktree: ${added.error}` };
  }
  try {
    const replayed = deps.writeGit({
      args: [
        ...noHooks({ scratch }),
        "rebase",
        "--no-update-refs",
        "--onto",
        `${target.newBaseSha}^{commit}`,
        `${target.oldBaseSha}^{commit}`,
      ],
      cwd: scratch,
    });
    if (replayed.isErr()) {
      return { branch: target.branch, kind: "conflict", reason: conflictDetail({ deps, scratch }) };
    }
    const toSha = deps.readGit({ args: ["rev-parse", "HEAD"], cwd: scratch });
    const staged = deps.writeGit({
      args: ["update-ref", restackStagingRef({ branch: target.branch, generationId: target.generationId }), toSha],
      cwd: repoRoot,
    });
    if (staged.isErr()) {
      return { branch: target.branch, kind: "failed", reason: `could not stage the result: ${staged.error}` };
    }
    return { branch: target.branch, fromSha: target.headSha, kind: "restacked", toSha };
  } finally {
    tearDown({ deps, repoRoot, scratch });
  }
}

/**
 * Which worktrees currently have one branch checked out, read from the porcelain worktree list.
 *
 * @param worktreeListText the NUL-separated output of `git worktree list --porcelain -z`
 * @returns the paths of every worktree holding it, empty when nothing does
 */
export function worktreesHolding({
  branch,
  worktreeListText,
}: {
  branch: string;
  worktreeListText: string;
}): readonly string[] {
  const holders: string[] = [];
  let path: string | undefined;
  for (const line of worktreeListText.split("\0")) {
    if (line.startsWith("worktree ")) {
      path = line.slice("worktree ".length);
      continue;
    }
    if (line === `branch refs/heads/${branch}` && path !== undefined) {
      holders.push(path);
    }
  }
  return holders;
}

/**
 * Move the operator's own branch onto its restacked commits, but only when nothing has it checked out.
 *
 * The update is a compare-and-swap against the value the branch had when the run measured it, so a branch
 * something else moved in the meantime is left exactly where that something else put it.
 *
 * @param expectedSha the value the branch is required to still hold for the move to apply
 * @param stagedRef where the replayed commits are, named in the refusal so they are never stranded unnamed
 * @returns nothing on success, or why the branch was left alone
 */
export function adoptRestackedBranch({
  branch,
  deps,
  expectedSha,
  repoRoot,
  stagedRef,
  toSha,
}: {
  branch: string;
  deps: GithubPushDeps;
  expectedSha: string;
  repoRoot: string;
  stagedRef: string;
  toSha: string;
}): GithubVerbResult<void> {
  const holders = worktreesHolding({
    branch,
    worktreeListText: deps.readGit({ args: ["worktree", "list", "--porcelain", "-z"], cwd: repoRoot }),
  });
  if (holders.length > 0) {
    return err(GithubVerbErrors.branchCheckedOut({ branch, holders, stagedRef }));
  }
  // The compare-and-swap's old value is "" when the branch does not exist locally at all, which is git's own
  // way of saying "create this, and fail if something else created it first". MEASURED in a
  // fresh clone: every branch but `main` existed only as a remote-tracking
  // ref, so a CAS against the pull request's head SHA failed for all three with `unable to resolve
  // reference` and left the restack usable only through its staging refs.
  const currentLocal = localBranchSha({ branch, deps, repoRoot });
  if (currentLocal !== undefined && currentLocal !== expectedSha) {
    return err(GithubVerbErrors.branchMoved({ branch, current: currentLocal, expected: expectedSha, stagedRef }));
  }
  const moved = deps.writeGit({
    args: ["update-ref", `refs/heads/${branch}`, toSha, casOldValue({ currentLocal })],
    cwd: repoRoot,
  });
  if (moved.isErr()) {
    return err(
      GithubVerbErrors.branchUnmoved({
        branch,
        cause: moved.error,
        from: unmovedFrom({ currentLocal }),
        to: toSha,
      }),
    );
  }
  return ok(undefined);
}

/**
 * The old value a compare-and-swap sends: the branch's current commit, or git's "must not exist yet" when
 * this checkout has no such branch. Spelled as a branch rather than a coalesce because coalescing to an
 * empty string is a house-rule violation, and as a function rather than a ternary because a ternary here is
 * an oxlint warning; the two gates agree on this shape.
 */
function casOldValue({ currentLocal }: { currentLocal: string | undefined }): string {
  if (currentLocal === undefined) {
    return NO_SUCH_REF_YET;
  }
  return currentLocal;
}

/** How a failed compare-and-swap names where the branch stood: its commit, or "absent" when it did not exist. */
function unmovedFrom({ currentLocal }: { currentLocal: string | undefined }): string {
  if (currentLocal === undefined) {
    return "absent";
  }
  return currentLocal;
}

/**
 * The fork point one branch is currently replayed FROM: its merge-base with the base's pre-run tip — the
 * `<old base>` of the `--onto` replay the module doc explains.
 *
 * @param baseTip the base branch's tip as it stood before this run moved anything
 * @param headSha the tip of the range being replayed
 * @returns the merge-base, or `undefined` when git found none or could not answer
 */
export function forkPointOf({
  baseTip,
  git,
  headSha,
  repoRoot,
}: {
  baseTip: string;
  git: GithubPushDeps;
  headSha: string;
  repoRoot: string;
}): string | undefined {
  try {
    return git.readGit({ args: ["merge-base", baseTip, headSha], cwd: repoRoot });
  } catch {
    return undefined;
  }
}

/** What the local branch currently points at, or `undefined` when this checkout has no such branch. */
function localBranchSha({
  branch,
  deps,
  repoRoot,
}: {
  branch: string;
  deps: GithubPushDeps;
  repoRoot: string;
}): string | undefined {
  try {
    return deps.readGit({ args: ["rev-parse", `refs/heads/${branch}`], cwd: repoRoot });
  } catch {
    return undefined;
  }
}
