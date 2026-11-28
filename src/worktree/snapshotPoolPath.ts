/**
 * Where the Codex snapshot pool lives, and how a worktree reader recognises one of its slots.
 *
 * A Codex plan pass reads a frozen copy of the tree (`../codex/snapshot.ts`). It used to check the whole tree
 * out into a fresh worktree and delete it afterwards — about 13k files written and unlinked per pass, for a
 * pass that mostly differs from the last one by a handful of files. The pool (`../codex/snapshotPool.ts`) keeps
 * a few registered worktrees per repository and moves each one to the next snapshot with `reset --hard`, which
 * writes only what changed.
 *
 * Those slots are INFRASTRUCTURE, not somebody's work, and they stay registered between passes. So every
 * operational worktree reader — cmux's planners, `worktree list`/`remove`, the machine's registration count and
 * `worktree prune` — omits them through {@link isSnapshotPoolSlot}. Prune is the one that matters: a slot's
 * HEAD is an unreachable snapshot commit, which prune holds for a week and then SALVAGES, pushing a commit
 * nobody wrote and deleting a tree a pass may be reading. The one pool that IS removed, a description review's
 * one-shot packet pool, goes through `codex review` itself, under every slot's lease (`../codex/snapshotPoolReclaim.ts`).
 *
 * Kept in `worktree/` rather than `codex/` so a low-level reader does not import orchestration to ask.
 */
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

/** The directory under the OS temp dir that holds every repository's pool. */
export const SNAPSHOT_POOL_DIR = "slopweaver-snap-pool";

/**
 * How many slots one repository's pool may hold. A pass that finds all of them leased falls back to a fresh
 * throwaway snapshot, so this caps the steady-state disk cost rather than concurrency.
 */
export const SNAPSHOT_POOL_SLOTS = 8;

/** The pool-level file naming the full common git dir, so a truncated-hash collision cannot share slots. */
export const SNAPSHOT_POOL_IDENTITY_FILE = "common-dir";

/** Every slot marker's prefix: `state.free`, or `state.busy.<pid>.<uuid>`. */
export const SNAPSHOT_SLOT_MARKER_PREFIX = "state.";

/**
 * The reserved shape: `<anything>/slopweaver-snap-pool/<16 hex>/slot-<n>/tree`, capturing the key and index. The
 * index is written as the lease writes it — no leading zero — since `slot-00` is a name the pool never leases.
 */
const POOL_TREE = new RegExp(`/${SNAPSHOT_POOL_DIR}/([0-9a-f]{16})/slot-(0|[1-9]\\d*)/tree/?$`);

/** Exactly the markers the lease writes (`../codex/snapshotLease.ts`), its lease id a `randomUUID()`. */
const SLOT_MARKER =
  /^state\.(?:free|busy\.\d+\.[0-9a-f]{12}\.[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;

/**
 * One repository's pool directory, keyed by its COMMON git dir so every linked worktree of a repository shares
 * one pool — the fleet's sessions each sit in their own worktree of the same repository.
 *
 * @param poolParent the directory the pool tree is minted under — the OS temp dir in production
 * @param commonGitDir the canonical (real) path of the repository's common git directory
 * @returns the pool directory for that repository
 */
export function snapshotPoolRoot({ poolParent, commonGitDir }: { poolParent: string; commonGitDir: string }): string {
  return join(poolParent, SNAPSHOT_POOL_DIR, poolKey({ commonGitDir }));
}

/** The 16-hex key naming one repository's pool directory. */
function poolKey({ commonGitDir }: { commonGitDir: string }): string {
  return createHash("sha256").update(commonGitDir).digest("hex").slice(0, 16);
}

/**
 * Whether a worktree path has the reserved shape of a snapshot-pool slot's tree. Lexical and exact — the cheap
 * first half of {@link isSnapshotPoolSlot}.
 *
 * @param path a worktree path as git reports it
 * @returns true when the path has a slot tree's shape
 */
export function isSnapshotPoolTree({ path }: { path: string }): boolean {
  return POOL_TREE.test(path);
}

/**
 * Whether a worktree path IS a Codex snapshot-pool slot: the reserved shape with an index under the cap, in a
 * slot directory holding exactly one lease marker, under a pool root whose identity file names a common git dir
 * that hashes to that root's own key. The shape alone would hide an ordinary worktree somebody placed at a
 * pool-shaped path, and loose file checks would hide one beside a stray `state.*` file; what
 * is checked here is what the pool writes, consistent with itself.
 *
 * @param path a worktree path as git reports it
 * @returns true only for a slot the pool minted
 */
export function isSnapshotPoolSlot({ path }: { path: string }): boolean {
  const match = POOL_TREE.exec(path);
  if (match === null || Number(match[2]) >= SNAPSHOT_POOL_SLOTS) {
    return false;
  }
  const slot = dirname(path.replace(/\/$/, ""));
  try {
    const markers = readdirSync(slot).filter((entry) => entry.startsWith(SNAPSHOT_SLOT_MARKER_PREFIX));
    if (markers.length !== 1 || !SLOT_MARKER.test(markers[0]!)) {
      return false;
    }
    const identity = join(dirname(slot), SNAPSHOT_POOL_IDENTITY_FILE);
    return existsSync(identity) && poolKey({ commonGitDir: readFileSync(identity, "utf8") }) === match[1];
  } catch {
    // An unreadable slot directory is no slot of ours to hide, so the worktree stays visible.
    return false;
  }
}
