/**
 * Dropping a KEPT worktree's installed dependencies — the second thing `worktree prune --apply` reclaims.
 *
 * Which trees qualify is decided purely, in `./pruneClassify`'s `depsDroppable`, and carried on the verdict
 * as `dropsDeps`. This file finds the directories and deletes them.
 *
 * **Git names the directories, and that is the witness.** `git ls-files --others --ignored
 * --exclude-standard --directory` reports an ignored directory as ONE entry only when nothing inside it is
 * tracked; a directory holding a single tracked file is listed file by file instead and never matches here.
 * So a directory this removes is, by git's own reading, nothing but installed output that `yarn install`
 * writes back. A symlinked `node_modules` — the retired shared mode — is skipped: it costs nothing, and
 * removing a link is not what frees the disk.
 *
 * **The directory's mtime is put back right after the move.** Moving a child out changes its parent's mtime, and
 * that mtime is one of the activity stamps the coldness rule reads — so without the restore, dropping a tree's
 * dependencies would make it look touched a moment ago and defer its own removal by a further
 * `--older-than`, exactly the self-inflicted warmth `./pruneScan` already refuses for an interrupted removal.
 */
import { lstatSync, mkdirSync, renameSync, rmSync, statSync, utimesSync } from "node:fs";
import { basename, join } from "node:path";

import { withDepsLock } from "./depsLock.js";
import { liveReferencesTo } from "./location.js";

import type { PruneVerdict } from "./pruneClassify.js";
import { type GitRunner, realGit } from "./pruneGit.js";
import { interleave, type RepoPlan, type RepoVerdict } from "./pruneOrder.js";
import { deleteGently, type Pacer } from "./prunePacing.js";
import { lockHoldIn } from "./pruneRecheck.js";
import { dirMs } from "./pruneScan.js";
import { reclaimTrashDir } from "./reclaimTrash.js";
import { worktreeRecycleIdentity } from "./recycleIdentity.js";
import { depositRecycled, recyclePoolDir } from "./recyclePool.js";

/** The directory name dropped — the only one, so a build output or a cache is never swept up with it. */
const DEPS_DIR = "node_modules";

/**
 * The `node_modules` directories in a `git ls-files --others --ignored --exclude-standard --directory -z`
 * listing, relative to the worktree.
 *
 * Pure. A collapsed directory is the only kind of entry that ends in `/`, which is what makes an entry
 * a whole untracked directory rather than one file inside a partly-tracked one.
 *
 * @param listing the NUL-separated listing
 * @returns every entry naming a wholly-untracked `node_modules` directory, without its trailing slash
 */
export function depDirsIn({ listing }: { listing: string }): readonly string[] {
  return listing
    .split("\0")
    .filter((entry) => entry.endsWith("/"))
    .map((entry) => entry.slice(0, -1))
    .filter((entry) => basename(entry) === DEPS_DIR);
}

/** What dropping one tree's dependencies did. */
export interface DepsOutcome {
  readonly path: string;
  readonly branch: string | null;
  /** The directories removed, relative to the tree. */
  readonly dropped: readonly string[];
  /** Why nothing, or not everything, was removed — `null` when every directory went. */
  readonly declined: string | null;
}

/**
 * Why a tree is not one whose dependencies may be stripped, read from the tree itself rather than the scan.
 *
 * @param path the worktree root
 * @returns the reason to decline, or `null` when the root is a real directory holding a linked worktree
 */
function notStrippable({ path }: { path: string }): string | null {
  // A root swapped for a symlink would list, and strip, whatever it points at — the main checkout, in the r2
  // Codex review. Git never descends a symlink below the root, so the root is the one component to check.
  if (lstatSync(path, { throwIfNoEntry: false })?.isDirectory() !== true) {
    return "its root is no longer a real directory";
  }
  // A linked worktree carries a `.git` FILE; a main checkout carries the directory. The scan names the main one by
  // its path, which a symlinked spelling defeats, so the drop asks the tree itself.
  if (lstatSync(join(path, ".git"), { throwIfNoEntry: false })?.isFile() !== true) {
    return "it is not a linked worktree";
  }
  return null;
}

/**
 * The listed directories that are still real directories, never followed through a symlink, and that git
 * confirms hold nothing tracked.
 *
 * The confirmation is asked per directory, by its literal name, rather than trusted from the listing: the runner
 * trims its output, so a directory named ` node_modules` read back as the TRACKED `node_modules` beside it. A question about the exact path cannot be misparsed that way; anything but an empty answer
 * skips it.
 *
 * @param dirs the directories, relative to the tree
 * @param git how to run git
 * @param path the tree they are relative to
 * @returns the directories safe to move
 */
