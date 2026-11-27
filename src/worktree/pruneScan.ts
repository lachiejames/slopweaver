/**
 * Gathering the facts `worktree prune` classifies — the effectful half, deliberately thin.
 *
 * ## Two measurements that decide everything, and why each is spelled the way it is
 *
 * **Is the branch's work already in the trunk?** Every branch commit's VERBATIM patch id must be among the
 * trunk's (`./prunePatchIds.ts`), which answers it without writing a single object into the repository: a commit
 * squash-merged into the trunk under a new SHA still matches. That matters here because this repository
 * squash-merges every pull request, which makes plain ancestry (`git merge-base --is-ancestor`) report every
 * landed branch as unmerged. The alternative — synthesising a commit with `commit-tree` and cherry-picking
 * against that — is the widely-copied recipe and was rejected: it writes loose objects into the owner's
 * repository on what is supposed to be a read-only dry run. `git cherry` asks the same question with
 * whitespace-blind ids, and that file's header carries what that let go.
 *
 * Its one limit, stated rather than discovered: a branch of SEVERAL commits squash-merged into ONE has no
 * single matching patch, so it reads as unabsorbed and classifies as `pushed` rather than `merged`. That is
 * the conservative direction — it keeps a branch that could have gone — and it is why the `pushed` class
 * exists at all rather than being folded into `hold`.
 *
 * **Is any work here backed up nowhere?** `git rev-list <branch> --not --remotes=origin` lists commits reachable
 * from the branch and from no `origin` remote-tracking ref. ONE remote, never all of them: another remote can hold a
 * different history, and a tree excused by it would be salvaged to `origin` — see `./pruneRemote.ts`'s
 * {@link PRUNE_REMOTE}. On a branch whose pull request merged and whose
 * remote branch GitHub then deleted, that list is the branch's own commits — which would hold every landed
 * worktree forever. So an absorbed branch reports ZERO unbacked commits by definition: its work is in the
 * trunk, which is on a remote. The count is only asked of branches the patch-id check did not clear.
 *
 * Disk is measured LAST and only for candidates, in `./pruneDisk.ts`.
 */
import { existsSync, statSync } from "node:fs";
import { basename, join } from "node:path";

import { parseOperationalWorktrees, type WorktreeInfo } from "../cmux/worktreeList.js";
import { readJsonlLines } from "../corpus/corpusStore.js";
import { type RunEvent, runStateOf } from "../handover/ledger.js";
import { decodeLedgerLine } from "../handover/ledgerLineDecode.js";
import { isSafeSlug } from "../handover/runStore.js";
import { isFreshSnapshotTree, osTempRoots } from "./freshSnapshotPath.js";
import type { WorktreeFacts } from "./pruneClassify.js";
import { readIgnoredWork, readTreeStashes } from "./pruneContext.js";
import { countLines, type GitRunner, readWorkingTree, realGit } from "./pruneGit.js";
import { scanLapFacts } from "./pruneLapPin.js";
import { verbatimAbsorbed } from "./prunePatchIds.js";
import { PRUNE_REMOTE } from "./pruneRemote.js";

/** The `rev-list` exclusion naming only {@link PRUNE_REMOTE}'s remote-tracking refs, never every remote's. */
const NOT_ON_PRUNE_REMOTE = ["--not", `--remotes=${PRUNE_REMOTE}`] as const;

/**
 * Epoch ms of a git revision's commit timestamp — a branch, a bare sha or `HEAD` — or `null` when it could not be read.
 * The trailing `--` makes git read `rev` as a revision even when a top-level path shares its name: a branch called
 * `src` in a tree with a `src/` directory exits 128 "ambiguous argument" without it.
 */
function commitMs({ git, repoRoot, rev }: { git: GitRunner; repoRoot: string; rev: string }): number | null {
  const raw = git({ args: ["log", "-1", "--format=%ct", rev, "--"], cwd: repoRoot });
  const seconds = raw === null ? Number.NaN : Number(raw);
  return Number.isFinite(seconds) ? seconds * 1000 : null;
}

