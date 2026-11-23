/**
 * Finding or creating the ONE worktree a handover branch already lives in.
 *
 * The live discovery this module exists to encode: `slopweaver-wt/alert-summary` already held the branch a
 * doc wanted, under a directory name that did not match either the doc's slug or the (then newer)
 * `<repo>-fleet/<slug>` convention — since superseded by `<repo>/.claude/worktrees/<slug>`. A planner that
 * assumes "no worktree at the conventional path" means "none exists" would create a second one for a branch
 * that already has a home — so every check here goes through `git worktree list`, keyed on the BRANCH first,
 * never on a guessed directory name.
 *
 * The second live discovery (`cmux-spawn-existing-worktree-collision`): the branch key alone is
 * not enough either. A parked PR's worktree sat at EXACTLY the conventional slug path, registered and clean,
 * but checked out on `local-15786` — a branch no slug guess names — so the branch lookup missed it, the plan
 * said "create", and `git worktree add` died on the directory it should have reused. {@link findWorktreeAtPath}
 * is the second key: a registered worktree already AT the path a spawn would create is the worktree to open,
 * whatever branch it holds.
 *
 * The third, measured twice: a fixed 20s timeout killed a `git worktree add` that was still writing
 * files (89–90% through a 15,917-file checkout under full-gate load), left a dangling branch and a partial
 * directory behind, and reported the `\r`-overwritten progress bar as the error. Writes here now get a bound
 * sized for the slowest checkout measured rather than the fastest, the file-writing step is the process that
 * is killed (not a parent whose orphaned child keeps writing), a failed add removes its own branch and
 * directory, and the error says "timed out" when that is what happened.
 *
 * The fourth: a subprocess-lane run observed `git worktree list` reporting a killed add's
 * registration as still present AFTER cleanup ran — reproducible on the CI runner's own git even though
 * never forced to reproduce locally across hundreds of real timed-out `add`s under load, nor across every
 * partial-registration admin-dir shape this investigation could construct by hand (where `git worktree
 * prune` removed every one of those immediately, on the git version measured locally). A first fix that
 * verified by inspection and RETRIED `git worktree prune` still lost to the very next CI run: three retried
 * `prune` calls, each confirmed to run, still left the identical entry behind — proving this is not a
 * timing race `prune` eventually wins if asked twice, but something `prune` itself will not remove on that
 * runner's git build no matter how many times it is asked. {@link cleanUpFailedAdd} no longer delegates
 * final removal to `prune` at all: after the best-effort `prune` pass (still run first, since it is the
 * normal, correct tool and clears everything ELSE), it verifies by inspection — the same
 * {@link findWorktreeAtPath} check a planner uses — and if the registration for exactly this `path` is
 * still there, removes that one admin directory directly, by reading each `.git/worktrees/<id>/gitdir` file
 * itself to find the entry whose recorded target is this `path`'s `.git`. That sidesteps whatever `prune` is
 * protecting instead of guessing at it.
 *
 * Everything here is SYNCHRONOUS by construction, not by habit: the `no-headless` gate bans the async
 * `node:child_process` API repo-wide (AGENTS.md rule 2, no allowlist), so an inactivity-based bound — reset
 * every time git prints progress — is not available to this module. A wall-clock bound is the honest
 * substitute, which is why it is generous rather than tight.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, realpathSync, rmdirSync, rmSync } from "node:fs";

import { gitEnv } from "../lib/gitRepo.js";
import { isRecord } from "../lib/parsers.js";
import { withWorktreeAddLock } from "../worktree/addLock.js";
import { cleanUpUnlessHeld, worktreeAdminIds } from "../worktree/depsLock.js";
import { ensureNoindexWorktreesDir } from "../worktree/location.js";
import { gitReadError } from "./gitReadFailure.js";
import { describeGitWriteFailure } from "./gitWriteFailure.js";
import {
  buildFreshBranchAddArgs,
  newPrivateFetchRef,
  parseRemoteDefaultBranch,
  remoteBranchFromBase,
  TRUNK_REMOTE,
} from "./trunkRef.js";
import { removeDanglingWorktreeAdminDir } from "./worktreeAdminDir.js";
import { findWorktreeAtPath, parseOperationalWorktrees, type WorktreeInfo } from "./worktreeList.js";

/** How long a worktree READ (`list`, `rev-parse`, `ls-remote`) may block. Reads are quick or broken. */
const WORKTREE_TIMEOUT_MS = 20_000;

