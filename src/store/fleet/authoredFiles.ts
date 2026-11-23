/**
 * Finding every file under the home's `authored` directories — the one walk the import leg and `store
 * authored restore` share, so the two can never disagree about which files are this class.
 *
 * Every entry is judged by its own path (`./authoredDirectories.ts`'s deepest-row rule): a file is listed when
 * it is `authored`, a directory is entered only when some file below it can be, and an entry under a `split`
 * directory with no row of its own is reported as unclassified rather than read. Nothing is followed through a
 * symbolic link: a link is neither a file nor a directory to `withFileTypes`, so a
 * link cycle cannot turn the walk unbounded and a link out of the home cannot pull a foreign tree in.
 */
import { type Dirent, readdirSync } from "node:fs";
import { join } from "node:path";

import { errorMessage } from "#lib/errorMessage.js";
import { stateHomePaths } from "../../stateHome.js";

import { classifyHomePath, isAuthoredHomeFile, isAuthoredPath, mayHoldAuthored } from "./authoredDirectories.js";

/**
 * A path the walk could not read, and why.
 *
 * @internal the shape of {@link AuthoredListing}'s `unreadable`, read through that field and never named
 */
export interface AuthoredUnreadable {
  readonly locator: string;
  readonly why: string;
}

/** What one walk of the home found. */
export interface AuthoredListing {
  /**
   * Every file, absolute: the authored top-level files in name order, then directory by directory with each
   * directory's files in name order.
   */
  readonly files: readonly string[];
  /** The top-level directories the walk entered, in name order. */
  readonly directories: readonly string[];
  /** Every entry under a `split` directory that no row classifies, home-relative — never read. */
  readonly unclassified: readonly string[];
  /** Every directory that exists and would not read. An absent home is a fresh install, not a failure. */
  readonly unreadable: readonly AuthoredUnreadable[];
}

/**
 * Every `authored` file under one home, at whatever depth its row sits, the named top-level files included.
 *
 * @param home the state home
 * @returns the files, the top-level directories entered, every unclassified entry under a `split` directory, and
 *   every directory that would not read
 */
export function listAuthoredFiles({ home }: { home: string }): AuthoredListing {
  const root = stateHomePaths({ home }).root;
  const unreadable: AuthoredUnreadable[] = [];
  let entries: readonly Dirent[];
  try {
    entries = readdirSync(root, { withFileTypes: true });
  } catch (cause) {
    unreadable.push({ locator: root, why: errorMessage({ error: cause }) });
    return { directories: [], files: [], unclassified: [], unreadable };
  }
  const directories = entries
    .filter((entry) => entry.isDirectory() && mayHoldAuthored({ relativePath: entry.name }))
    .map((entry) => entry.name)
    .toSorted((left, right) => left.localeCompare(right));
  const topLevelFiles = entries
    .filter((entry) => entry.isFile() && isAuthoredHomeFile({ name: entry.name }))
    .map((entry) => entry.name)
    .toSorted((left, right) => left.localeCompare(right))
    .map((name) => join(root, name));
  const found: Found = { files: [...topLevelFiles], unclassified: [], unreadable };
  for (const name of directories) {
    walk({ directory: join(root, name), found, relativePath: name });
  }
  return { directories, files: found.files, unclassified: found.unclassified, unreadable };
}

/**
 * Where a stored path lives under one home — the file `store authored-restore` writes.
 *
 * The caller has already checked the path with `authoredDirectoryOf` (`./authoredFile.ts`), which refuses an
 * empty, `.` or `..` segment, so the join cannot leave the home.
 *
 * @param home the state home
 * @param relativePath the stored path, `/`-separated
 * @returns the absolute path
 */
export function authoredAbsolutePath({ home, relativePath }: { home: string; relativePath: string }): string {
  return join(stateHomePaths({ home }).root, ...relativePath.split("/"));
}

/** What the walk has found so far, appended to as it goes. */
interface Found {
  readonly files: string[];
  readonly unclassified: string[];
  readonly unreadable: AuthoredUnreadable[];
}

/**
 * Every authored file at any depth under one directory: its own files in name order, then its subdirectories.
 * An entry no row classifies is reported and skipped — below the top level that only happens under `split`.
 */
function walk({ directory, relativePath, found }: { directory: string; relativePath: string; found: Found }): void {
  let entries: readonly Dirent[];
  try {
    entries = readdirSync(directory, { withFileTypes: true });
  } catch (cause) {
    found.unreadable.push({ locator: directory, why: errorMessage({ error: cause }) });
    return;
  }
  const sorted = entries
    .filter((entry) => entry.isFile() || entry.isDirectory())
    .toSorted((left, right) => left.name.localeCompare(right.name));
  const unclassified = sorted.filter(
    (entry) => classifyHomePath({ relativePath: `${relativePath}/${entry.name}` }) === undefined,
  );
  for (const entry of unclassified) {
    found.unclassified.push(`${relativePath}/${entry.name}`);
  }
  for (const entry of sorted) {
    if (entry.isFile() && isAuthoredPath({ relativePath: `${relativePath}/${entry.name}` })) {
      found.files.push(join(directory, entry.name));
    }
  }
  for (const entry of sorted) {
    const child = `${relativePath}/${entry.name}`;
    if (entry.isDirectory() && mayHoldAuthored({ relativePath: child })) {
      walk({ directory: join(directory, entry.name), found, relativePath: child });
    }
  }
}
