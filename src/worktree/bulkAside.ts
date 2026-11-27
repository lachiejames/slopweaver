/**
 * Moving a worktree's wholly ignored `node_modules` out of it before `git worktree remove`, and putting them back
 * when git refuses. The trash, the deps lock and the commit that hands a batch to the emptier are
 * `./reclaimTrash.ts`'s; this module is only the rename in each direction, and the listing that decides what moves.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, renameSync } from "node:fs";
import { basename, dirname, join } from "node:path";

import { gitEnv } from "#lib/gitRepo.js";
import { ownProcessStart } from "../admit/lockHolder.js";
import { type RecycleIdentity, worktreeRecycleIdentity } from "./recycleIdentity.js";
import { HOOKS_OFF } from "./salvageHooksOff.js";
import { dropBatch, publishBatch } from "./trashBatch.js";

/** The directory name moved aside — the one ignored bulk every checkout here carries. */
export const BULK_NAME = "node_modules";

/** Enough for a listing of every ignored directory in a large monorepo. */
const LIST_MAX_BUFFER = 8 * 1024 * 1024;

/** Listing ignored directories takes 0.24s on a 187k-file worktree; this bounds a wedged git, not a slow one. */
const LIST_TIMEOUT_MS = 30_000;

/** One directory moved out of a worktree, and where it went. */
interface BulkMove {
  readonly from: string;
  readonly to: string;
}

/**
 * The worktree-relative `node_modules` directories safe to move aside, from git's own listing.
 *
 * `listing` is `git ls-files -z --others --ignored --exclude-standard --directory`: a wholly ignored directory
 * is one entry ending in `/`. A directory holding anything tracked or un-ignored is never listed whole — git
 * lists its ignored children instead, so a mixed `node_modules` never reaches the rename. An entry with
 * another listed beneath it is refused too, as defence in depth against a git that ever lists both.
 *
 * @param listing git's NUL-separated output
 * @returns relative paths without a trailing slash, in git's order
 */
export function bulkEntriesToMove({ listing }: { listing: string }): readonly string[] {
  const entries = listing.split("\0").filter((entry) => entry.length > 0);
  return entries
    .filter((entry) => entry.endsWith("/"))
    .filter((entry) => basename(entry.slice(0, -1)) === BULK_NAME)
    .filter((entry) => !entries.some((other) => other !== entry && other.startsWith(entry)))
    .map((entry) => entry.slice(0, -1));
}

/**
 * Git's listing of a worktree's ignored entries, or `undefined` when git could not give one.
 *
 * @param worktree the worktree to list
 * @returns the NUL-separated listing, or `undefined`
 */
function ignoredListing({ worktree }: { worktree: string }): string | undefined {
  try {
    return execFileSync(
      "git",
      [...HOOKS_OFF, "ls-files", "-z", "--others", "--ignored", "--exclude-standard", "--directory"],
      {
        cwd: worktree,
        encoding: "utf8",
        env: gitEnv(),
        maxBuffer: LIST_MAX_BUFFER,
        stdio: ["ignore", "pipe", "ignore"],
        timeout: LIST_TIMEOUT_MS,
      },
    );
  } catch {
    return undefined;
  }
}

/** One batch of moves out of one worktree, pending until it is committed or {@link restoreBulk} undoes it. */
export interface BulkBatch {
  /** The batch directory under the trash root. */
  readonly dir: string;
  /** The moves that actually happened, which {@link restoreBulk} undoes. */
  readonly moves: readonly BulkMove[];
  /** The worktree the moves came out of. */
  readonly worktree: string;
  /**
   * Whether the worktree's ROOT `node_modules` may go to the recycle pool, read before anything moved — after
   * git's removal its `package.json` is gone. `undefined` when no root `node_modules` was planned to move.
   */
  readonly rootIdentity: RecycleIdentity | undefined;
}

/** What moving a worktree's bulk aside came to: nothing to move, all of it moved, or some of it left in the tree. */
type BulkAside =
  | { readonly kind: "nothing" }
  | { readonly kind: "moved"; readonly batch: BulkBatch }
  | { readonly kind: "incomplete"; readonly why: string; readonly batch: BulkBatch | null };