/**
 * Epoch ms of a directory's own mtime, or `null` when it cannot be stat'd.
 *
 * Exported because a bounded scan orders its queue by this before spending a single git call
 * (`./pruneSweep`'s `coldestFirst`), and one `statSync` is the whole cost of that ordering.
 *
 * @param path the directory to stat
 * @returns the mtime in epoch milliseconds, or `null` when it could not be read
 */
export function dirMs({ path }: { path: string }): number | null {
  try {
    return statSync(path).mtimeMs;
  } catch {
    return null;
  }
}

/**
 * How recently a tree was touched, read now: the newer of the commit its HEAD has out and its directory's mtime,
 * the same stamp the scan dates a tree by.
 *
 * Exported so the apply's live re-reads judge a tree against a fresh stamp rather than the scan's. HEAD is read IN
 * the tree, so a branch switched or detached since the scan is dated by what is out now, and a detached tree is
 * dated by its commit too: a commit leaves the worktree root's mtime alone. **Either read failing answers null**,
 * never the other stamp alone — a fresh commit the failed read missed is exactly what would make the tree warm.
 *
 * @param path the worktree directory, the cwd git runs in and the directory whose mtime is read
 * @returns the newest stamp in epoch milliseconds, or `null` when either could not be read
 */
export function activityNowMs({ path }: { path: string }): number | null {
  const commit = commitMs({ git: realGit, repoRoot: path, rev: "HEAD" });
  const dir = dirMs({ path });
  if (commit === null || dir === null) {
    return null;
  }
  return Math.max(commit, dir);
}

/** What a detached HEAD is, and whether anything on a remote still carries it. */
export interface DetachedHead {
  readonly headSha: string | null;
  readonly headOnRemoteRef: string | null;
}

/** A detached HEAD with neither fact established — what every failure path here returns. */
const NO_DETACHED_HEAD: DetachedHead = { headOnRemoteRef: null, headSha: null };

/** Every measurement a tree that was never opened has no answer for. */
const UNMEASURED = {
  dirtyCount: null,
  hiddenFromStatus: null,
  ignoredWork: null,
  lastActivityMs: null,
  mergedIntoTrunk: null,
  stashes: null,
  unbackedCommits: null,
} as const;

/**
 * The detached HEAD's commit, and the first {@link PRUNE_REMOTE} remote-tracking ref that contains it — a branch on
 * any other remote is no carrier.
 *
 * `git branch -r --contains <sha>` rather than `git rev-list <sha> --not --remotes`, deliberately. The
 * count answers "is this reachable from anything remote", which is almost the right question; the ref
 * answers "and from WHICH one", which is what a reader needs to judge the case the two disagree about —
 * a commit carried only by a remote branch GitHub deletes on merge. The plan line prints it, so the
 * judgement is the reader's rather than this function's.
 *
 * @param git how to run git, defaulting to the real one
 * @param path the worktree whose HEAD to resolve
 * @param repoRoot the repository whose remote-tracking refs to search
 * @returns the sha and its containing remote ref, either of which is `null` when git could not answer
 */
export function detachedHead({
  git = realGit,
  path,
  repoRoot,
}: {
  git?: GitRunner;
  path: string;
  repoRoot: string;
}): DetachedHead {
  const headSha = git({ args: ["rev-parse", "HEAD"], cwd: path });
  if (headSha === null || headSha.length === 0) {
    return NO_DETACHED_HEAD;
  }
  const contains = git({
    args: ["branch", "--remotes", "--contains", headSha, "--list", `${PRUNE_REMOTE}/*`, "--format=%(refname:short)"],
    cwd: repoRoot,
  });
  if (contains === null) {
    return { headOnRemoteRef: null, headSha };
  }
  // A bare `origin` in this list is `refs/remotes/origin/HEAD` rendered short, not a branch. MEASURED
  // on acme-admin: `git branch --remotes --contains <sha> --format='%(refname:short)'` answered
  // two real branches AND `origin`. Naming that as the carrier would print "carried by origin", which tells
  // a reader nothing about which branch to fetch, so only a `<remote>/<branch>` spelling is taken.
  const first = contains
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.includes("/"));
  if (first === undefined) {
    return { headOnRemoteRef: null, headSha };
  }
  return { headOnRemoteRef: first, headSha };
}

