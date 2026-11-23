/**
 * The stack facts every stack verb plans from — one entry's worktree, its base's live tip, whether that tip
 * is still a git ancestor of its head, GitHub's own commit count and head SHA, and whether local stack state
 * registered it at all.
 *
 * Extracted from `./stackSyncRun.ts` when the carry gate (`./stackCarryRun.ts`) needed exactly the same
 * measurements over a SLICE of a stack rather than the whole of one. Two gatherers reading the same fields
 * from two different code paths is how `stack sync` and a push-time carry would drift into disagreeing about
 * what "this entry can be safely rebased" means — the answer has to come from one place.
 *
 * What this module DOES decide is how a raw read becomes a fact: a missing pull-request read leaves its commit
 * count and head SHA undefined, a merged entry is never read at all, a default-branch base takes the remote's
 * tip rather than the local ref, registration is local stack state, and a worktree refusal becomes a residue
 * line. What it never decides is the action: whether an entry is rebased, carried, skipped or refused is
 * `./stackSyncCore.ts` and `./stackCarryCore.ts`'s call, made from these facts without touching Git or the
 * network.
 */
import type { GithubStack } from "../../../corpus/github/stack.js";
import type { GithubWriteApi } from "../../../corpus/github/write.js";
import type { GithubVerbResult } from "./errors.js";
import { isAncestor as peeledIsAncestor } from "./gitAncestry.js";
import { githubRepoFromRemote, parseRemoteSnapshot } from "./pushCore.js";
import type { GithubPushDeps } from "./pushPrimitives.js";
import type { StackIsAncestor } from "./stackCarryDeps.js";
import type { GithubStackSyncEntryFact } from "./stackSyncCore.js";
import { type GithubStackWorktree, parseGithubWorktreeList, worktreesForStackBranches } from "./stackWorktrees.js";

export type { StackIsAncestor };

/**
 * Whether `ancestor` is a git ancestor of `descendant` — the sole staleness signal the stack verbs trust.
 *
 * Delegates to the shared, peeled primitive in `gitAncestry.ts` (both revisions suffixed `^{commit}`, so a
 * same-named local branch cannot shadow either one) and never turns an execution failure into `false` — a
 * `false` here plans a rebase, so collapsing "the check itself failed" into "not an ancestor" would rebase
 * onto a base that was never actually verified.
 *
 * @returns whether the ancestry holds
 */
export function stackIsAncestor({
  ancestor,
  descendant,
  cwd,
}: {
  ancestor: string;
  descendant: string;
  cwd: string;
}): boolean {
  const result = peeledIsAncestor({ ancestor, cwd, descendant });
  if (result.isErr()) {
    throw new Error(result.error.message);
  }
  return result.value;
}

/**
 * Read every local Git fact a stack verb needs before any network call.
 *
 * @param cwd the directory to resolve the repository root from
 * @returns the repository root and its `owner/name` slug
 */
export function stackLocalFacts({ cwd, git, remote }: { cwd: string; git: GithubPushDeps; remote: string }): {
  readonly repoRoot: string;
  readonly repo: string;
} {
  const repoRoot = git.readGit({ args: ["rev-parse", "--show-toplevel"], cwd });
  const remoteUrl = git.readGit({ args: ["remote", "get-url", remote], cwd: repoRoot });
  const repo = githubRepoFromRemote({ url: remoteUrl });
  if (repo === undefined) {
    throw new Error(`remote ${remote} is not an owner/name Git repository URL`);
  }
  return { repo, repoRoot };
}

/**
 * The remote's default branch, read fresh.
 *
 * @returns the branch name the remote's `HEAD` symref points at
 */
export function stackRemoteDefaultBranch({
  repoRoot,
  git,
  remote,
}: {
  repoRoot: string;
  git: GithubPushDeps;
  remote: string;
}): string {
  const text = git.readGit({ args: ["ls-remote", "--symref", remote, "HEAD"], cwd: repoRoot });
  const snapshot = parseRemoteSnapshot({ branch: "HEAD", text });
  if (!snapshot.isOk()) {
    throw new Error(snapshot.error.message);
  }
  return snapshot.value.defaultBranch;
}

