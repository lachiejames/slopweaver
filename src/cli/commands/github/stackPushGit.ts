/**
 * `github stack push`'s Git half: reading the local and remote facts it plans from, pinning the tree it may
 * amend, and the amend-then-push that puts the branch on the remote before the pull request is opened.
 *
 * Split out of `./stackPushRun.ts` when that file crossed the size ratchet. Everything here goes through
 * `pushRun.ts`'s injectable Git deps and `pushCore.ts`'s exact-lease plan builder — no primitive here spells
 * a git argument the plain `github push` verb does not already own.
 */
import { type GithubPushFacts, pushAndVerify } from "../../../admit/githubPush.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { withholdingCredentialLines } from "../../../outbound/github/descriptionWords.js";
import type { PrOutcome } from "./core.js";
import {
  githubPushPlan,
  githubRepoFromRemote,
  invocationDir,
  NO_BASE_FRESHNESS_ACKNOWLEDGEMENT,
  NO_ORPHANS_ACCEPTED,
  parseRemoteSnapshot,
} from "./pushCore.js";
import { type GithubPushDeps } from "./pushRun.js";
import type { GithubStackPushArgs, GithubStackPushFacts, GithubStackPushPlan } from "./stackPushCore.js";
import type { GithubStackPushDeps } from "./stackPushDeps.js";
import {
  type StackPushAmendPin,
  stackPushCommitDriftReason,
  stackPushLineageReason,
  stackPushTreeDrift,
  stackPushTreeDriftReason,
  stackPushUnaskedUntracked,
  stackPushUnaskedUntrackedReason,
} from "./stackPushTree.js";

/**
 * Read every local Git fact this verb needs, without touching the network.
 *
 * @param cwd the directory to resolve the repository root from
 * @param remote the configured Git remote whose URL names the repository
 * @returns the repository root, the checked-out branch and commit, and the `owner/name` slug
 */
function localFacts({ cwd, remote, git }: { cwd: string; remote: string; git: GithubPushDeps }): {
  readonly repoRoot: string;
  readonly branch: string;
  readonly headSha: string;
  readonly repo: string;
} {
  const repoRoot = git.readGit({ args: ["rev-parse", "--show-toplevel"], cwd });
  const branch = git.readGit({ args: ["symbolic-ref", "--quiet", "--short", "HEAD"], cwd: repoRoot });
  const headSha = git.readGit({ args: ["rev-parse", "HEAD"], cwd: repoRoot });
  const remoteUrl = git.readGit({ args: ["remote", "get-url", remote], cwd: repoRoot });
  const repo = githubRepoFromRemote({ url: remoteUrl });
  if (repo === undefined) {
    throw new Error(`remote ${remote} is not an owner/name Git repository URL`);
  }
  return { branch, headSha, repo, repoRoot };
}

/**
 * Read the remote's default branch, without touching local state.
 *
 * @param branch the checked-out branch, fetched in the same `ls-remote` so one round trip answers both
 * @returns the remote's default branch name
 */
function remoteDefaultBranch({
  branch,
  remote,
  repoRoot,
  git,
}: {
  branch: string;
  remote: string;
  repoRoot: string;
  git: GithubPushDeps;
}): string {
  const text = git.readGit({
    args: ["ls-remote", "--symref", remote, "HEAD", `refs/heads/${branch}`],
    cwd: repoRoot,
  });
  const snapshot = parseRemoteSnapshot({ branch, text });
  if (!snapshot.isOk()) {
    throw new Error(snapshot.error.message);
  }
  return snapshot.value.defaultBranch;
}

/**
 * Turn an unknown Git failure into one bounded refusal line.
 *
 * @returns the caught value's message, or its string form when it is not an `Error`
 */
function gitFailure({ error }: { error: unknown }): string {
  // A failed `execFileSync` message carries the command and git's stderr on separate lines; the refusal is one.
  return (error instanceof Error ? error.message : String(error)).trim().replaceAll(/\s*\n\s*/g, " | ");
}

/**
 * The paths the add would newly track that nobody chose — read off the PINNED tree, never off the worktree.
 *
 * The pinned tree is exactly what the amend may commit (the drift check holds it there), so the new paths are
 * read from it rather than from a second `ls-files` read: Codex's review reproduced a file present at the
 * pin, deleted for that read, and recreated byte-identical before the amend, which slipped through both. Every
 * pinned path is read, not only those added against HEAD: a path staged out with `git rm --cached` and left in
 * the worktree matches HEAD in the pin, so an added-only read missed it. A dry run pins nothing and commits
 * nothing, so it lists the worktree's untracked paths instead. Chosen is what HEAD's own commit changed or any
 * path the index holds, intent-to-add entries included; a staged deletion holds no entry.
 *
 * @param amendPin the tree the amend may commit, or the dry-run marker
 * @param headSha the commit stack push was run over; read by sha so a moved HEAD changes nothing here
 * @returns the unasked untracked paths, sorted; empty when the amend adds nothing nobody chose
 */
