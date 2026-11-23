/**
 * The effectful half of `store pages-import`: read every file under `<home>/pages/` and `<home>/published-pages/`
 * into memory, byte-exact and settled, refusing anything that is not a plain tree of regular files.
 *
 * It decides nothing about what a file MEANS — which is the page, which a frozen version, what a pointer says —
 * because that is `project.ts`, a pure function a test can drive without a disk. What it owns is the four things only
 * a read can know: a name that does not decode, a link, an entry that is neither file nor directory, and a file that
 * moved while it was read. It walks on past a refusal, so one run names every one of them, and answers no scan at
 * all when there is any.
 *
 * ## Nothing is followed and nothing is skipped, bar Finder's own file
 *
 * A symbolic link anywhere refuses the whole import, found by `lstat` and enforced again by `O_NOFOLLOW` at the open.
 * A directory is listed by path, because Node has no `openat`, so each one is re-`lstat`ed after its listing and
 * refused when its path no longer names the directory first seen. The residue, stated: a process able to write the
 * home could swap a directory for a link and back between those two looks. Such a process could edit any page
 * anyway, so this is defended as a narrowing, never as a boundary.
 * The one entry passed over is `.DS_Store`, which Finder writes into any folder it opens: it is no page's content, no
 * reader serves it, and the count passed over is reported. Measured on the operator's home, with
 * `find ~/.slopweaver/pages ~/.slopweaver/published-pages -name '.*'`: one, at the top of `pages/`.
 *
 * ## A settled read
 *
 * A file is read through one descriptor and compared three ways — the `lstat` before the open, the descriptor's own
 * stat, and its stat after the read — on device, inode, size and both change times, with the bytes read matching the
 * size. Any difference is a publish landing mid-read, refused rather than imported half-written.
 */
import { createHash } from "node:crypto";
import { type BigIntStats, constants } from "node:fs";
import { lstat, open, readdir } from "node:fs/promises";
import { join } from "node:path";

import { err, ok, type Result } from "#lib/result.js";

import { stateHomePaths } from "../../stateHome.js";
import { type PublishedPagesImportError, PublishedPagesImportErrors } from "./errors.js";

/** The one name passed over: Finder's per-folder metadata. */
const FINDER_METADATA = ".DS_Store";

/** The alphabet every page key, history key and served path segment is in — the console's `PAGE_SLUG`. */
const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;

/** One regular file, read whole. */
export interface ScannedFile {
  /** `/`-separated, under its page or history directory. */
  readonly relativePath: string;
  readonly bytes: Buffer;
  /** Lower-case hex sha-256 of `bytes`. */
  readonly sha256: string;
  readonly modifiedAt: Date;
}

/** One directory directly under a root, and every file beneath it. */
export interface ScannedDirectory {
  readonly name: string;
  readonly files: readonly ScannedFile[];
}

/** Everything both folders hold. */
export interface PublishedPagesScan {
  /** `pages/<slug>/…`. */
  readonly pages: readonly ScannedDirectory[];
  /** `published-pages/<key>/…`. */
  readonly histories: readonly ScannedDirectory[];
  /** How many `.DS_Store` files were passed over. */
  readonly finderMetadataSkipped: number;
}

/** What one walk gathers: the files it read, the refusals it met, and the Finder files it passed over. */
interface Walk {
  readonly refusals: PublishedPagesImportError[];
  finderMetadataSkipped: number;
}

/** One directory entry, named and classified without following anything. */
interface Entry {
  readonly name: string;
  readonly path: string;
  readonly stats: BigIntStats;
}

/**
 * Read both page folders under a home, naming every link, odd entry, unsafe name and unsettled file.
 *
 * A folder that does not exist holds nothing; a home with neither is an empty scan, not a failure. With a `slug`, only
 * `pages/<slug>/` and `published-pages/<slug>/` are read — what a publish carries — and a sibling is never looked at,
 * so another page's defect cannot refuse this one's.
 *
 * @param home the Slopweaver home whose `pages/` and `published-pages/` are read
 * @param slug the one page and history to read, absent for both folders whole
 * @returns every page and history directory with its files, or every refusal met
 */