/**
 * Whether this worktree's own handover run is closed on the board.
 *
 * Four conditions, and every one of them is load-bearing. The directory's basename must be a usable slug;
 * a journal must exist for it; its derived phase must be `closed`; and the journal's own recorded branch
 * must equal the branch checked out here. The last is the guard against aliasing — a basename that happens
 * to match an unrelated closed run's slug would otherwise disarm the coldness hold on a tree somebody is
 * working in. It also closes a sharper hole for free: `NO_RUN`'s phase is `closed`, because a run that
 * never started is not open, so a MISSING journal reads as closed on the phase alone. A missing journal
 * carries no branch, so the comparison refuses it.
 *
 * @param path the worktree directory, whose basename is the slug a spawn names it by
 * @param branch the branch checked out there, or `null` for a detached HEAD, which never matches
 * @param runsDir where run journals live
 * @returns true only when all four conditions hold
 */
function runClosedFor({ path, branch, runsDir }: { path: string; branch: string | null; runsDir: string }): boolean {
  if (branch === null) {
    return false;
  }
  const slug = basename(path);
  if (!isSafeSlug({ slug })) {
    return false;
  }
  // Streamed rather than read whole, because a run journal is an append-only stream with no ceiling and
  // `whole-file-json` refuses a `readFileSync` of a `.jsonl` for exactly that reason. Each line goes through
  // `decodeLedgerLine`, which IS the decode `parseLedger` performs, so this reading cannot drift from the
  // board's. An unreadable line is skipped here rather than counted: the only question asked below is
  // whether a `closed` phase and a matching branch are present, and a line nothing could decode carries
  // neither — the strictness that matters lives in the branch comparison.
  const events: RunEvent[] = [];
  try {
    readJsonlLines({
      onLine: ({ line }) => {
        const event = decodeLedgerLine({ line });
        if (event !== undefined) {
          events.push(event);
        }
      },
      path: join(runsDir, `${slug}.jsonl`),
    });
  } catch {
    return false;
  }
  const state = runStateOf({ events });
  return state.phase === "closed" && state.branch === branch;
}

/**
 * Whether the branch's work is already in the trunk, by patch id.
 *
 * Also the detector behind the creation door's `already-landed` refusal, which is why this is no longer
 * `@internal`. The same question — is this work already on the base under a squash-merge's new SHA — decides
 * whether a worktree can be pruned and whether a pull request should be opened at all, and a second
 * implementation of it would be one that drifts. Both callers must honour the `null` return as UNANSWERABLE
 * and fail OPEN.
 *
 * @param git how to run git, defaulting to the real one
 * @param repoRoot the repository to ask
 * @param trunk the trunk ref to compare against, e.g. `origin/main`
 * @param branch the branch to judge
 * @returns `true` when every unique commit is absorbed, `false` when one is not, `null` when git failed
 */