/**
 * How long a worktree WRITE (`fetch`, `worktree add`, the checkout) may run before it is presumed hung.
 *
 * Wall-clock, because the gate leaves no other kind (see the header). Sized from the failure, not the happy
 * path: a 15,917-file checkout was still writing at 20s under full-gate load, so the bound is thirty times
 * that — a checkout that has run ten minutes is not slow, it is stuck. {@link createWorktree} takes the bound
 * as a parameter so the subprocess suite can prove a stuck write IS killed without waiting ten minutes.
 */
const WORKTREE_WRITE_TIMEOUT_MS = 600_000;

/** More stderr than any checkout's progress bar produces (12,000 files measured at ~3.5KB), so a write never dies of ENOBUFS. */
const WORKTREE_WRITE_MAX_BUFFER = 8 * 1024 * 1024;

/**
 * Run one git command against a specific repository, decoded and trimmed.
 *
 * @param args the argv, never a shell string
 * @param cwd the repository to run it in
 * @returns the trimmed stdout
 */
function runGit({ args, cwd, untrimmed }: { args: readonly string[]; cwd: string; untrimmed?: true }): string {
  try {
    const out = execFileSync("git", [...args], {
      cwd,
      encoding: "utf8",
      env: gitEnv(),
      timeout: WORKTREE_TIMEOUT_MS,
    });
    return untrimmed === true ? out : out.trim();
  } catch (error: unknown) {
    throw gitReadError({ args, cwd, error });
  }
}

/**
 * Run one git WRITE against a repository under the generous wall-clock bound, and turn any failure — a
 * non-zero exit, a signal, or the bound itself — into one descriptive error.
 *
 * Killed with SIGKILL rather than the default SIGTERM so a stuck process cannot ignore it; and the caller
 * arranges that the process being killed is the one writing files (see {@link addWorktree}), so nothing
 * keeps writing into a directory after this has reported it dead.
 *
 * @param args the argv, never a shell string
 * @param cwd the repository to run it in
 * @param timeoutMs how long the process may run before it is killed
 */
function runGitWrite({ args, cwd, timeoutMs }: { args: readonly string[]; cwd: string; timeoutMs: number }): void {
  const result = spawnSync("git", [...args], {
    cwd,
    encoding: "utf8",
    env: gitEnv(),
    killSignal: "SIGKILL",
    maxBuffer: WORKTREE_WRITE_MAX_BUFFER,
    stdio: ["ignore", "pipe", "pipe"],
    timeout: timeoutMs,
  });
  if (result.status === 0) {
    return;
  }
  const timedOut = isRecord(result.error) && result.error["code"] === "ETIMEDOUT";
  if (result.error !== undefined && !timedOut) {
    throw new Error(`git ${args.join(" ")} failed: ${result.error.message}`, { cause: result.error });
  }
  throw new Error(
    describeGitWriteFailure({
      args,
      code: result.status,
      signal: result.signal,
      stderr: result.stderr,
      timedOut,
      timeoutMs,
    }),
  );
}

/**
 * Every operational worktree of a repository, as git currently sees them — Codex snapshot-pool slots omitted
 * (`./worktreeList.ts` has why).
 *
 * @param repoRoot the repository whose worktrees to list
 * @returns one entry per worktree, including the main checkout itself
 */
export function listWorktrees({ repoRoot }: { repoRoot: string }): readonly WorktreeInfo[] {
  const text = runGit({ args: ["worktree", "list", "--porcelain"], cwd: repoRoot });
  return parseOperationalWorktrees({ repository: { commonDir: commonGitDir({ repoRoot }), cwd: repoRoot }, text });
}

/** Whether a branch already exists (local or remote), so creating a worktree knows whether to also create it. */
function branchExists({ repoRoot, branch }: { repoRoot: string; branch: string }): boolean {
  try {
    runGit({ args: ["rev-parse", "--verify", "--quiet", branch], cwd: repoRoot });
    return true;
  } catch {
    return false;
  }
}

/**
 * Absolute path to the repository's SHARED `.git` directory, resolved live rather than assumed to be
 * `<repoRoot>/.git` — `repoRoot` may itself be a linked worktree, whose `.git` is a file, not a directory. Only
 * git's own trailing newline is stripped: a directory name may end in a space.
 *
 * @param repoRoot the repository to resolve it for
 * @returns the absolute common git directory
 */
export function commonGitDir({ repoRoot }: { repoRoot: string }): string {
  const printed = runGit({
    args: ["rev-parse", "--path-format=absolute", "--git-common-dir"],
    cwd: repoRoot,
    untrimmed: true,
  });
  return printed.replace(/\n$/u, "");
}