export async function scanPublishedPageSources({
  home,
  slug,
}: {
  home: string;
  slug?: string;
}): Promise<Result<PublishedPagesScan, readonly PublishedPagesImportError[]>> {
  const walk: Walk = { finderMetadataSkipped: 0, refusals: [] };
  const paths = stateHomePaths({ home });
  if (slug !== undefined && !SAFE_NAME.test(slug)) {
    return err([PublishedPagesImportErrors.entryNameUnsafe({ directory: paths.pages, name: slug })]);
  }
  const pages = await scanRoot({ only: slug, root: paths.pages, walk });
  const histories = await scanRoot({ only: slug, root: paths.publishedPages, walk });
  if (walk.refusals.length > 0) {
    return err(walk.refusals);
  }
  return ok({ finderMetadataSkipped: walk.finderMetadataSkipped, histories, pages });
}

/**
 * Every directory directly under one root; a regular file there other than Finder's is not a page and refuses.
 *
 * @param only the one child to read, absent for every child
 * @param root the absolute folder
 * @param walk where refusals and skips are gathered
 * @returns its directories
 */
async function scanRoot({
  only,
  root,
  walk,
}: {
  only: string | undefined;
  root: string;
  walk: Walk;
}): Promise<readonly ScannedDirectory[]> {
  const identity = await rootPresent({ root, walk });
  if (identity === undefined) {
    return [];
  }
  const directories: ScannedDirectory[] = [];
  const entries =
    only === undefined ? await listEntries({ directory: root, walk }) : await oneEntry({ name: only, root, walk });
  await stillSameDirectory({ directory: root, identity, walk });
  for (const entry of entries) {
    if (entry.stats.isDirectory()) {
      const files: ScannedFile[] = [];
      await walkTree({ directory: entry.path, files, identity: entry.stats, prefix: "", walk });
      directories.push({ files, name: entry.name });
    } else if (!isFinderMetadata({ entry, walk })) {
      walk.refusals.push(
        PublishedPagesImportErrors.entryKindUnsupported({
          found: `${kindOf({ stats: entry.stats })} where only page directories belong`,
          path: entry.path,
        }),
      );
    }
  }
  return directories;
}

/**
 * Whether a root exists as a real directory; a link or a non-directory there is a refusal.
 *
 * @param root the absolute folder
 * @param walk where a refusal is gathered
 * @returns the directory's own stats when it is one to walk, else `undefined`
 */
async function rootPresent({ root, walk }: { root: string; walk: Walk }): Promise<BigIntStats | undefined> {
  try {
    const stats = await lstat(root, { bigint: true });
    if (stats.isSymbolicLink()) {
      walk.refusals.push(PublishedPagesImportErrors.symbolicLink({ path: root }));
      return undefined;
    }
    if (!stats.isDirectory()) {
      walk.refusals.push(
        PublishedPagesImportErrors.entryKindUnsupported({
          found: `${kindOf({ stats })} where a folder belongs`,
          path: root,
        }),
      );
      return undefined;
    }
    return stats;
  } catch (cause: unknown) {
    if (errorCode({ cause }) !== "ENOENT") {
      walk.refusals.push(PublishedPagesImportErrors.sourceUnreadable({ path: root, reason: reasonOf({ cause }) }));
    }
    return undefined;
  }
}

/**
 * Refuse a directory whose path no longer names the directory first seen there — the rename of a link into its place
 * between that look and the listing. Node has no `openat`, so the listing itself goes by path; this check is the
 * narrowing, and a swap put back before it runs is the residue the header states.
 *
 * @param directory the absolute directory just listed
 * @param identity its own stats from before the listing
 * @param walk where a refusal is gathered
 */
async function stillSameDirectory({
  directory,
  identity,
  walk,
}: {
  directory: string;
  identity: BigIntStats;
  walk: Walk;
}): Promise<void> {
  try {
    const now = await lstat(directory, { bigint: true });
    if (now.isSymbolicLink()) {
      walk.refusals.push(PublishedPagesImportErrors.symbolicLink({ path: directory }));
    } else if (now.dev !== identity.dev || now.ino !== identity.ino) {
      walk.refusals.push(PublishedPagesImportErrors.fileChanged({ path: directory }));
    }
  } catch (cause: unknown) {
    walk.refusals.push(PublishedPagesImportErrors.sourceUnreadable({ path: directory, reason: reasonOf({ cause }) }));
  }
}