function unaskedUntracked({
  amendPin,
  git,
  headSha,
  repoRoot,
}: {
  amendPin: StackPushAmendPin;
  git: GithubPushDeps;
  headSha: string;
  repoRoot: string;
}): readonly string[] {
  // Replace refs never travel with a push, so none may fake what HEAD changed or what the tree adds.
  const read = ({ args }: { args: readonly string[] }): string =>
    git.readGit({ args: ["--no-replace-objects", ...args], cwd: repoRoot });
  const names = ["-r", "--no-renames", "--name-only", "-z"];
  const untrackedNul =
    amendPin.kind === "pinned"
      ? read({ args: ["ls-tree", "-r", "--name-only", "-z", amendPin.tree] })
      : read({ args: ["ls-files", "--others", "--exclude-standard", "-z"] });
  return stackPushUnaskedUntracked({
    heldNul: read({ args: ["ls-files", "--cached", "-z"] }),
    touchedNul: read({ args: ["diff-tree", "--root", "--no-commit-id", ...names, headSha] }),
    untrackedNul,
  });
}

/** A dry run stages nothing, not even into a scratch index, so it pins nothing either. */
function stackPushAmendPin({
  deps,
  dryRun,
  repoRoot,
}: {
  deps: GithubStackPushDeps;
  dryRun: boolean;
  repoRoot: string;
}): Result<StackPushAmendPin, string> {
  if (dryRun) {
    return ok({ kind: "dry-run" });
  }
  return deps.captureAmendTree({ repoRoot }).map((tree): StackPushAmendPin => ({ kind: "pinned", tree }));
}

/**
 * The live Git facts, or undefined once the one refusal line has already been printed.
 *
 * The amend pin is taken HERE, straight after the local reads and before the network, every gate, the door
 * and the lock wait: whatever happens to the worktree from now on cannot reach the commit
 * (`./stackPushTree.ts`). Taken next to the amend instead, it would pin the very edit it exists to refuse.
 *
 * @param args the parsed invocation: where it stands, which remote, and whether it is a dry run
 * @param deps the Git edges, the pin edge and the output sink
 * @returns the facts the plan is built from, or undefined once the refusal is printed
 */
export function resolveStackPushFacts({
  args,
  deps,
}: {
  args: Pick<GithubStackPushArgs, "cwd" | "dryRun" | "remote">;
  deps: GithubStackPushDeps;
}): GithubStackPushFacts | undefined {
  try {
    const local = localFacts({ cwd: invocationDir({ cwd: args.cwd }), git: deps.git, remote: args.remote });
    const amendPin = stackPushAmendPin({ deps, dryRun: args.dryRun, repoRoot: local.repoRoot });
    if (!amendPin.isOk()) {
      deps.out({ line: `refused: could not pin the worktree for stack push: ${amendPin.error}` });
      return undefined;
    }
    const unasked = unaskedUntracked({
      amendPin: amendPin.value,
      git: deps.git,
      headSha: local.headSha,
      repoRoot: local.repoRoot,
    });
    if (unasked.length > 0) {
      deps.out({ line: `refused: ${stackPushUnaskedUntrackedReason({ paths: unasked })}` });
      return undefined;
    }
    const defaultBranch = remoteDefaultBranch({
      branch: local.branch,
      git: deps.git,
      remote: args.remote,
      repoRoot: local.repoRoot,
    });
    return { ...local, amendPin: amendPin.value, defaultBranch };
  } catch (error: unknown) {
    // Git's own failure text can quote a ref or a remote URL, so a credential shape is withheld from the log.
    deps.out({ line: withholdingCredentialLines({ lines: [`refused: ${gitFailure({ error })}`] }).join("") });
    return undefined;
  }
}

/**
 * Amend the worktree into the current commit — but only the tree pinned before the gates ran.
 *
 * Branch and HEAD are re-read first: a checkout or commit made while the verb waited would otherwise have
 * the pin's tree amended onto the wrong commit. Then the real `git add --all` stages, and `write-tree` reads
 * back what it staged; the commit runs only when that is the pinned tree, so an ordinary mid-push edit
 * refuses with nothing committed. When that tree is already HEAD's there is nothing to amend, and HEAD is
 * returned unchanged rather than re-stamped; a real amend prints `amended <old> → <new>`.
 *
 * The commit itself is then checked too ({@link amendedCommitRefusal}), because the index and the branch can
 * both still move INSIDE `commit --amend`. Codex's reviews reproduced each: a `pre-commit` hook that rewrites
 * and stages a tracked file, a `git replace` installed to fake the tree read, and a branch moved to a
 * same-tree commit between the HEAD re-read and the amend. The sha returned is the one checked, and the push
 * sends that sha rather than re-reading HEAD.
 *
 * @returns the sha to push, HEAD itself when there was nothing to amend, else the amended commit's; a
 *   `refused` outcome when the pin no longer holds — before the commit
 *   when the worktree or HEAD moved, after it (HEAD amended locally, nothing sent) when the commit is not the
 *   checked HEAD amended with the pinned tree; `unconfirmed` when the commit itself failed
 */
