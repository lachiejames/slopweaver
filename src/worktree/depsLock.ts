/**
 * The lock every writer of ONE worktree's `node_modules` takes: an own-tree provision from its recycle claim through
 * its install mark and exec-inode privatisation, `--deps shared`'s remove-and-symlink (both `./provisionRecycle.ts`),
 * a prune's drop of a kept tree's dependencies (`./pruneDeps.ts`), a prune's removal and the trash pass's put-back of
 * a dead one's batch (`./reclaimTrash.ts`), `worktree remove` (`./inventory.ts`), `worktree unshare`'s relink
 * (`../cli/commands/worktree/unshareRun.ts`), the ref-move hook's install (`../checkouts/refMoveInstallRun.ts`) and a
 * failed add's removal of a tree it registered (`../cmux/worktree.ts`; one whose admin directory predates the add
 * is never its own, and one that never registered removes nothing a tree could hold). Four take none, each
 * because no provision can be writing the tree it touches: `checkout sync` installs only into a configured MAIN
 * checkout; `github restack` and the Codex snapshot remove only scratch worktrees they made themselves;
 * `./pruneRemoved.ts` finishes a residue git has already unregistered, whose `.git` names nothing to lock and whose
 * non-empty directory `git worktree add` refuses; and `desktop install` writes the NESTED `desktop/node_modules`
 * of the checkout it runs from, which no provision, claim or link ever writes — the lock guards the ROOT tree.
 *
 * One writer takes none and is NOT safe by construction: `bin/slopweaver`'s linked-worktree self-heal, which runs
 * `yarn install` in a tree with no executable `tsx` and, failing that over a matching `yarn.lock`, replaces the
 * tree with a symlink to the shared one. Run against a worktree mid-provision it can swap the tree a locked
 * install is writing. It predates the lock, and a shell launcher has no `tsx` to take
 * this module's lock with; closing it needs a lock a launcher can take, or a self-heal that defers to a verb.
 *
 * The lease is the HOLDER's, never its children's. A holder SIGKILLed mid-section — the supervisor tick's budget kill
 * of `session close-done`, say — leaves the `git worktree remove` or `yarn install` it started still writing, and
 * the next taker sees a dead pid and proceeds. The trash protocol (`./reclaimTrash.ts`)
 * shrinks what such an orphan can still be doing to git's removal of a tree whose bulk is already moved aside; it
 * does not close it. Closing it needs a lease that names the child process too.
 *
 * A worktree git already registers is REUSED by provisioning, so two provisions of one path can run at once.
 * The schedule: a claim reserves `<w>/node_modules` with `mkdir`, a
 * shared provision of the same path removes that empty reservation and plants its symlink, and the claim's
 * `rename` — which replaces a symlink as readily as an empty directory — then clobbers it. Held only around the
 * claim, the lock still let that link land between the claim and `yarn install`, so an
 * own provision holds it through the install. Serialised, the own provision either lands first and the link
 * replaces the installed tree exactly as it replaces any own tree, or it meets the symlink and its `mkdir` fails
 * `EEXIST`. A link waits a few seconds and then says who holds it; a prune's drop and a removal never wait — the
 * removal holds it from its move-aside to git's answer (`./reclaimTrash.ts`).
 *
 * The lock lives in the repository's COMMON git directory, keyed by the worktree's ID, never under a state home.
 * The tree and the pool belong to the repository, so two provisions under two `SLOPWEAVER_HOME`s must still
 * contend — a home-scoped lock let them both in. Every spelling of one
 * worktree, the `.claude/worktrees` alias of `.claude/worktrees.noindex` included (`./location.ts`), reads the same
 * `.git` pointer, so one lock serves every name the tree is reached by, a later name after `git worktree move`
 * included. It is never in the worktree's own admin directory, which a failing `git worktree remove` deletes
 * ({@link depsLockLocus}).
 */
import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { basename, join, resolve, sep } from "node:path";

import { sleepSync } from "#lib/sleepSync.js";
import { acquireOperationLock } from "../admit/operationLock.js";
import { gitDirOf } from "../builtCli/listingCache.js";
import { err, ok, type Result } from "../lib/result.js";

/** How long a contender sleeps between attempts. */
const POLL_MS = 25;