export function branchAbsorbed({
  branch,
  git = realGit,
  repoRoot,
  trunk,
}: {
  branch: string;
  git?: GitRunner;
  repoRoot: string;
  trunk: string;
}): boolean | null {
  // The fast path, taken by roughly a third of a real backlog: a branch with NOTHING the trunk lacks is
  // absorbed, and `rev-list --count` answers that from the commit graph alone. The patch-id read has to list
  // every trunk commit since the merge base — a fortnight-old branch pays that over hundreds of commits, 226
  // times in one sweep — so it is worth not asking when a counter already knows.
  const ahead = git({ args: ["rev-list", "--count", `${trunk}..${branch}`], cwd: repoRoot });
  if (ahead === "0") {
    return true;
  }
  // Patch ids SKIP merge commits, so a branch whose only unique work is a local merge commit (a conflict resolution
  // that adds a file) read as absorbed and its tree was removed. A merge commit `origin` does not carry is work only
  // this machine has; one it carries — main merged into a pushed branch — is not.
  // Repro: `git rev-list --count --merges <branch> --not --remotes=origin` on such a branch prints 1 while `git cherry` lists none.
  const localMerges = git({
    args: ["rev-list", "--count", "--merges", branch, ...NOT_ON_PRUNE_REMOTE],
    cwd: repoRoot,
  });
  if (localMerges === null) {
    return null;
  }
  if (localMerges !== "0") {
    return false;
  }
  return verbatimAbsorbed({ branch, git, repoRoot, trunk });
}

/**
 * Gather every fact about one worktree except its disk footprint.
 *
 * @param worktree the entry git listed
 * @param repoRoot the repository it belongs to
 * @param trunk the trunk ref to judge merge state against
 * @param mainCheckout the repository's own checkout path, which is never a candidate
 * @param git how to run git, defaulting to the real one
 * @param liveRefs the live sessions, workspaces and processes holding this tree by path
 * @param openPullRequests the owner's open pull requests whose head is this tree's branch, which hold it only while warm
 * @param runsDir where handover run journals live, so a closed board row can be read off this tree's slug
 * @returns the facts, with `diskKib` left null for `./pruneDisk.ts` to fill in
 */
export function scanWorktree({
  git = realGit,
  liveRefs,
  mainCheckout,
  openPullRequests,
  repoRoot,
  runsDir,
  trunk,
  worktree,
}: {
  git?: GitRunner;
  liveRefs: readonly string[];
  mainCheckout: string;
  openPullRequests: readonly string[];
  repoRoot: string;
  runsDir: string;
  trunk: string;
  worktree: WorktreeInfo;
}): WorktreeFacts {
  const { path, branch } = worktree;
  const missing = !existsSync(path);
  const base = {
    branch,
    branchOnOwnRemote: false,
    deletionsOnly: false,
    diskKib: null,
    freshSnapshot: isFreshSnapshotTree({ git, path, tempRoots: osTempRoots() }),
    isMainCheckout: path === mainCheckout,
    liveRefs,
    locked: worktree.locked === true,
    missing,
    openPullRequests,
    path,
    runClosed: false,
    ...NO_DETACHED_HEAD,
  };
  if (missing || path === mainCheckout) {
    return { ...base, ...UNMEASURED };
  }
  const work = {
    ...readWorkingTree({ git, path }),
    ignoredWork: readIgnoredWork({ git, path }),
    stashes: readTreeStashes({ branch, git, path }),
  };
  const { deletionsOnly, dirtyCount } = work;
  // A dirty tree is still asked its merge state. Its dirt hold is WAIVABLE: past `--nuke-after` the
  // classifier reads straight past it, and a merge state never asked then held the tree as "could not be
  // determined" — 51 of 94 holds, every one of them dirty and a week cold, none salvaged.
  // Reproduce on any dirty, week-old tree: `git -C <tree> status --porcelain | wc -l`, then its plan line.
  if (dirtyCount === null) {
    return { ...base, ...UNMEASURED, ...work, lastActivityMs: dirMs({ path }) };
  }
  const runClosed = runClosedFor({ branch, path, runsDir });
  const lap = scanLapFacts({ git, path });
  if (branch === null) {
    return { ...base, ...UNMEASURED, ...detachedFacts({ git, path, repoRoot }), ...work, ...lap, runClosed };
  }
  return { ...base, ...branchFacts({ branch, deletionsOnly, git, path, repoRoot, trunk }), ...work, ...lap, runClosed };
}

