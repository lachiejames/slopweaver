/**
 * What a removal actually left: judged from the directory afterwards, never from git's exit code alone.
 *
 * Owner: when a tree is pruned the whole tree goes, its `.git` included, and a removal that cannot
 * finish is reported as a failure, never as a success. That day's removal had left a directory git called
 * "Directory not empty", and it was reported as a tree git declined.
 *
 * **Why a refusal is not evidence the tree is untouched.** When `git worktree remove` fails to delete the
 * working tree, it carries on and deletes the tree's admin directory anyway (`remove_worktree` in git's
 * `builtin/worktree.c`: "continue on even if ret is non-zero, there's no going back"). The directory is left
 * UNREGISTERED, and its `.git` file points at nothing. Every later scan lists registered trees only, so nothing
 * would ever look at it again. A process writing into the tree mid-removal, or a file git may not unlink, is
 * enough to cause it.
 *
 * **`status` is asked only where it reads THIS tree.** In a directory whose `.git` is gone, or whose
 * registration is, git walks up to whatever repository encloses it. For an acme-admin worktree under
 * `.claude/worktrees.noindex/` that is the main checkout, whose status says nothing about this tree.
 *
 * An unregistered residue is finished here when every file left in it is build output that the next install
 * writes again, because this is the last code that will ever know it is there. Anything else in it is left
 * where it is, and the removal is reported FAILED with the path.
 */
import { existsSync, readdirSync, realpathSync } from "node:fs";
import { join } from "node:path";

import { isReproducibleOutput } from "./pruneContext.js";
import { realGit, workingTreeStatus } from "./pruneGit.js";
import { deleteGently } from "./prunePacing.js";
import { listRepoWorktrees } from "./pruneScan.js";

/** What the directory looks like once git has answered. */
export interface AfterRemoval {
  readonly exists: boolean;
  /** Whether a `.git` file or folder is still at the tree's root. */
  readonly gitEntry: boolean;
  /** Whether git still registers the path, or `null` when the list could not be read. */
  readonly registered: boolean | null;
  /** `status --porcelain`, read only for a registered tree whose `.git` is present; `null` otherwise. */
  readonly status: string | null;
}

/** How one removal ended. */
export type RemovalJudgement =
  | { readonly kind: "declined"; readonly why: string }
  | { readonly kind: "failed"; readonly why: string }
  | { readonly kind: "removed" };

/**
 * How many tracked files a removal already deleted, from a porcelain status.
 *
 * @param status `status --porcelain` output
 * @returns the number of entries deleted from the working tree
 */
function deletedCount({ status }: { status: string }): number {
  return status.split("\n").filter((line) => line.charAt(1) === "D").length;
}

/**
 * Judge one removal from what it left.
 *
 * A path that is gone is removed, whatever git said. A refusal is a decline only when git demonstrably stopped
 * before deleting anything: the tree is still registered, its `.git` is there, and its status is readable with no
 * deleted file. Everything else is FAILED, including a zero exit over a directory that is still there.
 *
 * @param refusal git's refusal, or `null` when it exited 0
 * @param after what the directory looks like now
 * @returns removed, declined with git's words, or failed with what is wrong
 */
export function judgeRemoval({ refusal, after }: { refusal: string | null; after: AfterRemoval }): RemovalJudgement {
  if (!after.exists) {
    return { kind: "removed" };
  }
  if (refusal === null) {
    return { kind: "failed", why: "git reported the tree removed, but its directory is still there" };
  }
  if (after.registered === false) {
    return { kind: "failed", why: `${refusal} — git has already dropped the registration, so no later scan sees it` };
  }
  if (after.registered === null) {
    return { kind: "failed", why: `${refusal} — whether git still registers the tree could not be read` };
  }
  if (!after.gitEntry) {
    return { kind: "failed", why: `${refusal} — its .git is gone, so git cannot read what is left` };
  }
  if (after.status === null) {
    return { kind: "failed", why: `${refusal} — its status could not be read, so nothing says what is left` };
  }
  const deleted = deletedCount({ status: after.status });
  if (deleted > 0) {
    return {
      kind: "failed",
      why: `${refusal} — ${String(deleted)} tracked file(s) already deleted, PARTIALLY REMOVED`,
    };
  }
  return { kind: "declined", why: refusal };
}

/**
 * A path with its symlinks resolved, or the path itself when it went between the check and the read.
 *
 * @param path the path to resolve
 * @returns the resolved path
 */
function resolvedPath({ path }: { path: string }): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

