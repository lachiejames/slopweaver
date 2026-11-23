/**
 * Read every file a page loads from where its publisher said they are, before the store is opened: stage 6 of
 * `docs/store/published-pages.md`, where a publish writes only to the store and `--assets-from` names where images
 * are read. These bytes, and only these, become the page's files.
 *
 * ## What a publish reads, and from where
 *
 * The files are `./loadedFiles.ts`'s: what the document loads, then what each stylesheet among them loads in turn
 * (a sheet is a `.css` file, the only kind the console serves as one), each read once. A directory source is
 * `--assets-from`: the file at the same path under it, reached through no link and itself a regular file. A files
 * source is a generated publisher's own list (`proposal publish`'s media, renamed under `media/`), and every file on
 * it is stored whether or not the document loads it, since a linked attachment is fetched only on a click. Anything
 * else in the directory is not the page's and is never read.
 *
 * ## Refused, never published broken
 *
 * Every file is read through one descriptor that refuses a link and proved unchanged across the read, as
 * `../store/publishedPages/scan.ts` reads the folders, then proved to be the file still at its path under the root
 * resolved before any read, so a directory swapped for a link mid-publish reads nothing outside it. Every defect is gathered and the whole publish refused, so a
 * page is never stored missing a file it loads. There is no hatch: the store would serve that page broken for good.
 */
import { constants, lstatSync, realpathSync, type Stats } from "node:fs";
import { open } from "node:fs/promises";
import { join } from "node:path";

import { errorMessage } from "#lib/errorMessage.js";
import { err, ok, type Result } from "#lib/result.js";
import { publishedPageMediaType } from "../store/publishedPages/mediaType.js";

import { documentLoads, type LoadedPageFile, stylesheetEscapes, stylesheetLoads } from "./loadedFiles.js";
import { type PageAssetError, PageAssetErrors } from "./pageAssetErrors.js";

/** Where a publish reads the files its page loads. */
export type PageAssetSource =
  | { readonly kind: "directory"; readonly root: string }
  | { readonly kind: "files"; readonly files: readonly { readonly relativePath: string; readonly path: string }[] };

/** One file the page loads, read. */
export interface PreparedPageAsset {
  readonly relativePath: string;
  readonly bytes: Buffer;
}

/**
 * Read every file a page loads, refusing the publish on any one that is missing or unsafe.
 *
 * @param document the complete document, shell included
 * @param slug the page's slug
 * @param source where the files are read from; a page that loads none needs none
 * @returns each file once, in the order it was first loaded, or every defect
 */
export async function preparePageAssets({
  document,
  slug,
  source,
}: {
  document: string;
  slug: string;
  source: PageAssetSource | undefined;
}): Promise<Result<readonly PreparedPageAsset[], readonly PageAssetError[]>> {
  // A named root is checked before anything else, so a link named as --assets-from is refused on a page that
  // happens to load nothing too (Codex review, r3).
  const root = source === undefined ? undefined : resolveRoot({ source });
  if (root?.isErr()) {
    return err([root.error]);
  }
  const pending = [...documentLoads({ document, slug })];
  appendListedFiles({ pending, source });
  if (pending.length === 0) {
    return ok([]);
  }
  if (source === undefined || root === undefined || root.isErr()) {
    return err([PageAssetErrors.required({ references: pending.map((load) => load.reference) })]);
  }
  const prepared = new Map<string, PreparedPageAsset>();
  const refusals: PageAssetError[] = [];
  for (let load = pending.shift(); load !== undefined; load = pending.shift()) {
    if (prepared.has(load.relativePath)) {
      continue;
    }
    const read = await readLoad({ load, root: root.value, source });
    if (read.isErr()) {
      refusals.push(read.error);
      continue;
    }
    prepared.set(load.relativePath, read.value);
    appendSheetFollowUp({ asset: read.value, pending, refusals, slug });
  }
  return refusals.length > 0 ? err(refusals) : ok([...prepared.values()]);
}

/**
 * Append every file on a files source the document does not already load. That list is the publisher's own, and every
 * file on it is the page's: a proposal's non-image placeholder renders as a link, which no load names, and the page
 * would otherwise store a dead one.
 *
 * @param pending the walk's queue of loads, appended to in place
 * @param source where the files are read from; only a files source adds any
 */
function appendListedFiles({
  pending,
  source,
}: {
  pending: LoadedPageFile[];
  source: PageAssetSource | undefined;
}): void {
  if (source?.kind !== "files") {
    return;
  }
  const loaded = new Set(pending.map((load) => load.relativePath));
  for (const { relativePath } of source.files) {
    if (!loaded.has(relativePath)) {
      loaded.add(relativePath);
      pending.push({ reference: relativePath, relativePath });
    }
  }
}

/**
 * Append what one read file adds to the walk: a stylesheet's own loads to read next, and a refusal for each file it
 * names outside the page; any other file adds nothing. It pushes one element at a time, because a sheet's load list
 * is data-sized and a spread-append copies it whole.
 *
 * @param asset the file just read
 * @param pending the walk's queue of loads still to read, appended to in place
 * @param refusals the walk's refusals so far, appended to in place
 * @param slug the page's slug, which fixes where a sheet's references resolve
 */
