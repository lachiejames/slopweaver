/**
 * The source listing remembered against the git index it was read from, so the staleness guard does not spawn
 * `git ls-files` on every invocation of a built CLI.
 *
 * ## Why this is exact, not an approximation
 *
 * `git ls-files` prints what the INDEX holds and reads nothing else. Git never edits an index in place: every
 * write goes to `index.lock` and is renamed over it, so a changed index is a different inode with a new mtime.
 * A listing recorded beside the identity (device, inode, size, change times to the nanosecond) of the index it
 * came from is therefore the listing git would print for as long as that identity stands, and the moment it
 * changes the cache is not consulted. The per-file stamps the guard compares are still taken fresh, every run —
 * only the list of WHICH files is remembered, and it is git's raw output for the argv and the `GIT_*` environment named
 * in the key, so a later filter over it can never be answered by an older one's result, nor a pathspec git matched
 * under one setting (`GIT_ICASE_PATHSPECS`) by the listing it printed under another.
 *
 * Every arm that cannot prove the identity reads git: a checkout whose `.git` is neither a directory nor a
 * `gitdir:` file, an environment naming another index or repository (`GIT_INDEX_FILE`, `GIT_DIR` — git would read
 * that one instead), an unreadable or malformed cache file, or an index that changed while git was listing it.
 *
 * WHICH git, and its CONFIG, are outside the key, on purpose: config lives in up
 * to four files, two of them outside the checkout, and `PATH` differs between the shells, hooks and console routes that
 * all share this one cache file, so keying on it would trade the spawn back for nothing. Both counterexamples found —
 * a repository format version git refuses to read, a fake `git` first on `PATH` — change what every git verb in the
 * checkout does, not this listing; so does a third, a split index's `sharedindex.*` deleted by hand, since every
 * write git makes to a split index rewrites `index` too. Each is caught by the next index write; `rm` the cache file beside the index to
 * drop it sooner.
 *
 * MEASURED at load 23 on 15 cores: the listing spawn was 468ms of a 1,233ms `hand list --json`, the
 * verb itself 43ms — every console tile pays it. Repro:
 * `SLOPWEAVER_LAUNCHER_QUIET=1 node --cpu-prof dist-cli/cli/index.js hand list --json`, then read
 * `sourceFiles`'s inclusive time.
 */
import { readFileSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";

import { writeFileAtomic } from "../lib/writeAtomic.js";

/** The cache's filename, written in the repository's own git directory beside the index it describes. */
export const LISTING_CACHE_FILE = "slopweaver-source-listing.json";

/** Variables under which `git ls-files` reads some index other than the checkout's own. */
const OTHER_INDEX_VARS: readonly string[] = [
  "GIT_COMMON_DIR",
  "GIT_DIR",
  "GIT_INDEX_FILE",
  "GIT_OBJECT_DIRECTORY",
  "GIT_WORK_TREE",
];

/**
 * The git directory a checkout's `.git` names: itself when it is a directory, the `gitdir:` line's target when it
 * is the file a linked worktree carries.
 *
 * @param root the checkout's root, absolute
 * @param dotGit `.git`'s contents when it is a file, or `undefined` when it is a directory
 * @returns the git directory, or `undefined` when the file is not a `gitdir:` pointer
 */
export function gitDirOf({ root, dotGit }: { root: string; dotGit: string | undefined }): string | undefined {
  if (dotGit === undefined) {
    return join(root, ".git");
  }
  const named = /^gitdir: (.+)$/m.exec(dotGit)?.[1];
  if (named === undefined) {
    return undefined;
  }
  if (isAbsolute(named)) {
    return named;
  }
  return resolve(root, named);
}

/**
 * The listing a cache file holds for `key`, or `undefined` when it holds another index's listing or is not one.
 *
 * @param text the cache file's contents
 * @param key the identity of the index as it stands now
 * @returns the remembered listing
 */
export function listingFor({ text, key }: { text: string; key: string }): readonly string[] | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (typeof parsed !== "object" || parsed === null || !("key" in parsed) || !("files" in parsed)) {
    return undefined;
  }
  const files: unknown = parsed.files;
  if (parsed.key !== key || !Array.isArray(files) || !files.every((file) => typeof file === "string")) {
    return undefined;
  }
  return files;
}