/**
 * Rename a worktree's wholly ignored `node_modules` directories into one fresh PENDING batch under the trash.
 *
 * A `node_modules` that cannot be listed or renamed is NOT left for `git worktree remove`: git would delete its
 * millions of files in place, ungoverned, the fseventsd storm.
 * So anything short of every planned move is `incomplete`, and the caller keeps the whole tree for the next run.
 * The `pending.json` is written before the first rename, so no moved directory is ever in a batch without it.
 *
 * @param worktree the worktree about to be removed
 * @param trashDir the trash root, a sibling of the worktree on the same volume
 * @param nowMs the instant naming this batch, so two removals of one name never share a directory
 * @returns what was moved, or why some of it could not be
 */
export function moveBulkAside({
  worktree,
  trashDir,
  nowMs,
}: {
  worktree: string;
  trashDir: string;
  nowMs: number;
}): BulkAside {
  const listing = ignoredListing({ worktree });
  if (listing === undefined) {
    return { batch: null, kind: "incomplete", why: "git could not list its ignored directories" };
  }
  const entries = bulkEntriesToMove({ listing });
  if (entries.length === 0) {
    return { kind: "nothing" };
  }
  const dir = join(trashDir, `${basename(worktree)}-${String(nowMs)}-${String(process.pid)}`);
  const planned = entries.map((entry, index) => ({ from: join(worktree, entry), to: join(dir, String(index)) }));
  const rootIdentity = entries.includes(BULK_NAME) ? worktreeRecycleIdentity({ worktree }) : undefined;
  if (!publishBatch({ dir, pending: { moves: planned, pid: process.pid, start: ownProcessStart(), worktree } })) {
    return { batch: null, kind: "incomplete", why: "its trash batch could not be published" };
  }
  const moves: BulkMove[] = [];
  const stuck: string[] = [];
  for (const move of planned) {
    try {
      renameSync(move.from, move.to);
      moves.push(move);
    } catch {
      stuck.push(move.from);
    }
  }
  const batch = { dir, moves, rootIdentity, worktree };
  if (stuck.length > 0) {
    return { batch, kind: "incomplete", why: `${String(stuck.length)} node_modules could not be renamed aside` };
  }
  return { batch, kind: "moved" };
}

/**
 * Put every moved directory back where it came from — the undo for a removal git refused — and drop the batch.
 *
 * A move that cannot be put back keeps the whole batch pending, so no emptying pass deletes it; the next pass
 * after this process exits tries the rename again.
 *
 * @param batch the batch {@link moveBulkAside} made
 * @returns one message per directory that could not be put back, empty when all were
 */
export function restoreBulk({ batch }: { batch: BulkBatch }): readonly string[] {
  const failures = renameBack({ moves: batch.moves, worktree: batch.worktree });
  if (failures.length === 0) {
    dropBatch({ dir: batch.dir });
  }
  return failures;
}

/**
 * Rename each move back whose directory is still in the batch and whose place in the tree is free.
 *
 * A parent the failed removal already deleted — `packages/x/` under `packages/x/node_modules` — is made again
 * first, inside a worktree that is still there; without it the rename could never succeed and the batch was
 * held pending for good. The worktree root itself is never re-created.
 *
 * @param moves the moves to undo
 * @param worktree the tree they came out of
 * @returns one message per move that could not be undone
 */
export function renameBack({ moves, worktree }: { moves: readonly BulkMove[]; worktree: string }): readonly string[] {
  const failures: string[] = [];
  for (const move of moves) {
    if (!existsSync(move.to) || existsSync(move.from)) {
      continue;
    }
    try {
      if (!existsSync(worktree)) {
        throw new Error(`its worktree ${worktree} is gone`);
      }
      mkdirSync(dirname(move.from), { recursive: true });
      renameSync(move.to, move.from);
    } catch (error: unknown) {
      const why = error instanceof Error ? error.message : "the rename failed";
      failures.push(`${move.from} is held in the pending trash batch ${move.to}, never emptied while pending — ${why}`);
    }
  }
  return failures;
}