/**
 * The lease never goes stale while its holder lives; a dead holder is still taken over on its pid and start stamp.
 * An own provision holds it through a `yarn install` allowed twenty minutes (`./shell.ts`), so the operation lock's
 * fifteen-minute default handed a LIVE install's tree to a link, a prune or a removal.
 */
const NEVER_STALE = Number.POSITIVE_INFINITY;

/**
 * The directory under the repository's common git directory the operation lock is rooted at.
 * `acquireOperationLock` lays its locks out under the root it is given exactly as under a state home, so this root
 * is the repository's own.
 */
const LOCK_ROOT_NAME = "slopweaver";

/**
 * The key a worktree's lock is taken under. It names the worktree's git-assigned ID, never its path: a path in it
 * let `git worktree move` mid-install give the same tree a second lock under its new name, and an ID survives a move.
 */
const LOCK_KEY = "worktree-node-modules";

/** Where one worktree's deps lock lives, and the git directory that placed it there. */
export interface DepsLockLocus {
  /** The worktree's real path. */
  readonly real: string;
  /** Its own git directory — the admin directory under `<common>/worktrees/` for a linked worktree. */
  readonly gitDir: string;
  /** The lock root: the repository's COMMON git directory's `slopweaver`, which no worktree removal deletes. */
  readonly root: string;
  /** The key under that root: {@link LOCK_KEY}, with the worktree's ID for a linked one. */
  readonly key: string;
}

/**
 * Where one worktree's deps lock lives: in the repository's COMMON git directory, keyed by the worktree's ID, so the
 * locus is the repository's whatever state home the caller runs under.
 *
 * Never in the worktree's own admin directory: `git worktree remove` deletes that directory even when it fails to
 * delete the tree, so a removal lost its lock inside its own critical section, and a waiting provision's acquire
 * recreated the directory and took a second one. A linked worktree's common
 * directory is read from its admin directory's `commondir`, the file git itself reads, so once git has removed the
 * admin directory the locus fails rather than being recreated.
 *
 * @param worktree the worktree whose `node_modules` is locked
 * @returns where its lock lives, or why the worktree's git directory cannot be found
 */
export function depsLockLocus({ worktree }: { worktree: string }): Result<DepsLockLocus, string> {
  try {
    return ok(resolveLocus({ worktree }));
  } catch (error: unknown) {
    return err(`${worktree}'s git directory could not be resolved to lock its node_modules: ${String(error)}`);
  }
}

/** {@link depsLockLocus}'s reads, throwing on any one that fails so every failure is one message. */
function resolveLocus({ worktree }: { worktree: string }): DepsLockLocus {
  const real = realpathSync(worktree);
  const dotGit = join(real, ".git");
  if (lstatSync(dotGit).isDirectory()) {
    const gitDir = realpathSync(dotGit);
    return { gitDir, key: LOCK_KEY, real, root: join(gitDir, LOCK_ROOT_NAME) };
  }
  const named = gitDirOf({ dotGit: readFileSync(dotGit, "utf8"), root: real });
  if (named === undefined) {
    throw new Error(`${dotGit} names no git directory`);
  }
  const gitDir = realpathSync(named);
  const common = realpathSync(resolve(gitDir, readFileSync(join(gitDir, "commondir"), "utf8").trim()));
  return { gitDir, key: `${LOCK_KEY} ${basename(gitDir)}`, real, root: join(common, LOCK_ROOT_NAME) };
}

/**
 * Why a lock taken under `held` no longer guards this worktree, read again once it is held, or `undefined` while it
 * still does.
 *
 * The locus is resolved before the lock is taken, so a worktree removed and recreated at the same path in between
 * can name a NEW git directory, and the lock taken is the old one's; a worktree
 * git removed in between names an admin directory that is gone, and fails. Read again under the lock, the answer
 * stays true until release, because every removal takes this same lock.
 *
 * @param held the locus the lock was taken under
 * @param worktree the worktree it was taken for
 * @returns why the held lock is not this worktree's, or `undefined` when it is
 */
export function depsLockLocusMoved({ held, worktree }: { held: DepsLockLocus; worktree: string }): string | undefined {
  const now = depsLockLocus({ worktree });
  if (now.isErr()) {
    return now.error;
  }
  if (now.value.root === held.root && now.value.key === held.key) {
    return undefined;
  }
  return `${worktree}'s git directory changed while its deps lock was taken (${held.gitDir} is now ${now.value.gitDir}), so the lock held is not this worktree's`;
}