/**
 * The remote's current tip of one branch, read with `ls-remote` so no fetch is needed.
 *
 * @param branch the branch name, without `refs/heads/`
 * @param remote the configured Git remote to ask
 * @returns the tip's SHA, or `undefined` when the remote carries no such branch
 */
export function stackRemoteTip({
  branch,
  repoRoot,
  git,
  remote,
}: {
  branch: string;
  repoRoot: string;
  git: GithubPushDeps;
  remote: string;
}): string | undefined {
  const text = git.readGit({ args: ["ls-remote", remote, `refs/heads/${branch}`], cwd: repoRoot });
  return text.length === 0 ? undefined : text.split(/\s+/)[0];
}

/**
 * The base branch's current tip — the remote's for the default branch (which may be ahead of any stale
 * local ref), the local ref otherwise. `undefined` rather than a thrown error when the ref cannot be read at
 * all, since a base branch a local checkout has never fetched (or one whose remote counterpart was since
 * deleted) is a fact to plan AROUND, not a reason to crash the whole discovery walk.
 */
function baseTipOf({
  baseRef,
  defaultBranch,
  git,
  repoRoot,
  remote,
}: {
  baseRef: string;
  defaultBranch: string;
  git: GithubPushDeps;
  repoRoot: string;
  remote: string;
}): string | undefined {
  if (baseRef === defaultBranch) {
    return stackRemoteTip({ branch: baseRef, git, remote, repoRoot });
  }
  try {
    return git.readGit({ args: ["rev-parse", `refs/heads/${baseRef}`], cwd: repoRoot });
  } catch {
    return undefined;
  }
}

/**
 * What one worktree's `HEAD` currently resolves to, or `undefined` when there is no worktree or the read
 * failed. Never throws: an unreadable HEAD is a fact the planner refuses on, not a reason to crash the walk.
 */
function worktreeHeadOf({
  git,
  worktreePath,
}: {
  git: GithubPushDeps;
  worktreePath: string | undefined;
}): string | undefined {
  if (worktreePath === undefined) {
    return undefined;
  }
  try {
    return git.readGit({ args: ["rev-parse", "HEAD"], cwd: worktreePath });
  } catch {
    return undefined;
  }
}

/** The fields shared by a merged and a non-merged fact — split out purely to avoid repeating them twice. */
function sharedEntryFacts({
  entry,
  stackNumber,
  registeredNumbers,
}: {
  entry: GithubStack["entries"][number];
  stackNumber: number;
  registeredNumbers: ReadonlySet<number>;
}): { baseBranch: string; branch: string; pullRequestNumber: number; registered: boolean; stackNumber: number } {
  return {
    baseBranch: entry.baseRef,
    branch: entry.headRef,
    pullRequestNumber: entry.number,
    registered: registeredNumbers.has(entry.number),
    stackNumber,
  };
}

/** Everything one entry's fact needs that is not the entry itself — passed whole so no signature grows a tail. */
export interface StackFactContext {
  /** Only the pull-request read this module makes, so a caller's wider API is never part of the contract. */
  readonly api: Pick<GithubWriteApi, "getPr">;
  readonly owner: string;
  readonly repo: string;
  readonly stackNumber: number;
  readonly registeredNumbers: ReadonlySet<number>;
  readonly defaultBranch: string;
  readonly repoRoot: string;
  readonly git: GithubPushDeps;
  readonly isAncestor: StackIsAncestor;
  readonly remote: string;
}

/**
 * A non-merged entry's fact, plus its residue line if any — the `getPr` read for the commit-count/head-SHA
 * facts only ever happens here; a failed read just leaves both undefined, which the planners' own
 * "commits !== 1" refusal already reports plainly, so this does not ALSO produce a residue line for it.
 */