/**
 * Append every regular file under one directory, recursively and in name order, as paths relative to where the walk
 * began. One accumulator for the whole page, so a deep tree is never copied level by level.
 *
 * @param directory the absolute directory to walk
 * @param files the page's accumulator, appended to
 * @param identity its own stats as its parent's listing saw it
 * @param prefix the relative path of `directory` itself, empty at the top
 * @param walk where refusals and skips are gathered
 */
async function walkTree({
  directory,
  files,
  identity,
  prefix,
  walk,
}: {
  directory: string;
  files: ScannedFile[];
  identity: BigIntStats;
  prefix: string;
  walk: Walk;
}): Promise<void> {
  const entries = await listEntries({ directory, walk });
  await stillSameDirectory({ directory, identity, walk });
  for (const entry of entries) {
    const relativePath = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
    if (entry.stats.isDirectory()) {
      await walkTree({ directory: entry.path, files, identity: entry.stats, prefix: relativePath, walk });
    } else if (entry.stats.isFile() && !isFinderMetadata({ entry, walk })) {
      const read = await readSettled({ before: entry.stats, path: entry.path });
      read.match(
        ({ bytes, modifiedAt }) => files.push({ bytes, modifiedAt, relativePath, sha256: sha256Of({ bytes }) }),
        (refusal) => walk.refusals.push(refusal),
      );
    } else if (!entry.stats.isFile()) {
      walk.refusals.push(
        PublishedPagesImportErrors.entryKindUnsupported({ found: kindOf({ stats: entry.stats }), path: entry.path }),
      );
    }
  }
}

/**
 * Whether an entry is Finder's metadata file, counting it when it is.
 *
 * @param entry the classified entry
 * @param walk where the skip is counted
 * @returns true when the entry is passed over
 */
function isFinderMetadata({ entry, walk }: { entry: Entry; walk: Walk }): boolean {
  if (entry.name !== FINDER_METADATA || !entry.stats.isFile()) {
    return false;
  }
  walk.finderMetadataSkipped += 1;
  return true;
}

/**
 * A directory's entries in name order, each name decoded strictly and each entry `lstat`ed, never followed. A link,
 * an unsafe name or an unreadable entry is gathered as a refusal and left out.
 *
 * @param directory the absolute directory
 * @param walk where refusals are gathered
 * @returns its walkable entries
 */
async function listEntries({ directory, walk }: { directory: string; walk: Walk }): Promise<readonly Entry[]> {
  let raw: Buffer[];
  try {
    raw = await readdir(directory, { encoding: "buffer" });
  } catch (cause: unknown) {
    walk.refusals.push(PublishedPagesImportErrors.sourceUnreadable({ path: directory, reason: reasonOf({ cause }) }));
    return [];
  }
  const entries: Entry[] = [];
  for (const name of safeNames({ directory, raw, walk })) {
    const path = join(directory, name);
    try {
      const stats = await lstat(path, { bigint: true });
      if (stats.isSymbolicLink()) {
        walk.refusals.push(PublishedPagesImportErrors.symbolicLink({ path }));
      } else if (name === FINDER_METADATA && !stats.isFile()) {
        // The Finder name is admitted for Finder's own file only; anything else so named is an unsafe name.
        walk.refusals.push(PublishedPagesImportErrors.entryNameUnsafe({ directory, name }));
      } else {
        entries.push({ name, path, stats });
      }
    } catch (cause: unknown) {
      walk.refusals.push(PublishedPagesImportErrors.sourceUnreadable({ path, reason: reasonOf({ cause }) }));
    }
  }
  return entries;
}

/**
 * One named child of a root, `lstat`ed and never followed, without listing its siblings. Absent is no entry; a link is
 * gathered as a refusal. The name is already in the safe alphabet, so it is never Finder's.
 *
 * @param name the child, a slug
 * @param root the absolute folder it sits in
 * @param walk where refusals are gathered
 * @returns the child as an entry, or none
 */
async function oneEntry({ name, root, walk }: { name: string; root: string; walk: Walk }): Promise<readonly Entry[]> {
  const path = join(root, name);
  try {
    const stats = await lstat(path, { bigint: true });
    if (stats.isSymbolicLink()) {
      walk.refusals.push(PublishedPagesImportErrors.symbolicLink({ path }));
      return [];
    }
    return [{ name, path, stats }];
  } catch (cause: unknown) {
    if (errorCode({ cause }) !== "ENOENT") {
      walk.refusals.push(PublishedPagesImportErrors.sourceUnreadable({ path, reason: reasonOf({ cause }) }));
    }
    return [];
  }
}