/**
 * The index file `git ls-files` would read in this checkout, when that can be known without asking git.
 *
 * @param root the checkout's root, absolute
 * @param env the environment git would inherit
 * @returns the index's path
 */
function indexPathOf({ root, env }: { root: string; env: NodeJS.ProcessEnv }): string | undefined {
  if (OTHER_INDEX_VARS.some((name) => env[name] !== undefined)) {
    return undefined;
  }
  const dotGitPath = join(root, ".git");
  const dotGit = statSync(dotGitPath, { throwIfNoEntry: false });
  if (dotGit === undefined) {
    return undefined;
  }
  let pointer: string | undefined;
  if (dotGit.isFile()) {
    pointer = readFileSync(dotGitPath, "utf8");
  } else if (!dotGit.isDirectory()) {
    return undefined;
  }
  const gitDir = gitDirOf({ dotGit: pointer, root });
  if (gitDir === undefined) {
    return undefined;
  }
  return join(gitDir, "index");
}

/**
 * The index's identity: what changes whenever git writes it.
 *
 * @returns the identity, or `undefined` when there is no index to identify or it cannot be stat'd — an index this
 *   process may not read is git's to report, so the caller asks git
 */
function identityOf({ index }: { index: string }): string | undefined {
  try {
    const stat = statSync(index, { bigint: true, throwIfNoEntry: false });
    if (stat === undefined) {
      return undefined;
    }
    return [stat.dev, stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs].map(String).join(":");
  } catch {
    return undefined;
  }
}

/**
 * The key a listing is remembered under. Serialised as JSON rather than joined, so two argvs whose words join to
 * the same string (`["a b"]` and `["a", "b"]`) never share a listing. Every `GIT_*` variable is in it, sorted, since
 * git reads its own settings from that namespace and any one of them may change what the same argv prints.
 *
 * @param argv the `git` argv the listing came from
 * @param identity the index's identity when it was read
 * @param env the environment git inherits
 * @returns the key
 */
export function listingKey({
  argv,
  identity,
  env,
}: {
  argv: readonly string[];
  identity: string;
  env: NodeJS.ProcessEnv;
}): string {
  const gitEnv = Object.entries(env)
    .filter(([name]) => name.startsWith("GIT_"))
    .toSorted(([a], [b]) => (a < b ? -1 : 1));
  return JSON.stringify([argv, identity, gitEnv]);
}

/**
 * List a checkout's sources through the cache: the remembered listing while the index is the one it was read
 * from, else `list()`, remembered when the index held still while it ran.
 *
 * @param root the checkout's root, absolute
 * @param argv the `git` argv `list` runs, part of the key
 * @param env the environment git inherits, which can point it at another index
 * @param list reads the listing from git, with whether git succeeded; a failed listing is answered as git printed it,
 *   exactly as before the cache, and never remembered
 * @returns the listing
 */
export function cachedListing({
  root,
  argv,
  env,
  list,
}: {
  root: string;
  argv: readonly string[];
  env: NodeJS.ProcessEnv;
  list: () => { files: readonly string[]; remember: boolean };
}): readonly string[] {
  let index: string | undefined;
  try {
    index = indexPathOf({ env, root });
  } catch {
    // An unreadable `.git` is git's to report; the listing below is what this guard has always read.
    return list().files;
  }
  if (index === undefined) {
    return list().files;
  }
  const identity = identityOf({ index });
  if (identity === undefined) {
    return list().files;
  }
  const before = listingKey({ argv, env, identity });
  const cacheFile = join(dirname(index), LISTING_CACHE_FILE);
  try {
    const remembered = listingFor({ key: before, text: readFileSync(cacheFile, "utf8") });
    // Re-stat after the read, as the miss path does after `list()`: an index replaced in between is asked of git.
    if (remembered !== undefined && identityOf({ index }) === identity) {
      return remembered;
    }
  } catch {
    // No cache yet, or one that cannot be read: git answers, and the answer is remembered below.
  }
  const { files: listed, remember } = list();
  if (!remember || identityOf({ index }) !== identity) {
    return listed;
  }
  try {
    writeFileAtomic({ contents: JSON.stringify({ files: listed, key: before }), path: cacheFile });
  } catch {
    // A git directory this process cannot write to costs the next run a spawn, never a wrong listing.
  }
  return listed;
}
