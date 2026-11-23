/**
 * A pool of reusable snapshot worktrees per repository, so a pass writes only what changed since the last one.
 *
 * ## The problem this replaces
 *
 * {@link createTreeSnapshot} checks the whole tree out into a fresh worktree and deletes it after the pass. On
 * this repository that is about 13k files written and unlinked per pass, and the fleet ran about 87 plan passes
 * an hour — while two
 * consecutive snapshots of one repository usually differ by a handful of files. Repro for the file count:
 *
 *   git ls-files | wc -l
 *
 * So each repository keeps up to `SNAPSHOT_POOL_SLOTS` registered worktrees under the OS temp dir, and a
 * pass leases one and moves it to its snapshot commit with `reset --hard` + `clean -ffdx`, which rewrites only
 * the paths that differ. When every slot is leased, or anything here fails, {@link freezeForPass} falls back to
 * a fresh {@link createTreeSnapshot} exactly as before.
 *
 * Which process may move a slot is the lease, `./snapshotLease.ts`. How a held slot is moved, and what a
 * reused slot does and does not promise against a fresh checkout, is `./snapshotSync.ts`.
 *
 * ## Why every operational worktree reader omits the slots
 *
 * They stay registered between passes. `../worktree/snapshotPoolPath.ts` has the reason and the predicate.
 */
import { randomUUID } from "node:crypto";
import {
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { IngestError } from "../lib/ingestError.js";
import type { Result } from "../lib/result.js";
import { safeFs } from "../lib/safeBoundary.js";
import { SNAPSHOT_POOL_IDENTITY_FILE, snapshotPoolRoot } from "../worktree/snapshotPoolPath.js";
import { runGitChecked } from "./gitRun.js";
import { createTreeSnapshot, snapshotCommit, snapshotGitPrefix, type TreeSnapshot } from "./snapshot.js";
import { checkoutFingerprint } from "./snapshotCheckout.js";
import { claimSlot, isErrno, releaseHeldSlot } from "./snapshotLease.js";
import { refuseUnpoolableTree, syncHeldSlot } from "./snapshotSync.js";

/**
 * Lease a pooled slot and move it to a frozen copy of the tree as it stands — the same commit and content tree
 * {@link createTreeSnapshot} would produce, written as a diff against whatever the slot held last.
 *
 * @param repoRoot the repository to snapshot
 * @param poolParent directory the pool lives under — defaults to the OS temp dir; a test passes its own root
 * @returns the snapshot, whose `release` returns the lease and keeps the tree; or a typed io error when every
 *   slot is leased or git refused, so the caller can fall back to a fresh snapshot
 */
export function acquirePooledSnapshot({
  repoRoot,
  poolParent = tmpdir(),
}: {
  repoRoot: string;
  poolParent?: string;
}): Result<TreeSnapshot, IngestError> {
  return safeFs({
    execute: (): TreeSnapshot => {
      const { commonGitDir, poolRoot } = ownPoolRoot({ poolParent, repoRoot });
      const held = claimSlot({ poolRoot });
      let frozen: { readonly commit: string; readonly contentTree: string };
      let checkout: string;
      try {
        frozen = freezeCommit({ poolParent, repoRoot });
        refuseUnpoolableTree({ commit: frozen.commit, commonGitDir, repoRoot, staging: held.slot });
        checkout = checkoutFingerprint({ commonGitDir, off: snapshotGitPrefix({ staging: held.slot }), repoRoot });
      } catch (error) {
        // Nothing touched the slot yet, so it goes back to the pool as it was.
        releaseHeldSlot({ held });
        throw error;
      }
      syncHeldSlot({ checkout, commit: frozen.commit, commonGitDir, held, poolRoot, repoRoot });
      let released = false;
      return {
        commit: frozen.commit,
        contentTree: frozen.contentTree,
        path: held.tree,
        release: () => {
          if (released) {
            return;
          }
          released = true;
          releaseHeldSlot({ held });
        },
      };
    },
    operation: "codex.acquirePooledSnapshot",
    path: repoRoot,
  });
}

/**
 * Freeze the tree for one pass, or `undefined` to read the live repository: a pooled slot first, a fresh
 * throwaway snapshot when every slot is leased or the pool cannot serve, the live tree last.
 *
 * Degrading rather than failing is the point. A snapshot is an improvement to how a pass reads, not a
 * precondition for reading: refusing to run because a worktree could not be created would trade a real
 * second opinion for a guarantee about how it was obtained. When it is unavailable the pass reads the live
 * tree exactly as it did before, and `codex status` can still detect the staleness that may result — which
 * is why detection was built first.
 *
 * @param repoRoot the repository to freeze
 * @returns the frozen copy, or undefined when no snapshot could be made
 */
export function freezeForPass({ repoRoot }: { repoRoot: string }): TreeSnapshot | undefined {
  const pooled = acquirePooledSnapshot({ repoRoot });
  if (pooled.isOk()) {
    return pooled.value;
  }
  const fresh = createTreeSnapshot({ repoRoot });
  return fresh.isOk() ? fresh.value : undefined;
}

/**
 * The repository's pool directory, created owner-only, with its identity file established or verified.
 *
 * Keyed by the COMMON git dir, so every linked worktree of one repository leases from one pool.
 */
function ownPoolRoot({ poolParent, repoRoot }: { poolParent: string; repoRoot: string }): {
  readonly commonGitDir: string;
  readonly poolRoot: string;
} {
  const commonGitDir = realpathSync(
    runGitChecked({
      args: ["rev-parse", "--path-format=absolute", "--git-common-dir"],
      cwd: repoRoot,
      label: "git rev-parse --git-common-dir",
    }).trim(),
  );
  const poolRoot = snapshotPoolRoot({ commonGitDir, poolParent });
  mkdirSync(poolRoot, { mode: 0o700, recursive: true });
  const identity = join(poolRoot, SNAPSHOT_POOL_IDENTITY_FILE);
  if (!existsSync(identity)) {
    // Written aside and LINKED into place: `link` creates the name only if it is absent, so a reader never
    // sees a half-written identity, and two first callers cannot both write one.
    const pending = join(poolRoot, `.identity-${randomUUID()}`);
    writeFileSync(pending, commonGitDir, { mode: 0o600 });
    try {
      linkSync(pending, identity);
    } catch (error) {
      if (!isErrno({ codes: ["EEXIST"], error })) {
        throw error;
      }
    } finally {
      rmSync(pending, { force: true });
    }
  }
  const recorded = readFileSync(identity, "utf8");
  if (recorded !== commonGitDir) {
    throw new Error(`snapshot pool ${poolRoot} belongs to ${recorded}, not ${commonGitDir}`);
  }
  return { commonGitDir, poolRoot };
}

/** The commit and content tree to freeze, through a scratch index that lives only as long as this call. */
function freezeCommit({ poolParent, repoRoot }: { poolParent: string; repoRoot: string }): {
  readonly commit: string;
  readonly contentTree: string;
} {
  const staging = mkdtempSync(join(poolParent, "slopweaver-snap-index-"));
  try {
    return snapshotCommit({ indexFile: join(staging, "index"), repoRoot });
  } finally {
    rmSync(staging, { force: true, recursive: true });
  }
}