/**
 * Run `act` holding the worktree's `node_modules` lock, polling up to `waitMs` for it, and only once the lock taken
 * is still the worktree's ({@link depsLockLocusMoved}).
 *
 * @param worktree the worktree whose `node_modules` `act` replaces
 * @param waitMs how long to keep trying for a lock another process holds
 * @param act the critical section, run at most once
 * @returns what `act` returned, or why the lock was not taken within `waitMs` or no longer guards the worktree
 */
export function withDepsLock<T>({
  worktree,
  waitMs,
  act,
}: {
  worktree: string;
  waitMs: number;
  act: () => T;
}): Result<T, string> {
  const locus = depsLockLocus({ worktree });
  if (locus.isErr()) {
    return err(locus.error);
  }
  const deadline = Date.now() + waitMs;
  for (;;) {
    const lock = acquireOperationLock({
      home: locus.value.root,
      key: locus.value.key,
      nowIso: new Date().toISOString(),
      staleAfterMs: NEVER_STALE,
    });
    if (lock.isOk()) {
      try {
        const moved = depsLockLocusMoved({ held: locus.value, worktree });
        if (moved !== undefined) {
          return err(moved);
        }
        return ok(act());
      } finally {
        lock.value.release();
      }
    }
    if (Date.now() >= deadline) {
      return err(lock.error);
    }
    sleepSync({ ms: POLL_MS });
  }
}

/**
 * The IDs of every worktree admin directory under a repository's common git directory, read before an add so its
 * cleanup can tell the tree it registered from one that was already there ({@link cleanUpUnlessHeld}).
 *
 * @param gitCommonDir the REAL path of the repository's common git directory
 * @returns the admin directory names under its `worktrees/`, empty when it has none
 */
export function worktreeAdminIds({ gitCommonDir }: { gitCommonDir: string }): ReadonlySet<string> {
  const worktrees = join(gitCommonDir, "worktrees");
  return new Set(existsSync(worktrees) ? readdirSync(worktrees) : []);
}

/**
 * Run a failed add's cleanup of `worktree` under its deps lock, never under another holder's.
 *
 * A registered worktree is REUSED by provisioning, so a second provision can take the tree a failing add registered
 * and be installing into it when the add's cleanup deletes the path. Held, the
 * tree is that provision's now and is left alone. The tree counts as the add's own only when its git directory lies
 * under this repository's `worktrees/` — another repository's tree at the path is not — AND that directory was not there before the add began: a tree `git worktree move`d onto the path
 * keeps its old ID, so a location check alone deleted it, uncommitted work and all.
 * Anything else runs without a lock and is told it never registered, so it removes nothing a tree could hold.
 * A raw `git worktree add` of the same path by a process outside the add lock, landing
 * between the snapshot and this add, is the one tree this cannot tell from its own.
 *
 * @param worktree the path the failed add registered
 * @param gitCommonDir the REAL path of the failing add's repository's common git directory, resolved before the add
 * @param adminIdsBefore {@link worktreeAdminIds} read under the add lock before the add ran
 * @param cleanUp the removal of it, told whether the add's own tree registered and is held under its deps lock
 * @returns whether the cleanup ran, or was left to the provision holding the tree
 */
export function cleanUpUnlessHeld({
  worktree,
  gitCommonDir,
  adminIdsBefore,
  cleanUp,
}: {
  worktree: string;
  gitCommonDir: string;
  adminIdsBefore: ReadonlySet<string>;
  cleanUp: (args: { registered: boolean }) => void;
}): "cleaned" | "held" {
  const locus = depsLockLocus({ worktree });
  const ownAdminDir =
    locus.isOk() &&
    locus.value.gitDir.startsWith(join(gitCommonDir, "worktrees") + sep) &&
    !adminIdsBefore.has(basename(locus.value.gitDir));
  if (!ownAdminDir) {
    cleanUp({ registered: false });
    return "cleaned";
  }
  const locked = withDepsLock({
    act: () => {
      cleanUp({ registered: true });
    },
    waitMs: 0,
    worktree,
  });
  return locked.isOk() ? "cleaned" : "held";
}
