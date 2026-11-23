/**
 * The apply's raw read of every tracked symlink's target, beside `hiddenEditsNow`'s read of every regular file.
 */
import { lstatSync, readlinkSync } from "node:fs";
import { join } from "node:path";

import { type GitRunner, realGit, stagedBlobs } from "./pruneGit.js";

/** The staged mode of a symlink, whose blob is its target string. */
const SYMLINK_MODE = "120000";

/**
 * Every path staged as a symlink, and only as one — what {@link symlinkEditsNow} reads.
 *
 * Pure. A path with any other stage beside a symlink one is a conflict, and a conflicted tree is dirty to
 * `status` already.
 *
 * @param staged each path's staged `<mode> <sha>` strings, from `stagedBlobs`
 * @returns each symlink path with the one blob its target must hash to
 */
export function stagedSymlinks({
  staged,
}: {
  staged: ReadonlyMap<string, readonly string[]>;
}): readonly { file: string; blob: string }[] {
  return [...staged].flatMap(([file, blobs]) => {
    const [only] = blobs;
    if (blobs.length !== 1 || only === undefined || !only.startsWith(`${SYMLINK_MODE} `)) {
      return [];
    }
    return [{ blob: only.slice(SYMLINK_MODE.length + 1), file }];
  });
}

/**
 * How many tracked symlinks point somewhere other than their staged target, read now, or `null` when a read
 * failed.
 *
 * `status` vouches for a symlink by its stat data alone, and the r3 Codex review retargeted one behind stat
 * fields a filesystem reported unchanged: `status` read the tree clean, the regular-file read skipped mode
 * 120000, and the removal deleted the only record of the new target. So the target is read with `readlink`
 * and hashed by `git hash-object --stdin`, which follows nothing and runs no filter. A path that is no longer
 * a symlink is an edit; in a `gutted` tree one that is gone is the interrupted removal's own work.
 *
 * @param path the worktree to read
 * @param git how to run git, so a test can supply a fake
 * @param gutted true when an interrupted removal already deleted part of the tree, so absence is not an edit
 * @returns the retargeted count, or `null` when git or the filesystem could not answer
 */
export function symlinkEditsNow({
  path,
  git = realGit,
  gutted = false,
}: {
  path: string;
  git?: GitRunner;
  gutted?: boolean;
}): number | null {
  const index = git({ args: ["ls-files", "-s", "-z"], cwd: path });
  if (index === null) {
    return null;
  }
  let edited = 0;
  for (const { blob, file } of stagedSymlinks({ staged: stagedBlobs({ listing: index }) })) {
    const verdict = linkEdited({ blob, file, git, gutted, path });
    if (verdict === null) {
      return null;
    }
    edited += verdict ? 1 : 0;
  }
  return edited;
}

/**
 * Whether one tracked symlink is not its staged target now.
 *
 * @param blob the staged blob its target must hash to
 * @param file the path relative to the worktree
 * @param git how to run git
 * @param gutted true when an interrupted removal already deleted part of the tree, so absence is not an edit
 * @param path the worktree root
 * @returns true when it is an edit, false when it matches or is gone from a gutted tree, null when unreadable
 */
function linkEdited({
  blob,
  file,
  git,
  gutted,
  path,
}: {
  blob: string;
  file: string;
  git: GitRunner;
  gutted: boolean;
  path: string;
}): boolean | null {
  const entry = lstatSync(join(path, file), { throwIfNoEntry: false });
  if (entry === undefined) {
    return !gutted;
  }
  if (!entry.isSymbolicLink()) {
    return true;
  }
  const target = targetOf({ link: join(path, file) });
  // A target in bytes that are not UTF-8 decodes to U+FFFD and would hash as some other string.
  if (target === null || target.includes("�")) {
    return null;
  }
  const hashed = git({ args: ["hash-object", "--no-filters", "--stdin"], cwd: path, stdin: target });
  if (hashed === null) {
    return null;
  }
  return hashed.trim() !== blob;
}

/**
 * A symlink's target, or `null` when it could not be read — replaced between the `lstat` and this read.
 *
 * @param link the symlink's absolute path
 * @returns the target string, or null
 */
function targetOf({ link }: { link: string }): string | null {
  try {
    return readlinkSync(link, { encoding: "utf8" });
  } catch {
    return null;
  }
}