function amend({
  plan,
  git,
  locus,
}: {
  plan: GithubStackPushPlan;
  git: GithubPushDeps;
  locus: string;
}): Result<string, PrOutcome> {
  const { amendPin, branch, headSha, repoRoot } = plan.facts;
  if (amendPin.kind !== "pinned") {
    return err({ kind: "refused", reason: "a dry run has no pinned tree to amend; nothing was committed" });
  }
  const branchNow = git.readGit({ args: ["symbolic-ref", "--quiet", "--short", "HEAD"], cwd: repoRoot });
  const headNow = git.readGit({ args: ["rev-parse", "HEAD"], cwd: repoRoot });
  if (branchNow !== branch || headNow !== headSha) {
    return err({
      kind: "refused",
      reason:
        `HEAD moved while stack push ran (${branch}@${headSha} → ${branchNow}@${headNow}); nothing was ` +
        "staged, committed or sent",
    });
  }
  git.readGit({ args: plan.addArgs, cwd: repoRoot });
  const stagedTree = git.readGit({ args: ["write-tree"], cwd: repoRoot });
  const staged = driftFromPin({ git, pinnedTree: amendPin.tree, repoRoot, tree: stagedTree });
  if (staged.length > 0) {
    return err({ kind: "refused", reason: stackPushTreeDriftReason({ paths: staged }) });
  }
  // Nothing to amend: an amend here mints a new sha over the same tree, parent, author and message, only the
  // committer date moved, and stales every review and proof taken on the head. Measured on pushed branches:
  // `git reflog <branch>` shows the `commit (amend)` entry, and `git show -s --format='%T %P %ai %ci'` over
  // its old and new sha differs in the committer date alone.
  const headTree = git.readGit({ args: [NO_REPLACE, "rev-parse", `${headSha}^{tree}`], cwd: repoRoot });
  if (headTree === stagedTree) {
    return ok(headSha);
  }
  const committed = git.writeGit({ args: plan.amendArgs, cwd: repoRoot });
  if (!committed.isOk()) {
    return err({ detail: `amend failed: ${committed.error}`, kind: "unconfirmed", locus });
  }
  const amendedSha = git.readGit({ args: ["rev-parse", "HEAD"], cwd: repoRoot });
  // Printed before the post-amend checks: a refusal after this point still leaves HEAD moved locally.
  git.out({ line: `amended ${headSha} → ${amendedSha}` });
  const refusal = amendedCommitRefusal({ amendedSha, git, headSha, pinnedTree: amendPin.tree, repoRoot });
  if (refusal !== undefined) {
    return err({ kind: "refused", reason: refusal });
  }
  return ok(amendedSha);
}

/**
 * Every git read here ignores replace refs: they never travel with a push, so one a hook installed would
 * show the checked shape locally while the remote received the commit's real one.
 */
const NO_REPLACE = "--no-replace-objects";

/**
 * Parents, author identity and date, and message: what `commit --amend --no-edit` carries over unchanged. The
 * closing `%x00.` is a sentinel: `readGit` trims its output, and without it a hook that only added trailing
 * whitespace to the message would compare equal.
 */
const AMEND_LINEAGE_FORMAT = "--format=%P%x00%an%x00%ae%x00%ai%x00%B%x00.";

/**
 * Why the commit just made is not the checked HEAD amended with the pinned tree, or undefined when it is.
 *
 * Two things can move inside `commit --amend`, after every pre-commit check: the index (a hook re-staging
 * what it formatted) and the branch itself (another process moving it in the gap, which the amend then
 * rewrites instead). The tree check catches the first and the lineage check the second: an amend keeps the
 * parents, author and message of the commit it rewrote, so matching the checked commit's means the result
 * is exactly that commit with the pinned tree, whatever the branch briefly pointed at.
 *
 * @param headSha the commit stack push was run over, re-checked before staging
 * @param amendedSha the commit `commit --amend` produced
 * @returns the refusal reason, or undefined when the commit may be pushed
 */