/**
 * The names a directory listed that decode as strict UTF-8 and sit in the safe alphabet, sorted.
 *
 * @param directory the directory listed, for refusals
 * @param raw the names as the file system holds them
 * @param walk where refusals are gathered
 * @returns the safe names in order
 */
function safeNames({
  directory,
  raw,
  walk,
}: {
  directory: string;
  raw: readonly Buffer[];
  walk: Walk;
}): readonly string[] {
  const names: string[] = [];
  for (const bytes of raw) {
    const name = decodedName({ bytes });
    if (name !== undefined && (name === FINDER_METADATA || SAFE_NAME.test(name))) {
      names.push(name);
    } else {
      walk.refusals.push(PublishedPagesImportErrors.entryNameUnsafe({ directory, name: bytes.toString("utf8") }));
    }
  }
  return names.toSorted();
}

/**
 * Read one regular file through one descriptor that refuses a link, and prove nothing moved while it was read.
 *
 * @param path the absolute file
 * @param before its `lstat` from the listing
 * @returns its bytes and modification time, or a refusal
 */
async function readSettled({
  path,
  before,
}: {
  path: string;
  before: BigIntStats;
}): Promise<Result<{ bytes: Buffer; modifiedAt: Date }, PublishedPagesImportError>> {
  try {
    const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const opened = await handle.stat({ bigint: true });
      const bytes = await handle.readFile();
      const after = await handle.stat({ bigint: true });
      const settled = sameFile({ a: before, b: opened }) && sameFile({ a: opened, b: after });
      if (!settled || BigInt(bytes.length) !== after.size) {
        return err(PublishedPagesImportErrors.fileChanged({ path }));
      }
      return ok({ bytes, modifiedAt: after.mtime });
    } finally {
      await handle.close();
    }
  } catch (cause: unknown) {
    if (errorCode({ cause }) === "ELOOP") {
      return err(PublishedPagesImportErrors.symbolicLink({ path }));
    }
    return err(PublishedPagesImportErrors.sourceUnreadable({ path, reason: reasonOf({ cause }) }));
  }
}

/**
 * Whether two stats describe the same file in the same state.
 *
 * @param a one stat
 * @param b the other
 * @returns true when device, inode, size and both change times agree
 */
function sameFile({ a, b }: { a: BigIntStats; b: BigIntStats }): boolean {
  return a.dev === b.dev && a.ino === b.ino && a.size === b.size && a.mtimeNs === b.mtimeNs && a.ctimeNs === b.ctimeNs;
}

/**
 * What kind of entry a stat describes, in words a refusal can carry.
 *
 * @param stats the entry's own stats, never followed
 * @returns a phrase such as `a socket`
 */
function kindOf({ stats }: { stats: BigIntStats }): string {
  const kinds: readonly (readonly [boolean, string])[] = [
    [stats.isFile(), "a regular file"],
    [stats.isDirectory(), "a directory"],
    [stats.isSocket(), "a socket"],
    [stats.isFIFO(), "a FIFO"],
    [stats.isBlockDevice() || stats.isCharacterDevice(), "a device"],
  ];
  const kind = kinds.find(([is]) => is);
  if (kind === undefined) {
    return "an entry of unknown kind";
  }
  return kind[1];
}

/**
 * Lower-case hex sha-256 of some bytes.
 *
 * @param bytes what to hash
 * @returns the digest
 */
function sha256Of({ bytes }: { bytes: Buffer }): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * A name decoded as strict UTF-8.
 *
 * @param bytes the name as the file system holds it
 * @returns the name, or `undefined` when it is not valid UTF-8
 */
function decodedName({ bytes }: { bytes: Buffer }): string | undefined {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return undefined;
  }
}

/**
 * A thrown value's Node error code.
 *
 * @param cause what was thrown
 * @returns its `code`, or `undefined` when it carries none
 */
function errorCode({ cause }: { cause: unknown }): unknown {
  return typeof cause === "object" && cause !== null && "code" in cause ? cause.code : undefined;
}

/**
 * A thrown value as one line.
 *
 * @param cause what was thrown
 * @returns its message
 */
function reasonOf({ cause }: { cause: unknown }): string {
  return cause instanceof Error ? cause.message : String(cause);
}