/**
 * Read what a removal left at a tree's path.
 *
 * @param path the tree git was asked to remove
 * @param repoRoot the repository it belonged to
 * @returns the directory's state, for {@link judgeRemoval}
 */
export function readAfterRemoval({ path, repoRoot }: { path: string; repoRoot: string }): AfterRemoval {
  if (!existsSync(path)) {
    return { exists: false, gitEntry: false, registered: null, status: null };
  }
  const gitEntry = existsSync(join(path, ".git"));
  const listed = listRepoWorktrees({ repoRoot });
  // git lists a tree by its resolved path, so a path reached through a symlink (macOS's `/var`) is matched on both.
  const resolved = resolvedPath({ path });
  const registered =
    listed === null ? null : listed.some((worktree) => worktree.path === path || worktree.path === resolved);
  const status = gitEntry && registered === true ? workingTreeStatus({ git: realGit, path }) : null;
  return { exists: true, gitEntry, registered, status };
}

/** Past this many entries a residue is a tree git barely started on, and a human looks at it. */
const RESIDUE_ENTRY_CAP = 10_000;

/** How long finishing one residue may take at background priority; a cut-short one is finished next run. */
const RESIDUE_TIMEOUT_MS = 5 * 60_000;

/** One directory of a residue, split into what is listed and what is still to be entered. */
interface ResidueLevel {
  readonly listed: readonly string[];
  readonly toEnter: readonly string[];
}

/**
 * Read one directory of a residue: a file or a reproducible directory is listed, any other directory is entered.
 *
 * @param path the residue's root
 * @param rel the directory to read, from the root, `""` for the root itself
 * @returns that directory's entries, split
 */
function residueLevel({ path, rel }: { path: string; rel: string }): ResidueLevel {
  const listed: string[] = [];
  const toEnter: string[] = [];
  for (const dirent of readdirSync(join(path, rel), { withFileTypes: true })) {
    const entry = rel === "" ? dirent.name : `${rel}/${dirent.name}`;
    if (!dirent.isDirectory()) {
      listed.push(entry);
    } else if (isReproducibleOutput({ entry: `${entry}/` })) {
      listed.push(`${entry}/`);
    } else {
      toEnter.push(entry);
    }
  }
  return { listed, toEnter };
}

/**
 * Every file left under a residue, from its root, with a reproducible directory listed whole and not entered.
 *
 * @param path the residue's root
 * @returns the entries, or `null` when one could not be read or there are more than the cap
 * @internal
 */
export function residueOf({ path }: { path: string }): readonly string[] | null {
  const entries: string[] = [];
  const pending = [""];
  let visited = 0;
  try {
    for (let rel = pending.pop(); rel !== undefined; rel = pending.pop()) {
      const level = residueLevel({ path, rel });
      visited += level.listed.length + level.toEnter.length;
      if (visited > RESIDUE_ENTRY_CAP) {
        return null;
      }
      for (const entry of level.listed) {
        entries.push(entry);
      }
      for (const dir of level.toEnter) {
        pending.push(dir);
      }
    }
  } catch {
    return null;
  }
  return entries;
}

/**
 * Finish an UNREGISTERED residue when everything left in it is build output or its dangling `.git`.
 *
 * @param path the residue's root
 * @param deleteTree removes the residue within a timeout and says whether it is gone; the governed
 *   {@link deleteGently}, which reads the machine's live fseventsd, unless a test passes its own
 * @returns `null` once the path is gone, or why it was left
 */
export function finishResidue({
  path,
  deleteTree = deleteGently,
}: {
  path: string;
  deleteTree?: (input: { dir: string; timeoutMs: number }) => boolean;
}): string | null {
  const residue = residueOf({ path });
  if (residue === null) {
    return `what is left in it could not be listed, or is more than ${String(RESIDUE_ENTRY_CAP)} entries — left for a human`;
  }
  const kept = residue.filter((entry) => entry !== ".git" && !isReproducibleOutput({ entry }));
  if (kept.length > 0) {
    return `${String(kept.length)} file(s) left in it are not build output, such as ${kept[0]!} — left for a human`;
  }
  // At background priority, like every bulk delete a prune makes: build output such as `.next` runs to many
  // thousands of files (`./prunePacing.ts`).
  return deleteTree({ dir: path, timeoutMs: RESIDUE_TIMEOUT_MS })
    ? null
    : `its leftover build output could not be deleted within ${String(RESIDUE_TIMEOUT_MS / 60_000)} minutes`;
}