function amendedCommitRefusal({
  amendedSha,
  git,
  headSha,
  pinnedTree,
  repoRoot,
}: {
  amendedSha: string;
  git: GithubPushDeps;
  headSha: string;
  pinnedTree: string;
  repoRoot: string;
}): string | undefined {
  const committedTree = git.readGit({ args: [NO_REPLACE, "rev-parse", `${amendedSha}^{tree}`], cwd: repoRoot });
  const inCommit = driftFromPin({ git, pinnedTree, repoRoot, tree: committedTree });
  if (inCommit.length > 0) {
    return stackPushCommitDriftReason({ paths: inCommit });
  }
  // UTF-8 output, whatever `i18n.logOutputEncoding` says: `readGit` decodes as UTF-8, so any other output
  // encoding could decode two different messages to one string.
  const lineage = ({ sha }: { sha: string }): string =>
    git.readGit({
      args: [NO_REPLACE, "show", "-s", "--no-show-signature", "--encoding=UTF-8", AMEND_LINEAGE_FORMAT, sha],
      cwd: repoRoot,
    });
  if (lineage({ sha: amendedSha }) !== lineage({ sha: headSha })) {
    return stackPushLineageReason({ amendedSha, headSha });
  }
  return undefined;
}

/** The paths `tree` holds differently from the pin, asking git to name them only when the ids differ. */
function driftFromPin({
  git,
  pinnedTree,
  repoRoot,
  tree,
}: {
  git: GithubPushDeps;
  pinnedTree: string;
  repoRoot: string;
  tree: string;
}): readonly string[] {
  const nulPaths =
    tree === pinnedTree
      ? ""
      : git.readGit({ args: ["diff", "--name-only", "-z", "--no-renames", pinnedTree, tree], cwd: repoRoot });
  return stackPushTreeDrift({ nulPaths, pinnedTree, stagedTree: tree });
}

/**
 * Push the just-amended commit with a fresh exact lease, and confirm the remote SHA matches.
 *
 * The push itself is `admit/githubPush.ts`'s `pushAndVerify`, not a second copy: it runs the repository's pre-push
 * gate BEFORE it opens the transport, then verifies the remote ref, and plain `github push` uses the same
 * primitive. This function owns only the stack-specific plan (an exact lease, no base-freshness
 * acknowledgement — `stack push` gates freshness itself, earlier and against the pull request's own base).
 *
 * @returns whether the push landed, or why it failed or could not be confirmed
 */
function pushAmended({
  facts,
  remote,
  git,
  home,
}: {
  facts: GithubPushFacts;
  remote: string;
  git: GithubPushDeps;
  home: string;
}): { readonly kind: "pushed" } | { readonly kind: "failed" | "unconfirmed"; readonly reason: string } {
  const planned = githubPushPlan({
    args: {
      baseFreshnessAcknowledgement: NO_BASE_FRESHNESS_ACKNOWLEDGEMENT,
      cwd: facts.repoRoot,
      dryRun: false,
      forceWithLease: true,
      home: undefined,
      orphanAbove: NO_ORPHANS_ACCEPTED,
      remote,
      selfReviewSource: undefined,
    },
    facts,
  });
  if (!planned.isOk()) {
    return { kind: "failed", reason: planned.error.message };
  }
  return pushAndVerify({ deps: git, home, plan: planned.value });
}

/**
 * Amend the pinned tree into the current commit, when it differs from HEAD's, and push it with a fresh exact
 * lease.
 *
 * @param locus the branch locus carried on the outcome, so a lost push names what it was attempting
 * @param home the state home whose push-root register the push is judged against
 * @returns the SHA that is now on the remote, or the `unconfirmed` outcome to report. The sha is what the
 *   checks-read register records the raise against, so it has to come from the push rather than from the
 *   facts measured before any amend rewrote the commit.
 */
export function amendAndPush({
  plan,
  remote,
  git,
  home,
  locus,
}: {
  plan: GithubStackPushPlan;
  remote: string;
  git: GithubPushDeps;
  home: string;
  locus: string;
}): Result<string, PrOutcome> {
  const amended = amend({ git, locus, plan });
  if (!amended.isOk()) {
    return err(amended.error);
  }
  const localSha = amended.value;
  const remoteText = git.readGit({
    args: ["ls-remote", remote, `refs/heads/${plan.facts.branch}`],
    cwd: plan.facts.repoRoot,
  });
  const remoteBranchSha = remoteText.length === 0 ? undefined : remoteText.split(/\s+/)[0];
  const pushed = pushAmended({ facts: { ...plan.facts, localSha, remoteBranchSha }, git, home, remote });
  return pushed.kind === "pushed"
    ? ok(localSha)
    : err({ detail: `push ${pushed.kind}: ${pushed.reason}`, kind: "unconfirmed", locus });
}
