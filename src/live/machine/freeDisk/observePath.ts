/**
 * `machine free-disk`'s one path read: what a path is on this machine, measured with `lstat` and never following
 * a link. A directory's usage counts every file it holds, and only a file that is its own one link counts as
 * freeable — a hardlinked file's blocks stay held through its other name, so removing this one frees nothing.
 */
import { lstatSync, readlinkSync, realpathSync, type Stats } from "node:fs";

import { isNotFoundError } from "#lib/presentFile.js";
import { err, ok, type Result } from "#lib/result.js";

import { walkFiles } from "../../../home/reclaim/scan.js";
import { type FreeDiskError, FreeDiskErrors } from "./errors.js";
import type { EntryKind, LabelledPath, PathObservation, TreeUsage } from "./types.js";

/** `st_blocks` counts 512-byte units on every platform Node reports it. */
const STAT_BLOCK_BYTES = 512;

/** A usage of nothing. */
const NO_USAGE: TreeUsage = { allocatedBytes: 0, freeableBytes: 0, multiLinkFiles: 0, singleLinkFiles: 0 };

/** What `lstat` says one entry is. */
function kindOf({ stats }: { stats: Stats }): EntryKind {
  if (stats.isSymbolicLink()) {
    return "symlink";
  }
  if (stats.isDirectory()) {
    return "directory";
  }
  if (stats.isFile()) {
    return "regular file";
  }
  return "other";
}

/** A directory's usage, walked with `lstat` and following no link; single-link files are the freeable ones. */
function treeUsage({ path }: { path: string }): Result<TreeUsage, FreeDiskError> {
  const walked = walkFiles({ root: path, skip: () => false });
  if (walked.isErr()) {
    return err(FreeDiskErrors.readFailed({ cause: walked.error, path }));
  }
  let allocatedBytes = 0;
  let freeableBytes = 0;
  let singleLinkFiles = 0;
  let multiLinkFiles = 0;
  for (const file of walked.value) {
    allocatedBytes += file.allocatedBytes;
    if (file.links === 1) {
      freeableBytes += file.allocatedBytes;
      singleLinkFiles += 1;
    } else {
      multiLinkFiles += 1;
    }
  }
  return ok({ allocatedBytes, freeableBytes, multiLinkFiles, singleLinkFiles });
}

/** A regular file's own usage: its blocks, freeable only when it is the file's one link. */
function fileUsage({ stats }: { stats: Stats }): TreeUsage {
  const allocatedBytes = stats.blocks * STAT_BLOCK_BYTES;
  if (stats.nlink === 1) {
    return { allocatedBytes, freeableBytes: allocatedBytes, multiLinkFiles: 0, singleLinkFiles: 1 };
  }
  return { allocatedBytes, freeableBytes: 0, multiLinkFiles: 1, singleLinkFiles: 0 };
}

/** Where a path really is: a link's own target, unresolved, or everything else's `realpath`. */
function realLocation({ path, kind }: { path: string; kind: EntryKind }): Result<string, FreeDiskError> {
  try {
    if (kind === "symlink") {
      return ok(readlinkSync(path));
    }
    return ok(realpathSync(path));
  } catch (cause: unknown) {
    return err(FreeDiskErrors.readFailed({ cause, path }));
  }
}

/**
 * Observe one path: absent, or its kind, real location, device and inode, and — when `walk` is set and it is a
 * directory — what its files hold. A link is never followed: it is reported as a link, with no usage.
 *
 * @param walk whether to walk a directory's files (a recheck that only compares identity skips the walk)
 * @returns the observation, or the read that failed
 */
export function observePath({ path, walk }: { path: string; walk: boolean }): Result<PathObservation, FreeDiskError> {
  let stats: Stats;
  try {
    stats = lstatSync(path);
  } catch (cause: unknown) {
    if (isNotFoundError({ error: cause })) {
      return ok({ path, state: "absent" });
    }
    return err(FreeDiskErrors.readFailed({ cause, path }));
  }
  const kind = kindOf({ stats });
  const realPath = realLocation({ kind, path });
  if (realPath.isErr()) {
    return err(realPath.error);
  }
  let usage: TreeUsage = NO_USAGE;
  if (kind === "regular file") {
    usage = fileUsage({ stats });
  }
  if (kind === "directory" && walk) {
    const walked = treeUsage({ path });
    if (walked.isErr()) {
      return err(walked.error);
    }
    usage = walked.value;
  }
  return ok({
    identity: { dev: stats.dev, ino: stats.ino },
    kind,
    path,
    realPath: realPath.value,
    state: "present",
    usage,
  });
}

/**
 * Observe every labelled path in order, stopping on the first read that fails.
 *
 * @param entries each path with the label its plan row carries
 * @param walk whether to walk each directory's files
 * @returns the observations in input order, or the read that failed
 */
export function observeAll({
  entries,
  walk,
}: {
  entries: readonly { label: string; path: string }[];
  walk: boolean;
}): Result<readonly LabelledPath[], FreeDiskError> {
  const observed: LabelledPath[] = [];
  for (const entry of entries) {
    const one = observePath({ path: entry.path, walk });
    if (one.isErr()) {
      return err(one.error);
    }
    observed.push({ label: entry.label, observed: one.value });
  }
  return ok(observed);
}

/**
 * The pids whose executable sits inside a bundle, read from `ps -axo pid=,comm=` (macOS prints `comm` as the
 * executable's full path). Each line is split at its first space after the pid by two plain string checks, so no
 * line a process name controls can make the read backtrack.
 *
 * @param text the `ps` stdout
 * @param bundlePath the bundle's absolute path
 * @returns every pid running from inside it
 */
export function pidsInsideBundle({ text, bundlePath }: { text: string; bundlePath: string }): readonly number[] {
  const prefix = `${bundlePath}/`;
  const pids: number[] = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trimStart();
    const gap = trimmed.indexOf(" ");
    if (gap <= 0) {
      continue;
    }
    const pid = trimmed.slice(0, gap);
    const command = trimmed.slice(gap).trimStart();
    if (/^\d+$/u.test(pid) && command.startsWith(prefix)) {
      pids.push(Number(pid));
    }
  }
  return pids;
}