/**
 * The facts a DETACHED tree has, which are not the ones a branch-backed tree has.
 *
 * A detached tree has no branch, so none of {@link branchFacts}'s questions has an answer — but it does
 * have a commit, and whether a remote carries that commit is the whole `detached` class. Its unbacked
 * count is 0 exactly when a remote does carry it, which is the honest reading: nothing here is unbacked.
 *
 * @param git how to run git
 * @param path the worktree directory, whose HEAD is resolved and whose mtime dates it
 * @param repoRoot the repository whose remote-tracking refs are searched
 * @returns the HEAD facts, how cold the tree is, and its unbacked count
 */
function detachedFacts({
  git,
  path,
  repoRoot,
}: {
  git: GitRunner;
  path: string;
  repoRoot: string;
}): Pick<WorktreeFacts, "headOnRemoteRef" | "headSha" | "lastActivityMs" | "unbackedCommits"> {
  const head = detachedHead({ git, path, repoRoot });
  return {
    ...head,
    lastActivityMs: detachedActivityMs({ git, head, path, repoRoot }),
    unbackedCommits: head.headOnRemoteRef === null ? null : 0,
  };
}

/**
 * How cold a detached tree is: the newest of its own commit date and its directory's mtime.
 *
 * The commit date is what a detached tree has instead of a branch's last commit, and taking the newer of
 * the two is the same rule {@link branchFacts} applies — a tree is as warm as the most recent thing that
 * happened to it.
 *
 * @param git how to run git
 * @param head the resolved HEAD, whose sha dates the commit
 * @param path the worktree directory, for its mtime
 * @param repoRoot the repository that can date the commit
 * @returns the newest activity stamp, or `null` when either could not be read
 */
function detachedActivityMs({
  git,
  head,
  path,
  repoRoot,
}: {
  git: GitRunner;
  head: DetachedHead;
  path: string;
  repoRoot: string;
}): number | null {
  if (head.headSha === null) {
    return null;
  }
  // Either read failing answers null, which the classifier holds unwaivably: the directory's mtime alone would
  // date a tree committed to an hour ago by its three-day-old root, because a commit leaves the root's mtime alone.
  const commit = commitMs({ git, repoRoot, rev: head.headSha });
  const dir = dirMs({ path });
  if (commit === null || dir === null) {
    return null;
  }
  return Math.max(commit, dir);
}

/**
 * Whether a branch sits on its own remote branch: `origin/<branch>` exists and the branch has nothing it
 * lacks. See {@link WorktreeFacts.branchOnOwnRemote} for why it must be the branch's OWN remote branch.
 *
 * @param git how to run git
 * @param repoRoot the repository to ask
 * @returns true or false, or `null` when the count could not be read for a remote branch that exists
 */
export function onOwnRemoteBranch({
  branch,
  git,
  repoRoot,
}: {
  branch: string;
  git: GitRunner;
  repoRoot: string;
}): boolean | null {
  const remoteRef = `refs/remotes/${PRUNE_REMOTE}/${branch}`;
  // `--quiet` exits non-zero with no output for an absent ref, which the runner returns as `null`: absent
  // and unreadable are the same answer here, and both keep the coldness rule armed.
  if (git({ args: ["rev-parse", "--verify", "--quiet", remoteRef], cwd: repoRoot }) === null) {
    return false;
  }
  const ahead = git({ args: ["rev-list", "--count", `${remoteRef}..refs/heads/${branch}`], cwd: repoRoot });
  if (ahead === null) {
    return null;
  }
  return ahead === "0";
}

/**
 * The facts that need a branch: its merge state, whether anything on it is unbacked, and how cold it is.
 *
 * @param branch the branch checked out in the worktree
 * @param git how to run git
 * @param repoRoot the repository to ask
 * @param trunk the trunk ref to judge merge state against
 * @param path the worktree's directory, for its mtime
 * @param deletionsOnly whether the tree is a gutted one, which changes what counts as activity
 * @returns the merge state, the unbacked count and the newest activity stamp
 */