/**
 * How many prune passes {@link cleanUpFailedAdd} makes before falling back to a direct removal. `prune`
 * is the normal, correct tool and clears everything else a failed add could have left behind, so it still
 * gets a real chance first — this just bounds that chance rather than assuming one pass was enough.
 */
const CLEANUP_VERIFY_ATTEMPTS = 3;

/**
 * Undo what a failed add left behind, best-effort and in the order that makes each step safe: the directory
 * first (the process that was writing into it is the one that was killed, so nothing still is), then git's
 * registration of it — verified BY INSPECTION rather than trusted on faith, with
 * {@link removeDanglingWorktreeAdminDir} as an unconditional final pass for the one entry `prune` measurably
 * would not clear on its own — then the branch, and ONLY a branch this call itself created, never one that
 * existed before.
 *
 * Every step swallows its own failure: the error being reported is the add's, and a cleanup that cannot
 * complete must not replace it with its own.
 *
 * An add whose tree never `registered` — its `.git` names no git directory — removes nothing recursively and no
 * admin directory: it runs without the deps lock, so a tree another creation registered at the path since, even
 * from another repository, could be what is there now. git's
 * own failed add already removed what it made; an EMPTY directory is all left to clear, and `prune` skips a live
 * or initialising entry.
 */
function cleanUpFailedAdd({
  repoRoot,
  path,
  createdBranch,
  registered,
  gitCommonDir,
}: {
  repoRoot: string;
  path: string;
  createdBranch: string | undefined;
  registered: boolean;
  gitCommonDir: string;
}): void {
  if (registered) {
    removeRegisteredTree({ gitCommonDir, path, repoRoot });
  } else {
    try {
      rmdirSync(path);
    } catch {
      // Absent or not empty, so nothing of this add's to clear.
    }
    try {
      runGit({ args: ["worktree", "prune"], cwd: repoRoot });
    } catch {
      // Same: best-effort.
    }
  }
  if (createdBranch !== undefined) {
    try {
      runGit({ args: ["branch", "-D", createdBranch], cwd: repoRoot });
    } catch {
      // Same: best-effort.
    }
  }
}

/**
 * {@link cleanUpFailedAdd}'s removal of a tree its add registered, run holding that tree's deps lock. The tree is
 * removed ONCE: once the path is free another repository may create there, so a retry only re-asks git.
 */
function removeRegisteredTree({
  repoRoot,
  path,
  gitCommonDir,
}: {
  repoRoot: string;
  path: string;
  gitCommonDir: string;
}): void {
  try {
    rmSync(path, { force: true, recursive: true });
  } catch {
    // Reported through the add's own error; a directory that will not delete is the next retry's problem.
  }
  for (let attempt = 0; attempt < CLEANUP_VERIFY_ATTEMPTS; attempt++) {
    try {
      runGit({ args: ["worktree", "prune"], cwd: repoRoot });
    } catch {
      // Same: best-effort.
    }
    try {
      if (findWorktreeAtPath({ path, worktrees: listWorktrees({ repoRoot }) }) === undefined) {
        break;
      }
    } catch {
      break; // Can't verify — best-effort, nothing more to try.
    }
  }
  removeDanglingWorktreeAdminDir({ gitCommonDir, path });
}

/**
 * Register the worktree, then populate it — two git processes on purpose, cleaning up after either fails.
 *
 * A plain `git worktree add` runs the checkout as a NESTED `git reset --hard`; killing the outer process on
 * a timeout leaves that child alive and still writing files into the directory this is about to remove,
 * which is how a "cleaned up" failure leaves a partial tree behind anyway. `--no-checkout` makes the
 * registration step quick and write-free, and the `reset --hard` run directly in the new worktree is then
 * the very process the bound kills.
 */
function addWorktree({
  repoRoot,
  registerArgs,
  path,
  createdBranch,
  timeoutMs,
  gitCommonDir,
}: {
  repoRoot: string;
  registerArgs: readonly string[];
  path: string;
  createdBranch: string | undefined;
  timeoutMs: number;
  gitCommonDir: string;
}): void {
  const adminIdsBefore = worktreeAdminIds({ gitCommonDir });
  try {
    runGitWrite({ args: registerArgs, cwd: repoRoot, timeoutMs });
    runGitWrite({ args: ["reset", "--hard"], cwd: path, timeoutMs });
  } catch (error: unknown) {
    // Left alone when a provision that reused the registered tree holds its deps lock (`../worktree/depsLock.ts`).
    cleanUpUnlessHeld({
      adminIdsBefore,
      cleanUp: ({ registered }) => {
        cleanUpFailedAdd({ createdBranch, gitCommonDir, path, registered, repoRoot });
      },
      gitCommonDir,
      worktree: path,
    });
    throw error;
  }
}

