/**
 * The effectful half: walk a declared root and remove the trees the pure rule chose.
 *
 * Three constructions that are the safety argument rather than implementation detail:
 *
 * **`lstat`, never `stat`.** A symlink is recorded as a symlink and never followed, so no walk of a
 * declared root can arrive outside it and no file a root only points at is ever reached.
 *
 * **`st_nlink` is carried into the report.** `../../worktree/execInodes.ts` hardlinks native binaries into
 * the cache root's `exec-store` (the home's own, for a checkout privatised before it moved there), so a file
 * under a scratch root may share its inode with a checkout
 * elsewhere on the machine. Removing that path is safe — it drops one link — but it frees nothing, and a
 * reclaimed-bytes figure that counted it would be a fabrication. `./run.ts` counts only `links === 1`.
 *
 * **Removal is by PATH, inside one declared root, one entry at a time.** Never by inode and never by
 * content identity across roots: an unlink chosen by inode would reach every other checkout linked to it.
 */

import { type Dirent, lstatSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";

import { isNotFoundError } from "#lib/presentFile.js";
import { err, ok, type Result } from "#lib/result.js";
import { safeFs } from "#lib/safeBoundary.js";

import { type HomeReclaimError, HomeReclaimErrors } from "./errors.js";

/** One regular file the walk found. */
export interface FoundFile {
  readonly relativePath: string;
  /** Logical length, `st_size`. */
  readonly bytes: number;
  /**
   * Storage the file actually holds, `st_blocks × 512` — what removing its last link frees. A sparse file's
   * logical length can be any size over one allocated block, so a freed figure built on `bytes` would claim
   * storage that never existed.
   */
  readonly allocatedBytes: number;
  readonly links: number;
}

/** `st_blocks` counts 512-byte units on every platform Node reports it, whatever the filesystem block size. */
const STAT_BLOCK_BYTES = 512;

/** What one directory entry turned out to be, once the symlink and non-file cases are out of the way. */
type EntryVerdict =
  | { readonly kind: "descend"; readonly relativePath: string }
  | { readonly kind: "file"; readonly file: FoundFile }
  | { readonly kind: "ignore" }
  | { readonly kind: "unmeasured"; readonly error: HomeReclaimError };

/**
 * Decide what one directory entry is, taking its `lstat` when it turns out to be a regular file.
 *
 * A symlink is `ignore` before anything else, so no walk of a declared root can arrive outside it. An
 * `lstat` that fails with ENOENT is `ignore` too: a file that vanished between the `readdir` and the `lstat`
 * is an ordinary race during a live walk, not a reason to abandon 582,000 others. Any OTHER failure is
 * `unmeasured` and stops the walk: a file listed in a directory its owner cannot search (`0400`) still
 * exists, and dropping it would let the witness report "held" over a file it never saw.
 *
 * @param entry the directory entry
 * @param root the absolute walk root
 * @param relativePath the entry's path below that root
 * @returns which of the four this entry is
 */
function classifyEntry({
  entry,
  root,
  relativePath,
}: {
  entry: Dirent;
  root: string;
  relativePath: string;
}): EntryVerdict {
  if (entry.isSymbolicLink()) {
    return { kind: "ignore" };
  }
  if (entry.isDirectory()) {
    return { kind: "descend", relativePath };
  }
  if (!entry.isFile()) {
    return { kind: "ignore" };
  }
  const stats = safeFs({
    execute: () => lstatSync(join(root, relativePath)),
    operation: "home.reclaim.lstat",
    path: relativePath,
  });
  if (stats.isErr()) {
    if (isNotFoundError({ error: stats.error.cause })) {
      return { kind: "ignore" };
    }
    return {
      error: HomeReclaimErrors.scanFailed({ cause: stats.error.cause, path: join(root, relativePath) }),
      kind: "unmeasured",
    };
  }
  return {
    file: {
      allocatedBytes: stats.value.blocks * STAT_BLOCK_BYTES,
      bytes: stats.value.size,
      links: stats.value.nlink,
      relativePath,
    },
    kind: "file",
  };
}

/**
 * Read one directory's entries.
 *
 * @param absolute the directory to read
 * @returns its entries, or the typed io failure
 */
function readEntries({ absolute }: { absolute: string }): Result<readonly Dirent[], HomeReclaimError> {
  const entries = safeFs({
    execute: () => readdirSync(absolute, { withFileTypes: true }),
    operation: "home.reclaim.readdir",
    path: absolute,
  });
  if (entries.isErr()) {
    return err(HomeReclaimErrors.scanFailed({ cause: entries.error.cause, path: absolute }));
  }
  return ok(entries.value);
}

/**
 * Read one directory and split its entries into the files found and the directories still to walk.
 *
 * @param root the absolute walk root
 * @param current the directory's path below that root, empty at the root itself
 * @param skip a directory the walk must not descend into, by its path below the root
 * @returns what was found here and what is left to enter, or the io failure that stopped the read
 */
function stepInto({
  root,
  current,
  skip,
}: {
  root: string;
  current: string;
  skip: (input: { relativePath: string }) => boolean;
}): Result<{ readonly files: readonly FoundFile[]; readonly descend: readonly string[] }, HomeReclaimError> {
  const entries = readEntries({ absolute: current === "" ? root : join(root, current) });
  if (entries.isErr()) {
    return err(entries.error);
  }
  const verdicts = entries.value.map((entry) =>
    classifyEntry({ entry, relativePath: current === "" ? entry.name : `${current}/${entry.name}`, root }),
  );
  const unmeasured = verdicts.find((verdict) => verdict.kind === "unmeasured");
  if (unmeasured !== undefined) {
    return err(unmeasured.error);
  }
  return ok({
    descend: verdicts
      .filter((verdict) => verdict.kind === "descend")
      .map((verdict) => verdict.relativePath)
      .filter((relativePath) => !skip({ relativePath })),
    files: verdicts.filter((verdict) => verdict.kind === "file").map((verdict) => verdict.file),
  });
}

/**
 * List every regular file below a root, depth first, following no symlink.
 *
 * @param root the absolute directory to walk
 * @param skip a directory the walk must not descend into, by its path below the root
 * @returns every regular file, or the io failure that stopped the walk
 */
export function walkFiles({
  root,
  skip,
}: {
  root: string;
  skip: (input: { relativePath: string }) => boolean;
}): Result<readonly FoundFile[], HomeReclaimError> {
  const found: FoundFile[] = [];
  const stack: string[] = [""];
  while (stack.length > 0) {
    const current = stack.pop();
    if (current === undefined) {
      break;
    }
    const step = stepInto({ current, root, skip });
    if (step.isErr()) {
      return err(step.error);
    }
    for (const file of step.value.files) {
      found.push(file);
    }
    for (const relativePath of step.value.descend) {
      stack.push(relativePath);
    }
  }
  return ok(found);
}

/**
 * Remove one path below a declared root.
 *
 * `force: false`, so a permission failure or a busy directory is reported rather than swallowed. The ONE
 * thing that is not a failure is the path already being gone, and that is not a hypothetical: the home is
 * live while this runs, and MEASURED on the first real lap over `supervisor-scratch`,
 * `handoff-<n>/run.json.new` — the temp file an atomic write renames away — disappeared between the walk
 * and its own removal and aborted the whole run. A removal whose target is absent has reached its goal, so
 * it is reported as done. The witness is what makes that safe: it re-stats every path the walk KEPT
 * afterwards, so a keeper that vanished the same way still reddens the run.
 *
 * @param root the absolute declared root — the removal can never reach outside it
 * @param relativePath the entry to remove, `/`-separated
 * @returns nothing on success, or the typed failure
 */
export function removeEntry({
  root,
  relativePath,
}: {
  root: string;
  relativePath: string;
}): Result<true, HomeReclaimError> {
  const absolute = join(root, relativePath);
  const removal = safeFs({
    execute: () => {
      rmSync(absolute, { force: false, recursive: true });
      return true as const;
    },
    operation: "home.reclaim.remove",
    path: relativePath,
  });
  if (removal.isErr() && !isGone({ path: absolute })) {
    return err(HomeReclaimErrors.applyFailed({ cause: removal.error.cause, path: relativePath }));
  }
  return ok(true);
}

/**
 * Whether a path is provably absent: its `lstat` fails with ENOENT. Any other failure — an EACCES from a
 * parent the walk can no longer search, or an ACL denying `readattr` — leaves the path's existence unknown,
 * and reading that as "gone" let a failed removal journal its bytes as freed.
 *
 * @param path the absolute path
 * @returns true only when the path is known not to exist
 */
function isGone({ path }: { path: string }): boolean {
  const stats = safeFs({ execute: () => lstatSync(path), operation: "home.reclaim.gone", path });
  return stats.isErr() && isNotFoundError({ error: stats.error.cause });
}

/**
 * Whether a path still exists, for the post-apply witness.
 *
 * @param path the absolute path
 * @returns whether `lstat` finds it
 */
export function stillExists({ path }: { path: string }): boolean {
  return safeFs({
    execute: () => lstatSync(path),
    operation: "home.reclaim.witness",
    path,
  }).isOk();
}