function branchFacts({
  branch,
  deletionsOnly,
  git,
  path,
  repoRoot,
  trunk,
}: {
  branch: string;
  deletionsOnly: boolean;
  git: GitRunner;
  path: string;
  repoRoot: string;
  trunk: string;
}): Pick<WorktreeFacts, "branchOnOwnRemote" | "lastActivityMs" | "mergedIntoTrunk" | "unbackedCommits"> {
  // Fully qualified, so a tag of the branch's own name cannot answer for it: a bare name resolves tags first.
  const mergedIntoTrunk = branchAbsorbed({ branch: `refs/heads/${branch}`, git, repoRoot, trunk });
  // An absorbed branch's commits ARE backed up — they are in the trunk, which is on `origin`. Asking
  // `--not --remotes=origin` about one reports its pre-squash SHAs, which `origin` does not carry, and would hold
  // every landed worktree forever. See this module's header.
  const unbackedCommits =
    mergedIntoTrunk === true
      ? 0
      : countLines({ text: git({ args: ["rev-list", branch, ...NOT_ON_PRUNE_REMOTE], cwd: repoRoot }) });
  // A gutted tree's directory mtime is THIS VERB's own failed write, not somebody working there, so it is
  // excluded — otherwise every interruption defers its own cleanup by a further `--older-than`, and a tree
  // interrupted twice is never finished at all. The last commit remains the honest signal either way, so a failed
  // commit read answers null — held unwaivably — rather than leaving the directory's mtime to speak alone.
  const stamps = deletionsOnly
    ? [commitMs({ git, repoRoot, rev: branch })]
    : [commitMs({ git, repoRoot, rev: branch }), dirMs({ path })];
  const unreadable = stamps.some((ms) => ms === null);
  return {
    branchOnOwnRemote: onOwnRemoteBranch({ branch, git, repoRoot }),
    lastActivityMs: unreadable ? null : Math.max(...stamps.filter((ms): ms is number => ms !== null)),
    mergedIntoTrunk,
    unbackedCommits,
  };
}

/**
 * Every operational worktree a repository has registered — Codex snapshot-pool slots omitted, because prune
 * would otherwise salvage a slot a pass may be reading (`./snapshotPoolPath.ts`).
 *
 * @param git how to run git, defaulting to the real one
 * @param repoRoot the repository to list
 * @returns the entries, or `null` when git could not be asked
 */
export function listRepoWorktrees({
  git = realGit,
  repoRoot,
}: {
  git?: GitRunner;
  repoRoot: string;
}): readonly WorktreeInfo[] | null {
  const text = git({ args: ["worktree", "list", "--porcelain"], cwd: repoRoot });
  if (text === null) {
    return null;
  }
  // Untrimmed bar git's own newline: a directory name may end in a space.
  const printed = git({
    args: ["rev-parse", "--path-format=absolute", "--git-common-dir"],
    cwd: repoRoot,
    untrimmed: true,
  });
  if (printed === null) {
    return parseOperationalWorktrees({ repository: null, text });
  }
  return parseOperationalWorktrees({ repository: { commonDir: printed.replace(/\n$/u, ""), cwd: repoRoot }, text });
}

/** The symbolic ref naming the remote's default branch, which {@link trunkRefOf} reads. */
export const ORIGIN_HEAD = `refs/remotes/${PRUNE_REMOTE}/HEAD`;

/**
 * The trunk ref to judge a repository's branches against — its remote's own default branch.
 *
 * @param git how to run git, defaulting to the real one
 * @param repoRoot the repository to ask
 * @returns the fully-qualified remote-tracking ref, or `null` when the remote's head is not resolvable
 */
export function trunkRefOf({ git = realGit, repoRoot }: { git?: GitRunner; repoRoot: string }): string | null {
  // Fully qualified, never `--short`: `origin/main` is resolved through the DWIM rules, so a local branch or tag
  // of that name would answer instead, and the branch deletion's ancestry check reads this ref.
  const head = git({ args: ["symbolic-ref", "--quiet", ORIGIN_HEAD], cwd: repoRoot });
  return head === null || head.length === 0 ? null : head;
}
