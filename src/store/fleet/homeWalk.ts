/**
 * The one recursive walk the fleet import legs share over a root under the state home.
 *
 * Two legs read whole trees of files rather than a ledger: `owner-turns` (`./ownerTurnFiles.ts`) and
 * `measurements` (`./measurementFiles.ts`). Each passes the filenames it wants; the walk decides everything
 * else once — depth-first order, symbolic links never followed, and an absent root that is simply a fresh
 * install rather than a failure — so the two legs can never disagree about how a tree is read.
 */
import { type Dirent, readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";

import { errorMessage } from "#lib/errorMessage.js";
import { isRecord } from "#lib/parsers.js";

/** A path the walk could not read, and why. */
interface HomeWalkUnreadable {
  readonly locator: string;
  readonly why: string;
}

/** What one walk of one root found. */
export interface HomeFileListing {
  /** Every accepted file, absolute, directory by directory with each directory's files in name order. */
  readonly files: readonly string[];
  /** Every directory that exists and would not read — never an absent root, which is a fresh install. */
  readonly unreadable: readonly HomeWalkUnreadable[];
  /**
   * Every symbolic link with an accepted name, absolute. Never followed and never in `files`; listed so a leg
   * that must account for every file it was asked for can name each one rather than miss it silently.
   */
  readonly links: readonly string[];
}

/**
 * Every accepted file under one root, at any depth.
 *
 * @param root the directory to walk
 * @param accept whether a file with this bare name belongs to the listing
 * @returns the files found and every directory that would not read
 */
export function listFilesUnder({
  root,
  accept,
}: {
  root: string;
  accept: (fileName: string) => boolean;
}): HomeFileListing {
  const unreadable: HomeWalkUnreadable[] = [];
  const files: string[] = [];
  const links: string[] = [];
  walkFiles({ accept, directory: root, files, isRoot: true, links, unreadable });
  return { files, links, unreadable };
}

/**
 * A file's path relative to the home, `/`-separated — the form every location table stores.
 *
 * @param home the state home the file was found under
 * @param path the file's absolute path
 * @returns the home-relative path
 */
export function homeRelativePath({ home, path }: { home: string; path: string }): string {
  return relative(home, path).split(sep).join("/");
}

/**
 * Every accepted file at any depth under one directory, depth first, each directory's own files in name order
 * before its subdirectories in name order.
 *
 * Symbolic links are never followed — a link is neither a file nor a directory to `withFileTypes` — so a
 * link cycle under a scratch tier cannot turn this into an unbounded walk.
 */
function walkFiles({
  directory,
  accept,
  files,
  links,
  unreadable,
  isRoot,
}: {
  directory: string;
  accept: (fileName: string) => boolean;
  files: string[];
  links: string[];
  unreadable: HomeWalkUnreadable[];
  isRoot: boolean;
}): void {
  const entries = readEntries({ directory, isRoot, unreadable });
  if (entries === undefined) {
    return;
  }
  const sorted = entries.toSorted((left, right) => left.name.localeCompare(right.name));
  for (const entry of sorted) {
    if (entry.isFile() && accept(entry.name)) {
      files.push(join(directory, entry.name));
    }
    if (entry.isSymbolicLink() && accept(entry.name)) {
      links.push(join(directory, entry.name));
    }
  }
  for (const entry of sorted) {
    if (entry.isDirectory()) {
      walkFiles({ accept, directory: join(directory, entry.name), files, isRoot: false, links, unreadable });
    }
  }
}

/**
 * One directory's entries, recording it as unreadable when it would not read.
 *
 * A root that does not exist is the ordinary state of a fresh install and is not reported; anything else is a
 * real failure a reader has to see.
 */
function readEntries({
  directory,
  isRoot,
  unreadable,
}: {
  directory: string;
  isRoot: boolean;
  unreadable: HomeWalkUnreadable[];
}): readonly Dirent[] | undefined {
  try {
    return readdirSync(directory, { withFileTypes: true });
  } catch (cause) {
    if (!(isRoot && isMissing({ error: cause }))) {
      unreadable.push({ locator: directory, why: errorMessage({ error: cause }) });
    }
    return undefined;
  }
}

/** Whether a caught filesystem error is "it is not there", which is not a failure to report. */
function isMissing({ error }: { error: unknown }): boolean {
  return isRecord(error) && error["code"] === "ENOENT";
}