/**
 * Create a worktree for a branch at an exact path, creating the branch itself if it does not exist yet.
 *
 * Callers are expected to have already checked `findWorktreeForBranch` ({@link ./worktreeList.ts}) AND
 * {@link findWorktreeAtPath} — this always creates, never reuses, so calling it for a branch that already
 * has a worktree elsewhere fails with git's own "already checked out" error rather than silently doing
 * nothing. The checkout is `worktree add --no-checkout` followed by a direct `reset --hard` in the new worktree — see
 * {@link addWorktree} for why that is not the same as one `worktree add`. A directory already
 * at {@link path} that git does NOT list as a worktree is refused up front with a message that names the
 * fix, instead of git's bare `already exists`: it is either a leftover from a checkout that died (which this
 * module now cleans up itself) or a worktree git has since lost, and neither is something to write into.
 *
 * A brand-new branch is never forked from whatever the shared main worktree happens to have checked out —
 * that ref can be a stray commit, a rebase in progress, or plain stale. It is forked from a freshly fetched
 * remote ref instead: {@link baseBranch} when the doc declared one (a repo where the target content lives
 * on a different long-lived branch than trunk — stacking on another in-flight branch, or a repository's own
 * documented exception branch), otherwise {@link TRUNK_REMOTE}'s own default branch, resolved live rather
 * than assumed to be `main`. Either way a fetch failure (offline, auth, or a named base branch that does not
 * exist on the remote) throws rather than silently falling back to a local ref, which is exactly how the
 * original bug went unnoticed. The fetch lands in a {@link newPrivateFetchRef} private ref rather than
 * `FETCH_HEAD` — a live recipe dispatch (`knock-alerts|<date>|<time>`) failed with `fatal: invalid
 * reference: FETCH_HEAD` because a concurrent `git fetch` from another worktree overwrote it between this
 * function's own fetch and the `worktree add` that read it.
 *
 * If the `add` itself fails — including by outrunning {@link timeoutMs} — the branch it created and the
 * directory it started are removed before the error is rethrown, so the retry is a plain retry rather than
 * `git branch -D` + `rm -rf` by hand first. All of it runs under the path's add lock (`../worktree/addLock.ts`),
 * so that cleanup can never remove a second creation's worktree; a creation of a path another holds throws.
 *
 * @param repoRoot the repository to create the worktree in
 * @param path the exact directory to create it at
 * @param branch the branch to check out there
 * @param baseBranch the branch to fork a brand-new {@link branch} from, or `undefined` to resolve
 *   {@link TRUNK_REMOTE}'s own default branch as before — ignored when {@link branch} already exists
 * @param timeoutMs how long any one write may run before it is killed — production leaves the default
 */
export function createWorktree({
  repoRoot,
  path,
  branch,
  baseBranch,
  timeoutMs = WORKTREE_WRITE_TIMEOUT_MS,
}: {
  repoRoot: string;
  path: string;
  branch: string;
  baseBranch: string | undefined;
  timeoutMs?: number;
}): void {
  const gitCommonDir = realpathSync(commonGitDir({ repoRoot }));
  const created = withWorktreeAddLock({
    act: () => {
      createUnderAddLock({ baseBranch, branch, gitCommonDir, path, repoRoot, timeoutMs });
    },
    gitCommonDir,
    path,
  });
  if (created.isErr()) {
    throw new Error(created.error);
  }
}

/** {@link createWorktree}'s whole body, run holding the path's add lock. */
function createUnderAddLock({
  repoRoot,
  path,
  branch,
  baseBranch,
  timeoutMs,
  gitCommonDir,
}: Required<Parameters<typeof createWorktree>[0]> & { gitCommonDir: string }): void {
  if (existsSync(path)) {
    throw new Error(
      `${path} already exists but git does not list it as a worktree of ${repoRoot} — a registered worktree ` +
        "there would have been reused; remove the directory (and any branch a failed checkout left) and retry",
    );
  }
  const layout = ensureNoindexWorktreesDir({ repoRoot });
  if (layout.isErr()) {
    throw new Error(layout.error.message, { cause: layout.error });
  }
  if (branchExists({ branch, repoRoot })) {
    addWorktree({
      createdBranch: undefined,
      gitCommonDir,
      path,
      registerArgs: ["worktree", "add", "--no-checkout", path, branch],
      repoRoot,
      timeoutMs,
    });
    return;
  }
  const fetched = fetchFreshTrunkRef({ baseBranch, repoRoot, timeoutMs });
  try {
    addWorktree({
      createdBranch: branch,
      gitCommonDir,
      path,
      registerArgs: buildFreshBranchAddArgs({ branch, fetchRef: fetched.fetchRef, path }),
      repoRoot,
      timeoutMs,
    });
  } finally {
    fetched.release();
  }
}