function appendSheetFollowUp({
  asset,
  pending,
  refusals,
  slug,
}: {
  asset: PreparedPageAsset;
  pending: LoadedPageFile[];
  refusals: PageAssetError[];
  slug: string;
}): void {
  const { relativePath } = asset;
  if (publishedPageMediaType({ relativePath }) !== "text/css") {
    return;
  }
  const sheet = { css: asset.bytes.toString("utf8"), relativePath, slug };
  for (const load of stylesheetLoads(sheet)) {
    pending.push(load);
  }
  for (const reference of stylesheetEscapes(sheet)) {
    refusals.push(PageAssetErrors.unsafe({ relativePath, why: `loads ${reference}, outside the page` }));
  }
}

/** A directory source's root as resolved before any read: its real path, and the directory it named then. */
interface ResolvedRoot {
  readonly path: string;
  readonly identity: Pick<Stats, "dev" | "ino">;
}

/**
 * A directory source's real path, resolved once before any read so every file can be proved to sit under it
 * afterwards; a files source has none.
 *
 * @param source the source
 * @returns the resolved root and its identity, `undefined` for a files source, or why the directory cannot be read from
 */
function resolveRoot({ source }: { source: PageAssetSource }): Result<ResolvedRoot | undefined, PageAssetError> {
  if (source.kind === "files") {
    return ok(undefined);
  }
  const stats = lstatSync(source.root, { throwIfNoEntry: false });
  if (stats === undefined) {
    return err(PageAssetErrors.rootUnusable({ root: source.root, why: "does not exist" }));
  }
  if (stats.isSymbolicLink()) {
    return err(PageAssetErrors.rootUnusable({ root: source.root, why: "is a link; name the directory it points at" }));
  }
  if (!stats.isDirectory()) {
    return err(PageAssetErrors.rootUnusable({ root: source.root, why: "is not a directory" }));
  }
  try {
    const real = realpathSync(source.root);
    const resolved = lstatSync(real);
    if (!resolvedRootStayed({ checked: stats, resolved })) {
      return err(PageAssetErrors.rootUnusable({ root: source.root, why: "was replaced while it was resolved" }));
    }
    return ok({ identity: { dev: resolved.dev, ino: resolved.ino }, path: real });
  } catch (error: unknown) {
    return err(
      PageAssetErrors.rootUnusable({ root: source.root, why: `could not be resolved: ${errorMessage({ error })}` }),
    );
  }
}

/**
 * Whether the directory a root resolved to is the very one checked as no link a moment before. The check and the
 * resolve are two calls on one mutable name, so a root swapped for a link between them would otherwise resolve to
 * wherever the link points, unrefused (Codex review, r3).
 *
 * @param checked the identity `lstat` saw at the named root
 * @param resolved the identity at the path that root resolved to
 * @returns true only when both name the same inode on the same device
 */
export function resolvedRootStayed({
  checked,
  resolved,
}: {
  checked: Pick<Stats, "dev" | "ino">;
  resolved: Pick<Stats, "dev" | "ino">;
}): boolean {
  return checked.dev === resolved.dev && checked.ino === resolved.ino;
}

/**
 * Whether the file a read returned is still the one at its path under the resolved root, reached through no link.
 * The leaf is opened with `O_NOFOLLOW`, which guards only the last component, so a directory on the path swapped for
 * a link between the check and the open would otherwise read a file outside the root. Comparing the inode after the
 * read catches that swap even when it is put back. The root's own identity is compared too: a directory renamed
 * into the root's place, with no link anywhere, would otherwise pass both checks for every file it holds (Codex
 * review, r3).
 *
 * @param realRoot the root as resolved before any read
 * @param rootIdentity the identity the root had when it was resolved
 * @param relativePath where the file sits under it
 * @param read the identity of the file the read returned
 * @returns true only when the root is the directory resolved, and that path resolves to itself and names the same inode
 */
export function readStayedUnderRoot({
  realRoot,
  rootIdentity,
  relativePath,
  read,
}: {
  realRoot: string;
  rootIdentity: Pick<Stats, "dev" | "ino">;
  relativePath: string;
  read: Pick<Stats, "dev" | "ino">;
}): boolean {
  const path = join(realRoot, ...relativePath.split("/"));
  try {
    const now = lstatSync(path);
    const root = lstatSync(realRoot);
    const rootStayed = root.dev === rootIdentity.dev && root.ino === rootIdentity.ino;
    return rootStayed && realpathSync(path) === path && now.dev === read.dev && now.ino === read.ino;
  } catch {
    return false;
  }
}

/**
 * Read one loaded file from the source.
 *
 * @param load the file the page loads
 * @param root a directory source's resolved root, which the file must still sit under once read
 * @param source where it is read from
 * @returns its bytes, or why not
 */