async function nonMergedEntryFact({
  context,
  entry,
  position,
  worktree,
}: {
  context: StackFactContext;
  entry: GithubStack["entries"][number];
  position: number;
  worktree: GithubVerbResult<GithubStackWorktree> | undefined;
}): Promise<{ readonly fact: GithubStackSyncEntryFact; readonly residue: string | undefined }> {
  const { api, owner, repo, stackNumber, registeredNumbers, defaultBranch, repoRoot, git, remote } = context;
  const pr = await api.getPr({ number: entry.number, owner, repo });
  const commits = pr.isOk() ? pr.value.commits : undefined;
  const headSha = pr.isOk() ? pr.value.head.sha : undefined;
  const residue =
    worktree?.isErr() === true
      ? `stack #${String(stackNumber)} branch ${entry.headRef}: ${worktree.error.message}`
      : undefined;
  const worktreePath = worktree?.isOk() === true ? worktree.value.path : undefined;
  const baseTip = baseTipOf({ baseRef: entry.baseRef, defaultBranch, git, remote, repoRoot });
  const baseIsAncestorOfHead =
    worktreePath !== undefined && baseTip !== undefined
      ? context.isAncestor({ ancestor: baseTip, cwd: repoRoot, descendant: `refs/heads/${entry.headRef}` })
      : false;
  const shared = sharedEntryFacts({ entry, registeredNumbers, stackNumber });
  return {
    fact: {
      ...shared,
      baseIsAncestorOfHead,
      commits,
      headSha,
      merged: false,
      position,
      worktreeHeadSha: worktreeHeadOf({ git, worktreePath }),
      worktreePath,
    },
    residue,
  };
}

/**
 * One entry's fact, plus the residue line to report for it (if any). A merged entry is always skipped by
 * the pure planners regardless of its worktree, and its base branch may since have been deleted — so neither
 * fact is worth computing there, and neither is the extra `getPr` read for the commit-count/head-SHA facts:
 * a residue line would be noise at best, a crash from a dangling ref at worst.
 *
 * @param position this entry's 1-based index in its OWN stack, bottom to top
 * @returns the fact, and the residue line to print for it
 */
async function stackEntryFact({
  context,
  entry,
  position,
  worktree,
}: {
  context: StackFactContext;
  entry: GithubStack["entries"][number];
  position: number;
  worktree: GithubVerbResult<GithubStackWorktree> | undefined;
}): Promise<{ readonly fact: GithubStackSyncEntryFact; readonly residue: string | undefined }> {
  if (entry.mergedAtIso === undefined) {
    return nonMergedEntryFact({ context, entry, position, worktree });
  }
  const shared = sharedEntryFacts({
    entry,
    registeredNumbers: context.registeredNumbers,
    stackNumber: context.stackNumber,
  });
  return {
    fact: {
      ...shared,
      baseIsAncestorOfHead: false,
      commits: undefined,
      headSha: undefined,
      merged: true,
      position,
      worktreeHeadSha: undefined,
      worktreePath: undefined,
    },
    residue: undefined,
  };
}

/**
 * Facts for an ordered RUN of stack entries — the whole stack for `stack sync`, only the entries above one
 * branch for the carry gate.
 *
 * @param entries the entries to measure, already ordered bottom to top
 * @param firstPosition the 1-based stack position of `entries[0]`, so a sliced run still reports the
 *   positions the whole stack has rather than re-numbering from one
 * @param worktrees every worktree the repository currently has
 * @returns one fact per entry, in order, plus every residue line they produced
 */
export async function stackFactsForEntries({
  context,
  entries,
  firstPosition,
  worktrees,
}: {
  context: StackFactContext;
  entries: readonly GithubStack["entries"][number][];
  firstPosition: number;
  worktrees: readonly GithubStackWorktree[];
}): Promise<{ readonly facts: readonly GithubStackSyncEntryFact[]; readonly residue: readonly string[] }> {
  const resolved = worktreesForStackBranches({ branches: entries.map((entry) => entry.headRef), worktrees });
  const results = await Promise.all(
    entries.map((entry, index) =>
      stackEntryFact({ context, entry, position: firstPosition + index, worktree: resolved.get(entry.headRef) }),
    ),
  );
  return {
    facts: results.map((result) => result.fact),
    residue: results.map((result) => result.residue).filter((residue): residue is string => residue !== undefined),
  };
}

/**
 * Read every worktree the repository currently has, in the shape {@link stackFactsForEntries} takes.
 *
 * @returns the parsed worktree list
 */
export function stackWorktreeList({
  git,
  repoRoot,
}: {
  git: GithubPushDeps;
  repoRoot: string;
}): readonly GithubStackWorktree[] {
  return parseGithubWorktreeList({
    text: git.readGit({ args: ["worktree", "list", "--porcelain", "-z"], cwd: repoRoot }),
  });
}