/** {@link TRUNK_REMOTE}'s own default branch, resolved live — never assumed to be `main`. */
function resolveRemoteDefaultBranch({ repoRoot }: { repoRoot: string }): string {
  const symrefText = runGit({ args: ["ls-remote", "--symref", TRUNK_REMOTE, "HEAD"], cwd: repoRoot });
  const trunk = parseRemoteDefaultBranch({ text: symrefText });
  if (trunk === undefined) {
    throw new Error(
      `could not resolve ${TRUNK_REMOTE}'s default branch — 'git ls-remote --symref ${TRUNK_REMOTE} HEAD' reported none`,
    );
  }
  return trunk;
}

/**
 * Fetch {@link baseBranch} (or {@link TRUNK_REMOTE}'s own resolved default branch) into a private ref, shared
 * by {@link createWorktree}'s brand-new-branch path and {@link resetWorktreeToFreshTrunk} — both need the
 * exact same "never trust a local ref, always fetch live" fetch, just followed by a different git write.
 *
 * @param repoRoot the repository to fetch into
 * @param baseBranch the branch to fetch, or `undefined` to resolve {@link TRUNK_REMOTE}'s own default branch
 * @param timeoutMs how long the fetch may run before it is killed
 * @returns the private ref the fetch landed in, and a best-effort release for it once the caller is done
 */
function fetchFreshTrunkRef({
  repoRoot,
  baseBranch,
  timeoutMs,
}: {
  repoRoot: string;
  baseBranch: string | undefined;
  timeoutMs: number;
}): { fetchRef: string; release: () => void } {
  const trunk =
    baseBranch === undefined ? resolveRemoteDefaultBranch({ repoRoot }) : remoteBranchFromBase({ base: baseBranch });
  const fetchRef = newPrivateFetchRef();
  runGitWrite({ args: ["fetch", TRUNK_REMOTE, `refs/heads/${trunk}:${fetchRef}`], cwd: repoRoot, timeoutMs });
  return {
    fetchRef,
    release: () => {
      try {
        runGit({ args: ["update-ref", "-d", fetchRef], cwd: repoRoot });
      } catch {
        // Best-effort — an orphaned private ref is harmless, and the caller's own error (if any) already reported.
      }
    },
  };
}

/**
 * Reset an ALREADY-CHECKED-OUT worktree's branch onto a freshly fetched trunk, discarding whatever local
 * commits or edits it carries — the fix for a reused worktree that otherwise never re-syncs after the
 * generation that first created it. {@link createWorktree} only fetches fresh when the branch does not exist
 * yet; a caller that reuses an existing worktree (the recipe scheduler's per-recipe child worktrees,
 * `../live/automation/plan.ts`) gets none of that, so a worktree provisioned once on day one silently keeps
 * running that day's code forever. This is the "fork it from freshly-fetched origin main" half of that fix —
 * call it before booting a reused worktree whose code must be current, never on one a human or a long-lived
 * session is expected to keep local work in (a handover's own worktree, the scheduler's own dedicated one).
 *
 * @param repoRoot the main checkout to fetch trunk into
 * @param path the worktree to reset — must already be a registered git worktree
 * @param baseBranch the branch to fork from, or `undefined` to resolve {@link TRUNK_REMOTE}'s own default
 *   branch
 * @param timeoutMs how long the fetch and the reset may each run before being killed — production leaves the
 *   default
 */
export function resetWorktreeToFreshTrunk({
  repoRoot,
  path,
  baseBranch,
  timeoutMs = WORKTREE_WRITE_TIMEOUT_MS,
}: {
  repoRoot: string;
  path: string;
  baseBranch: string | undefined;
  timeoutMs?: number;
}): void {
  const fetched = fetchFreshTrunkRef({ baseBranch, repoRoot, timeoutMs });
  try {
    runGitWrite({ args: ["reset", "--hard", fetched.fetchRef], cwd: path, timeoutMs });
  } finally {
    fetched.release();
  }
}