async function readLoad({
  load,
  root,
  source,
}: {
  load: LoadedPageFile;
  root: ResolvedRoot | undefined;
  source: PageAssetSource;
}): Promise<Result<PreparedPageAsset, PageAssetError>> {
  const located = locate({ load, source });
  if (located.isErr()) {
    return err(located.error);
  }
  const read = await readSettled({ path: located.value.path, before: located.value.stats });
  if (read.isErr()) {
    return err(read.error);
  }
  const { relativePath } = load;
  const left =
    root !== undefined &&
    !readStayedUnderRoot({
      read: located.value.stats,
      realRoot: root.path,
      relativePath,
      rootIdentity: root.identity,
    });
  if (left) {
    return err(
      PageAssetErrors.unsafe({
        relativePath,
        why: "left --assets-from while it was read: a directory on its path was replaced",
      }),
    );
  }
  return ok({ bytes: read.value, relativePath });
}

/**
 * Where one loaded file is, checked to be a regular file reached through no link.
 *
 * @param load the file the page loads
 * @param source where it is read from
 * @returns its absolute path and its own stats, or why it cannot be read
 */
function locate({
  load,
  source,
}: {
  load: LoadedPageFile;
  source: PageAssetSource;
}): Result<{ path: string; stats: Stats }, PageAssetError> {
  const { reference, relativePath } = load;
  if (source.kind === "files") {
    const named = source.files.find((file) => file.relativePath === relativePath);
    if (named === undefined) {
      return err(PageAssetErrors.missing({ reference, relativePath, where: "among the publisher's media" }));
    }
    return statLeaf({ load, path: named.path });
  }
  const segments = relativePath.split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === ".." || segment.includes("\0"))) {
    return err(PageAssetErrors.unsafe({ relativePath, why: "names no path a file can sit at under --assets-from" }));
  }
  for (let depth = 1; depth < segments.length; depth += 1) {
    const directory = lstatSync(join(source.root, ...segments.slice(0, depth)), { throwIfNoEntry: false });
    if (directory === undefined) {
      return err(PageAssetErrors.missing({ reference, relativePath, where: `under ${source.root}` }));
    }
    if (!directory.isDirectory()) {
      return err(PageAssetErrors.unsafe({ relativePath, why: "is reached through a link or a non-directory" }));
    }
  }
  return statLeaf({ load, path: join(source.root, ...segments) });
}

/**
 * One file's own stats, refused unless it is a regular file.
 *
 * @param load the file the page loads
 * @param path where it is
 * @returns the path and stats, or why not
 */
function statLeaf({
  load,
  path,
}: {
  load: LoadedPageFile;
  path: string;
}): Result<{ path: string; stats: Stats }, PageAssetError> {
  const stats = lstatSync(path, { throwIfNoEntry: false });
  if (stats === undefined) {
    return err(
      PageAssetErrors.missing({ reference: load.reference, relativePath: load.relativePath, where: `at ${path}` }),
    );
  }
  if (!stats.isFile()) {
    return err(PageAssetErrors.unsafe({ relativePath: load.relativePath, why: `is not a regular file (${path})` }));
  }
  return ok({ path, stats });
}

/** The identity and change fields a settled read compares. */
type FileStamp = Pick<Stats, "ctimeMs" | "dev" | "ino" | "mtimeMs" | "size">;

/**
 * Whether a file read stayed the one file it was located as, unchanged. The change time is compared beside the
 * modification time because a writer can put the modification time back (`futimes`) but never the change time, so
 * a same-size overwrite in place is still caught.
 *
 * @param before the stamp taken when the file was located
 * @param during the stamps taken on the open descriptor, before and after the read
 * @param length how many bytes the read returned
 * @returns true only when every stamp matches `before` and the read returned exactly the file's size
 */
export function readStayedSettled({
  before,
  during,
  length,
}: {
  before: FileStamp;
  during: readonly FileStamp[];
  length: number;
}): boolean {
  const same = during.every(
    (stats) =>
      stats.dev === before.dev &&
      stats.ino === before.ino &&
      stats.size === before.size &&
      stats.mtimeMs === before.mtimeMs &&
      stats.ctimeMs === before.ctimeMs,
  );
  return same && length === before.size;
}

/**
 * Read one regular file through one descriptor that refuses a link, and prove nothing moved while it was read.
 *
 * @param path the absolute file
 * @param before its `lstat` when it was located
 * @returns its bytes, or why not
 */
async function readSettled({ path, before }: { path: string; before: Stats }): Promise<Result<Buffer, PageAssetError>> {
  try {
    const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const opened = await handle.stat();
      const bytes = await handle.readFile();
      const after = await handle.stat();
      const settled = readStayedSettled({ before, during: [opened, after], length: bytes.length });
      return settled ? ok(bytes) : err(PageAssetErrors.changed({ path }));
    } finally {
      await handle.close();
    }
  } catch (error: unknown) {
    return err(PageAssetErrors.unreadable({ path, reason: errorMessage({ error }) }));
  }
}