function strippable({ dirs, git, path }: { dirs: readonly string[]; git: GitRunner; path: string }): string[] {
  return dirs.filter((dir) => {
    const entry = lstatSync(join(path, dir), { throwIfNoEntry: false });
    if (entry === undefined || entry.isSymbolicLink() || !entry.isDirectory()) {
      return false;
    }
    return git({ args: ["--literal-pathspecs", "ls-files", "-z", "--", dir], cwd: path }) === "";
  });
}

/**
 * Move each directory into one fresh batch under the trash, renames only, so the caller's mtime restore covers
 * microseconds. The batch carries no `pending.json`, because nothing in it is ever put back: any pass may empty it.
 *
 * @param dirs the directories {@link strippable} confirmed, relative to the tree
 * @param path the tree they are relative to
 * @param batch the trash batch they are moved into, on the tree's own volume
 * @returns what was moved, where each went, and each failure with its reason
 */
function moveDirsAside({ dirs, path, batch }: { dirs: readonly string[]; path: string; batch: string }): {
  dropped: string[];
  moved: string[];
  failed: string[];
} {
  const dropped: string[] = [];
  const moved: string[] = [];
  const failed: string[] = [];
  for (const dir of dirs) {
    const target = join(path, dir);
    const to = join(batch, String(moved.length));
    try {
      mkdirSync(batch, { recursive: true });
      renameSync(target, to);
      dropped.push(dir);
      moved.push(to);
    } catch (error: unknown) {
      failed.push(`${dir}: could not be moved aside — ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return { dropped, failed, moved };
}

/** How long one `node_modules` may take to delete at background priority before the drop leaves it in the trash. */
const DROP_TIMEOUT_MS = 15 * 60_000;

/**
 * Delete what one drop moved aside, at background priority, stopping before the next directory once `paused`
 * says so. Anything left is an ordinary batch in the trash, which every later emptying pass finishes.
 *
 * @param moved where each directory went
 * @param batch the batch holding them, removed once empty
 * @param paused why no further directory may be deleted right now, or null
 * @param deleteDir deletes one moved directory inside its timeout and says whether it is gone
 */
function deleteMoved({
  moved,
  batch,
  paused,
  deleteDir,
}: {
  moved: readonly string[];
  batch: string;
  paused: () => string | null;
  deleteDir: (input: { dir: string; timeoutMs: number }) => boolean;
}): void {
  for (const [index, to] of moved.entries()) {
    // At background priority (`./prunePacing.ts`): one acme-admin `node_modules` is millions of files, and deleted
    // at full speed it held the 1-minute load near 120 with fseventsd past 100% CPU.
    if ((index > 0 && paused() !== null) || !deleteDir({ dir: to, timeoutMs: DROP_TIMEOUT_MS })) {
      return;
    }
  }
  rmSync(batch, { force: true, recursive: true });
}

/**
 * Remove every wholly-untracked `node_modules` directory from one tree: move each into the trash, put the tree's
 * mtime back at once, then delete what moved at background priority.
 *
 * Moving first is what keeps the mtime restore honest. A `rename` takes microseconds, so the restore rewinds
 * only this drop's own change; restored after a minutes-long delete, it would rewind any file a session created
 * in the root meanwhile, and the next run could read a live tree as cold.
 *
 * The ROOT `node_modules` is offered to the recycle pool first (`./recyclePool.ts`), while the tree's own
 * `package.json` is still there to vouch for it: a deposited tree is renamed whole into the pool and never
 * deleted, and a declined one goes to the trash with the rest, exactly as before the pool existed.
 *
 * @param verdict the kept tree, whose `dropsDeps` the classifier already set
 * @param trashDir the repository's reclaim trash, on the tree's own volume
 * @param recyclePool the repository's recycle pool, or `undefined` to recycle nothing
 * @param paused why no further directory may be deleted right now, read between directories, or null
 * @param git how to run git, so a test can hand in a listing
 * @param deleteDir deletes one moved directory; {@link deleteGently} unless a test passes one configured with a fixed
 *   gauge and a non-darwin `os`. Both machine reads inside the default can hold a delete past a test's budget:
 *   `taskpolicy -b`'s background QoS starves behind a saturated unit shard, and a hot live fseventsd holds every
 *   quantum until the 15-minute deadline
 * @returns what was removed from the tree, and what declined
 */
export function dropDeps({
  verdict,
  trashDir,
  recyclePool,
  paused,
  git = realGit,
  deleteDir = deleteGently,
}: {
  verdict: PruneVerdict;
  trashDir: string;
  recyclePool?: string | undefined;
  paused: () => string | null;
  git?: GitRunner;
  deleteDir?: (input: { dir: string; timeoutMs: number }) => boolean;
}): DepsOutcome {
  const { branch, path } = verdict;
  const refusal = notStrippable({ path });
  if (refusal !== null) {
    return { branch, declined: refusal, dropped: [], path };
  }
  const listing = git({
    args: ["ls-files", "--others", "--ignored", "--exclude-standard", "--directory", "-z"],
    cwd: path,
  });
  // A name that is not UTF-8 decodes to U+FFFD and could name a DIFFERENT directory on disk (on
  // Linux), so a listing carrying one is not read at all.
  if (listing === null || listing.includes("\uFFFD")) {
    return { branch, declined: "git could not list its ignored directories", dropped: [], path };
  }
  // A lock taken since the scan: the scan's own lock hold already left a locked tree off this pass, and nothing else
  // a seat working here from another cwd can do would reach it before its node_modules move.
  const locked = lockHoldIn({ listing: git({ args: ["worktree", "list", "--porcelain"], cwd: path }), path });
  if (locked !== null) {
    return { branch, declined: locked, dropped: [], path };
  }
  const batch = join(trashDir, `${basename(path)}-deps-${String(Date.now())}-${String(process.pid)}`);
  // Under the tree's deps lock, taken once and never waited on: a provision installing into this tree holds it, and
  // a tree yarn is mid-write in is neither deposited for another worktree to claim nor pulled out from under yarn.
  // Which directories are real ones is read under it too, since a shared link swaps one for a symlink under the same
  // lock. Every git question is still asked BEFORE the stamp is read, so only the
  // renames sit between the read and the restore.
  const held = withDepsLock({
    act: () =>
      moveUnderLock({ batch, dirs: strippable({ dirs: depDirsIn({ listing }), git, path }), path, recyclePool }),
    waitMs: 0,
    worktree: path,
  });
  if (held.isErr()) {
    return { branch, declined: `a provision holds its node_modules: ${held.error}`, dropped: [], path };
  }
  const { dropped, failed, moved } = held.value;
  // Nothing moved means nothing of this drop's to delete; a batch already at that name is not this drop's to empty,
  // and emptying it would delete bytes `dropDepsInRotation`'s cap reads as never deleted.
  if (moved.length > 0) {
    deleteMoved({ batch, deleteDir, moved, paused });
  }
  return { branch, declined: failed.length === 0 ? null : failed.join("; "), dropped, path };
}

/**
 * Deposit the root tree, move every other directory into the trash batch, and put the tree's mtime back — the
 * renames {@link dropDeps} makes holding the tree's deps lock.
 *
 * @param batch the trash batch the moved directories go into
 * @param dirs the directories {@link strippable} confirmed, relative to the tree
 * @param path the tree
 * @param recyclePool the repository's recycle pool, or `undefined` to recycle nothing
 * @returns everything removed from the tree, what went to the batch, and what could not be moved
 */
function moveUnderLock({
  batch,
  dirs,
  path,
  recyclePool,
}: {
  batch: string;
  dirs: readonly string[];
  path: string;
  recyclePool: string | undefined;
}): { dropped: string[]; moved: string[]; failed: string[] } {
  const before = statSync(path, { throwIfNoEntry: false });
  const pooled = depositRoot({ dirs, path, recyclePool });
  const aside = moveDirsAside({ batch, dirs: dirs.filter((dir) => !pooled.includes(dir)), path });
  if (before !== undefined && pooled.length + aside.dropped.length > 0) {
    utimesSync(path, before.atime, before.mtime);
  }
  return { ...aside, dropped: [...pooled, ...aside.dropped] };
}

/**
 * Deposit a kept tree's root `node_modules` into the recycle pool when it is among the directories to drop, the
 * tree vouches for it, and a slot is free.
 *
 * @param dirs the directories {@link strippable} confirmed, relative to the tree
 * @param path the tree
 * @param recyclePool the repository's recycle pool, or `undefined` to recycle nothing
 * @returns `["node_modules"]` when it went to the pool, else nothing
 */
function depositRoot({
  dirs,
  path,
  recyclePool,
}: {
  dirs: readonly string[];
  path: string;
  recyclePool: string | undefined;
}): readonly string[] {
  if (recyclePool === undefined || !dirs.includes(DEPS_DIR)) {
    return [];
  }
  if (worktreeRecycleIdentity({ worktree: path }).kind !== "eligible") {
    return [];
  }
  const deposit = depositRecycled({
    entryName: `${basename(path)}-deps-${String(Date.now())}-${String(process.pid)}`,
    pool: recyclePool,
    source: join(path, DEPS_DIR),
  });
  return deposit.kind === "deposited" ? [DEPS_DIR] : [];
}

/**
 * Every kept tree whose dependencies an apply drops, round-robin across the repositories.
 *
 * @param plans every repository's classified verdicts, in sweep order
 * @returns the trees, one repository at a time in rotation
 */
function depsOrder({ plans }: { plans: readonly RepoPlan[] }): readonly RepoVerdict[] {
  return interleave({
    lists: plans.map((plan) =>
      plan.verdicts.filter((verdict) => verdict.dropsDeps).map((verdict) => ({ repoRoot: plan.repoRoot, verdict })),
    ),
  });
}

/**
 * Render one tree's dependency drop as a result line.
 *
 * @param outcome what happened to the tree
 * @returns the line to print
 */
export function renderDepsOutcome({ outcome }: { outcome: DepsOutcome }): string {
  let name = "(detached)";
  if (outcome.branch !== null) {
    name = outcome.branch;
  }
  const dropped =
    outcome.dropped.length === 0
      ? "no node_modules to drop"
      : `dropped ${outcome.dropped.join(", ")} — tree kept, \`yarn install\` restores it`;
  const declined = outcome.declined === null ? "" : ` (declined: ${outcome.declined})`;
  return `  ${name} — ${dropped}${declined}\n    ${outcome.path}`;
}

/**
 * Whether a tree marked `dropsDeps` still qualifies NOW — the pass runs after every removal, and the scan
 * that marked it can be `--scan-budget` + `--budget` old by then.
 *
 * The r2 Codex review broke the first cut on exactly that: a session opened in the tree after the scan, and
 * the pass deleted its `node_modules` off the scan's facts. So both of the facts the classifier read are
 * read again — the live registers, fresh, and the tree's own activity stamp — and a tree failing either,
 * or gone, is skipped.
 *
 * @param live the live-reference index, read after the removals rather than before them
 * @param nowMs the instant the pass judges coldness against
 * @param olderThanMs the eligibility age
 * @returns the check the pass asks of each tree before it touches it
 */
export function coldNow({
  live,
  nowMs,
  olderThanMs,
}: {
  live: ReadonlyMap<string, readonly string[]>;
  nowMs: number;
  olderThanMs: number;
}): (input: { verdict: PruneVerdict }) => boolean {
  return ({ verdict }) => {
    const touched = dirMs({ path: verdict.path });
    const held = liveReferencesTo({ live, path: verdict.path }).length > 0;
    return !held && touched !== null && nowMs - touched >= olderThanMs;
  };
}

/** What the dependency pass did: how many kept trees it stripped, and which the budget did not reach. */
export interface DepsPass {
  readonly stripped: number;
  readonly remaining: readonly RepoVerdict[];
}

/**
 * Drop the `node_modules` of every kept tree the classifier marked, in rotation, until the deadline.
 *
 * Runs AFTER the removals, on the same deadline: a removal frees the whole tree and ends a registration, so
 * it is worth more per minute than a drop from a tree the plan keeps anyway. The deadline is checked between
 * trees, never during one, for the reason `pruneApplyRotation`'s `applyInRotation` states. A run whose removals spend
 * the whole budget therefore drops nothing, and {@link depsClause} says how many it still owes. The pacer is
 * asked before every tree too, and waited on after every tree it ran a drop on, so a pass stops at its cap or
 * when the load reaches the hold, and never starts two drops back to back (`./prunePacing.ts`). The cap counts
 * every drop ATTEMPTED, a failed or timed-out one included, since each of those deleted at least part of a tree —
 * but never one that deleted nothing at all ({@link deletedNothing}).
 *
 * @param plans every repository's classified verdicts, in sweep order
 * @param deadlineMs the epoch instant this pass may not start another tree after
 * @param print where each tree's result line goes
 * @param stillCold the re-check each tree must pass right before it is touched, reading live state fresh
 * @param pace the brakes between trees: why to stop before the next one, and the wait after a drop
 * @param paused why the bulk delete inside one drop must stop now, or null — the apply's own disk-pressure-aware gate
 * @param drop how one tree is stripped, so a test can hand in a fake
 * @returns how many trees lost a directory, and the trees the budget did not reach
 */
export async function dropDepsInRotation({
  plans,
  deadlineMs,
  print,
  stillCold,
  pace,
  paused,
  drop = ({ verdict, repoRoot }) =>
    dropDeps({
      paused,
      recyclePool: recyclePoolDir({ repoRoot }),
      trashDir: reclaimTrashDir({ repoRoot }),
      verdict,
    }),
}: {
  plans: readonly RepoPlan[];
  deadlineMs: number;
  print: (input: { line: string }) => void;
  stillCold: (input: { verdict: PruneVerdict }) => Promise<boolean>;
  pace: Pacer;
  paused: () => string | null;
  drop?: (input: { verdict: PruneVerdict; repoRoot: string }) => DepsOutcome;
}): Promise<DepsPass> {
  const order = depsOrder({ plans });
  let stripped = 0;
  let attempted = 0;
  let index = 0;
  while (index < order.length && Date.now() < deadlineMs) {
    const stop = pace.stopReason({ done: attempted });
    if (stop !== null) {
      print({ line: `  node_modules pass paused: ${stop}` });
      break;
    }
    const { cold, outcome } = await dropIfCold({ drop, stillCold, target: order[index]! });
    const acted = cold && !deletedNothing({ outcome });
    attempted += acted ? 1 : 0;
    stripped += outcome.dropped.length > 0 ? 1 : 0;
    print({ line: renderDepsOutcome({ outcome }) });
    index += 1;
    if (acted && index < order.length) {
      await pace.settle();
    }
  }
  return { remaining: order.slice(index), stripped };
}

/**
 * Whether a drop deleted nothing: no directory moved and none failed mid-move. The common case is a tree an earlier
 * run already stripped; a listed directory the tracked-file re-check then refused is the other, and it deleted
 * nothing too. The cap bounds deletion load, so neither spends it nor earns a wait: counted, the trees stripped
 * first sat at the head of the rotation and spent the whole cap on every later run, leaving 13 of a second checkout's trees
 * owed indefinitely. A failed move is `declined`, so it still counts.
 *
 * @param outcome what the drop did
 * @returns true when nothing was removed and nothing declined
 */
function deletedNothing({ outcome }: { outcome: DepsOutcome }): boolean {
  return outcome.dropped.length === 0 && outcome.declined === null;
}

/**
 * Strip one tree's `node_modules` if it is still cold right before it is touched, else decline it.
 *
 * @param target the tree and the repository it belongs to
 * @param stillCold the fresh re-check of live state
 * @param drop how the tree is stripped
 * @returns whether a drop was attempted, and what it did or why it was declined
 */
async function dropIfCold({
  target,
  stillCold,
  drop,
}: {
  target: { readonly repoRoot: string; readonly verdict: PruneVerdict };
  stillCold: (input: { verdict: PruneVerdict }) => Promise<boolean>;
  drop: (input: { verdict: PruneVerdict; repoRoot: string }) => DepsOutcome;
}): Promise<{ cold: boolean; outcome: DepsOutcome }> {
  const { repoRoot, verdict } = target;
  if (!(await stillCold({ verdict }))) {
    const declined = "taken or touched since the scan";
    return { cold: false, outcome: { branch: verdict.branch, declined, dropped: [], path: verdict.path } };
  }
  return { cold: true, outcome: drop({ repoRoot, verdict }) };
}

/**
 * The clause the apply's summary line adds for the dependency pass.
 *
 * @param deps the pass, or `undefined` under `--merged-only`, which narrows the run to removals
 * @returns the clause with its own leading separator, empty when there is nothing to say
 */
export function depsClause({ deps }: { deps: DepsPass | undefined }): string {
  if (deps === undefined) {
    return "";
  }
  const owed = deps.remaining.length === 0 ? "" : ` (${String(deps.remaining.length)} more owed to the next run)`;
  if (deps.stripped === 0 && owed === "") {
    return "";
  }
  return ` and dropped node_modules from ${String(deps.stripped)} kept worktree(s)${owed}`;
}
