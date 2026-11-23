/**
 * The bounded read edge of `slopweaver talk code` — the module that decides whether a path may be opened at
 * all, and the one place in this domain that touches a filesystem.
 *
 * ## Fail CLOSED, which is the opposite of what the shared helper does
 *
 * `runningCheckoutRoot` (`src/lib/gitRepo.ts`) deliberately FALLS BACK to `cwd` when it cannot resolve a
 * repository, because every one of its callers wants a directory to look in and none is worth destroying a
 * turn over. That trade is wrong here and only here: falling back would read whatever tree the console's
 * server happened to start in, and hand it to a model. {@link resolveTalkCheckout} refuses instead.
 *
 * `workingTreeFilesOf` is wrong for the same shape of reason — it passes `--others`, so it lists UNTRACKED
 * files, which is right for a gate that must check everything on disk and wrong for a reader that promises
 * the voice can see tracked files only. {@link trackedFilesOf} passes `--cached` alone.
 *
 * ## A tracked PATH is not bounded BYTES
 *
 * A pre-mortem reproduced two aliases that satisfy every containment and
 * regular-file check and still serve bytes from outside the checkout:
 *
 *  - a tracked name that is a **symlink** to an untracked file INSIDE the checkout — containment passes,
 *    because the target is inside; membership passes, because the NAME is tracked;
 *  - a tracked name **hard-linked** to a file outside the checkout — `lstat` sees an ordinary regular file
 *    and its real path is inside the root, because a hard link has no target to resolve.
 *
 * So the order here is: check membership on the REQUESTED path, `lstat` the REQUESTED path (never a path
 * substituted after resolution), refuse `nlink > 1`, refuse a symlinked ancestor, and only then open. The
 * hard-link arm is the same check `src/lib/pathContainment.ts` makes on the WRITE side, where the identical
 * objection was raised by an identical pass; this is its read side.
 *
 * ## Validation binds to the descriptor, not to the name
 *
 * Between `lstat` and `open`, a writer can replace the file. Every check is therefore RE-MADE against the
 * open descriptor with `fstat`, and the bytes are read from that descriptor.
 *
 * That is not sufficient on its own, and the third review proved it: `fstat` on a swapped-in SYMLINK's
 * target reports a perfectly ordinary regular file with `nlink === 1`, so no check on the descriptor can
 * see the substitution at all. The open therefore refuses to traverse a symlinked leaf in the first place
 * ({@link READ_NOFOLLOW}), which is atomic because the kernel makes it. What remains — a parent directory
 * swapped underneath between the ancestor walk and the open — is named in `docs/console-voice-boundary.md` rather than
 * claimed closed.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { closeSync, constants, fstatSync, lstatSync, openSync, readdirSync, readSync, type Stats } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

import { gitEnv, repoRootFromDirectory } from "../lib/gitRepo.js";
import { err, ok, type Result } from "../lib/result.js";

import { type ReadWindow, readWindow, utf8BoundaryAtOrBefore } from "./codeBounds.js";
import { type TalkError, TalkErrors } from "./errors.js";

/**
 * How long one git read here may take before it is killed. It is local work that answers in well under a
 * second on a healthy repository; two minutes, the bound `src/worktree/pruneGit.ts` and
 * `src/worktree/salvageScan.ts` already put on the same class of read, ends one wedged on a held lock, a FIFO
 * config or a prompt nobody can see instead of blocking the event loop for good. SIGKILL, because a child that
 * traps the default SIGTERM would outlive the bound.
 */
const GIT_READ_TIMEOUT_MS = 2 * 60_000;

/** An open, validated file and the window read out of it. */
export interface BoundedRead {
  /** The repo-relative path, as the caller asked for it. */
  readonly path: string;
  /** The file's whole size in bytes, so a reader can see what it did not get. */
  readonly size: number;
  /** The window carried. */
  readonly window: ReadWindow;
  /** The decoded text of that window, snapped to a UTF-8 boundary. */
  readonly text: string;
  /** sha256 of the WINDOW's bytes — what was sent, not what the file holds. */
  readonly digest: string;
}

/**
 * The checkout root `talk code` reads from, or a refusal.
 *
 * @param cwd the directory to resolve from; the console server's own, in practice
 * @returns the real, absolute root, or `CHECKOUT_UNRESOLVED`
 */
export function resolveTalkCheckout({ cwd }: { cwd: string }): Result<string, TalkError> {
  try {
    return ok(resolve(repoRootFromDirectory({ dir: cwd })));
  } catch {
    return err(TalkErrors.checkoutUnresolved({ cwd }));
  }
}

/** What an enumeration of a checkout found, and what it could not carry. */
export interface TrackedListing {
  /** The tracked paths, repo-relative and sorted. */
  readonly paths: readonly string[];
  /**
   * The tracked names dropped because no string names exactly their bytes — reported rather than silently absent,
   * so a checkout holding one says so instead of looking like a checkout that does not.
   */
  readonly undecodable: readonly Buffer[];
}

/**
 * How many dropped names sit under a directory: a name outside it costs a listing of that directory nothing.
 *
 * @param names the raw bytes of the names {@link trackedFilesOf} dropped
 * @param prefix the directory with its trailing slash, or empty for the whole checkout
 * @returns the count of names whose bytes open with the prefix's
 */
export function undecodableUnder({ names, prefix }: { names: readonly Buffer[]; prefix: string }): number {
  const opening = Buffer.from(prefix, "utf8");
  return names.filter((name) => name.subarray(0, opening.length).equals(opening)).length;
}

/**
 * Every TRACKED file of a checkout, repo-relative and sorted.
 *
 * An enumeration that FAILED and a checkout that holds nothing are different answers and are returned
 * differently: a throw is `ENUMERATION_FAILED`, and an empty listing is an empty list. Reporting the first
 * as the second is how a reader concludes there is nothing to protect.
 *
 * ## A filename is BYTES, and decoding one lossily invents membership
 *
 * A review reproduced this against the shipped verb: git's output was decoded
 * as UTF-8, so an index entry whose name holds the byte `0xff` came back as the STRING `bad-�.ts` —
 * and an ordinary untracked file really named `bad-�.ts` compares equal to it. Membership passed for
 * a file git had never heard of, and both readers served its contents. The replacement character is not a
 * decoding detail here; it is two different filenames becoming one string.
 *
 * So the enumeration reads BYTES and keeps a name only when its decoded string RE-ENCODES to exactly those
 * bytes — see {@link decodeTrackedNames}, where the second instance of this same class is recorded.
 * Dropping rather than carrying is what the voice can actually honour: a name reaching a model over JSON is
 * a JavaScript string either way, so there is no request it could make that names such a file
 * unambiguously. Their bytes come back as {@link TrackedListing.undecodable} instead of vanishing.
 *
 * @param root a root {@link resolveTalkCheckout} returned
 * @returns the tracked paths and the count dropped, or `ENUMERATION_FAILED`
 */
export function trackedFilesOf({ root }: { root: string }): Result<TrackedListing, TalkError> {
  try {
    const listing = execFileSync("git", ["-C", root, "ls-files", "-z", "--cached"], {
      encoding: "buffer",
      env: gitEnv(),
      maxBuffer: 64 * 1024 * 1024,
      killSignal: "SIGKILL",
      timeout: GIT_READ_TIMEOUT_MS,
    });
    return ok(decodeTrackedNames({ listing }));
  } catch (cause) {
    return err(TalkErrors.enumerationFailed({ cause, root }));
  }
}

/**
 * Split a NUL-delimited `ls-files -z` buffer into names, keeping only the ones that decode EXACTLY.
 *
 * "Exactly" is checked by re-encoding and comparing bytes, rather than by trusting the decoder's options.
 * `fatal: true` alone is not enough and the second review found the proof: `TextDecoder` STRIPS a leading
 * U+FEFF, so a tracked file named `﻿secret.ts` decoded to `secret.ts` — the name of an untracked file
 * beside it — with no error raised. `ignoreBOM` fixes that one
 * instance; the round-trip is what makes "this string names exactly these bytes" a CHECKED property
 * instead of a claim about a decoder's behaviour, and it is the arm that will catch the next instance.
 */
function decodeTrackedNames({ listing }: { listing: Buffer }): TrackedListing {
  const strict = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
  const paths: string[] = [];
  const undecodable: Buffer[] = [];
  for (const [start, end] of nulDelimitedRanges({ listing })) {
    const bytes = listing.subarray(start, end);
    const decoded = decodeExactly({ bytes, strict });
    if (decoded === undefined) {
      undecodable.push(bytes);
      continue;
    }
    paths.push(decoded);
  }
  return { paths: paths.toSorted(), undecodable };
}

/** One name's bytes as a string, or undefined when the string would not re-encode to those same bytes. */
function decodeExactly({ bytes, strict }: { bytes: Buffer; strict: TextDecoder }): string | undefined {
  let decoded: string;
  try {
    decoded = strict.decode(bytes);
  } catch {
    return undefined;
  }
  if (!Buffer.from(decoded, "utf8").equals(bytes)) {
    return undefined;
  }
  return decoded;
}

/** The `[start, end)` byte range of each non-empty NUL-delimited record, without decoding any of them. */
function nulDelimitedRanges({ listing }: { listing: Buffer }): readonly (readonly [number, number])[] {
  const ranges: (readonly [number, number])[] = [];
  let start = 0;
  for (let at = 0; at < listing.length; at += 1) {
    if (listing[at] !== 0) {
      continue;
    }
    if (at > start) {
      ranges.push([start, at]);
    }
    start = at + 1;
  }
  if (listing.length > start) {
    ranges.push([start, listing.length]);
  }
  return ranges;
}

/**
 * Read a bounded window of one tracked file, refusing every alias that would serve bytes from elsewhere.
 *
 * @param root the resolved checkout root
 * @param path the repo-relative path requested
 * @param tracked the tracked set membership is checked against
 * @param from the continuation offset, or 0
 * @param budget the per-response byte cap
 * @returns the window and its text, or the refusal that stopped it
 */
export function readTrackedFile({
  root,
  path,
  tracked,
  from,
  budget,
}: {
  root: string;
  path: string;
  tracked: ReadonlySet<string>;
  from: number;
  budget: number;
}): Result<BoundedRead, TalkError> {
  const shapeRefusal = refuseUnusableShape({ path });
  if (shapeRefusal !== undefined) {
    return err(shapeRefusal);
  }
  if (!tracked.has(path)) {
    return err(TalkErrors.pathNotTracked({ path }));
  }
  const aliasRefusal = refuseAliasedPath({ path, root });
  if (aliasRefusal !== undefined) {
    return err(aliasRefusal);
  }
  return readFromDescriptor({ absolute: join(root, path), budget, from, path });
}

/**
 * Every alias refusal a tracked NAME has to survive before its bytes may be opened, in one place.
 *
 * Exported because there are TWO readers and only one of them used to make these checks. `code_read` went
 * through {@link readTrackedFile} and refused a symlink; `code_find` opened `join(root, path)` itself, so a
 * tracked name that is a symlink to a file outside the checkout came back as a HIT, with the outside file's
 * line quoted in the excerpt (reproduced end to end against the real
 * verb). The containment and shape checks are cheap and were never the gap; the leaf and ancestor ones are
 * the gap, and splitting them across two callers is what let one of them drift.
 *
 * Membership in the tracked set is NOT checked here: `searchTrackedFiles` is already iterating that set,
 * while `readTrackedFile` takes an arbitrary requested path and checks membership itself first.
 *
 * @param root the resolved checkout root
 * @param path the repo-relative name being asked for
 * @param listings a caller-owned cache of directory listings, so a search pays one `readdir` per directory
 *   rather than one per file; omit it and each call reads what it needs
 * @returns the refusal that stops it, or undefined when the name may be opened
 */
export function refuseAliasedPath({
  root,
  path,
  listings = new Map(),
}: {
  root: string;
  path: string;
  listings?: DirectoryListings;
}): TalkError | undefined {
  // The ORDER makes four refusals below unreachable, and they are kept deliberately rather than by
  // oversight — say so here so the next audit does not read them as untested. `refuseUnusableShape`
  // refuses every `..` and every absolute path, so nothing that truly escapes ever reaches
  // `refuseIfOutside`; and the listing walk fails first on any directory a later `lstat` could not have
  // read, so neither ancestor nor leaf `lstat` catch can fire on an input a test can build. Each is one
  // reordering away from being load-bearing, which is why none of them is deleted.
  const shapeRefusal = refuseUnusableShape({ path });
  if (shapeRefusal !== undefined) {
    return shapeRefusal;
  }
  const absolute = join(root, path);
  const containmentRefusal = refuseIfOutside({ absolute, root });
  if (containmentRefusal !== undefined) {
    return containmentRefusal;
  }
  const spellingRefusal = refuseNameTheDirectoryDoesNotList({ listings, path, root });
  if (spellingRefusal !== undefined) {
    return spellingRefusal;
  }
  const ancestorRefusal = refuseSymlinkedAncestor({ absolute, root });
  if (ancestorRefusal !== undefined) {
    return ancestorRefusal;
  }
  return refuseAliasedLeaf({ absolute, path });
}

/** A directory's own entry names, keyed by absolute directory path. Minted per search and thrown away. */
export type DirectoryListings = Map<string, ReadonlySet<string>>;

/**
 * The refusal for a path whose components the directories between root and leaf do not actually LIST.
 *
 * Every other check here asks the filesystem about a path, so every other check inherits the filesystem's
 * own idea of which names are the same name. On a case-insensitive volume — the macOS default — `open`,
 * `lstat` and `fstat` all happily resolve `Tracked.ts` onto an entry really called `tracked.ts`, which is a
 * regular file with `nlink === 1` and no symlink anywhere. A review
 * reproduced it: with `core.ignoreCase=false`, git lists `Tracked.ts` as tracked and `tracked.ts` as
 * untracked, and both readers served the untracked file's contents under the tracked name.
 *
 * `readdir` is the only call that reports a name as the directory SPELLS it rather than as a lookup folds
 * it, so exact membership in the listing is what makes "this is the name git listed" checkable at all.
 * Every component is checked, not just the leaf: a directory folds exactly as readily as a file.
 */
function refuseNameTheDirectoryDoesNotList({
  root,
  path,
  listings,
}: {
  root: string;
  path: string;
  listings: DirectoryListings;
}): TalkError | undefined {
  let cursor = root;
  for (const component of path.split("/")) {
    const entries = entryNamesOf({ dir: cursor, listings });
    if (entries === undefined) {
      return TalkErrors.pathUnreadable({ cause: new Error(`could not list ${cursor}`), path });
    }
    if (!entries.has(component)) {
      return TalkErrors.pathAliased({ alias: "case-folded", path });
    }
    cursor = join(cursor, component);
  }
  return undefined;
}

/** One directory's entry names, read once and remembered, or undefined when it cannot be listed. */
function entryNamesOf({
  dir,
  listings,
}: {
  dir: string;
  listings: DirectoryListings;
}): ReadonlySet<string> | undefined {
  const remembered = listings.get(dir);
  if (remembered !== undefined) {
    return remembered;
  }
  try {
    const names = new Set(readdirSync(dir));
    listings.set(dir, names);
    return names;
  } catch {
    return undefined;
  }
}

/** A path that cannot be a repo-relative tracked name, rejected before the filesystem is touched. */
function refuseUnusableShape({ path }: { path: string }): TalkError | undefined {
  const traverses = path.split(/[/\\]/u).includes("..");
  if (isAbsolute(path) || traverses || path.length === 0) {
    return TalkErrors.pathOutside({ path });
  }
  return undefined;
}

/**
 * The refusal for a path that does not lie under the root once both are resolved.
 *
 * The escape test compares SEGMENTS, never a string prefix. `relative()` answering `..config/settings.ts`
 * means a directory literally called `..config`, which is inside the root; only `..` alone, or `..`
 * followed by a separator, is a step out of it. Measured against the shipped verb, before this
 * was segment-wise: `talk code read --path ..config/settings.ts` in a checkout tracking that file answered
 * "resolves outside the checkout root", and `talk code find` counted it as an alias it had skipped.
 */
function refuseIfOutside({ absolute, root }: { absolute: string; root: string }): TalkError | undefined {
  const within = relative(root, absolute);
  const escapes = within === ".." || within.startsWith(`..${sep}`) || isAbsolute(within);
  if (escapes) {
    return TalkErrors.pathOutside({ path: absolute });
  }
  return undefined;
}

/**
 * The refusal for any directory between the root and the file that is itself a symlink.
 *
 * Without this, `tracked/dir` can be a link to somewhere else entirely and every check on the LEAF passes,
 * because the leaf really is an ordinary file — it is just not the one the path names.
 */
function refuseSymlinkedAncestor({ absolute, root }: { absolute: string; root: string }): TalkError | undefined {
  let cursor = dirname(absolute);
  while (cursor.length > root.length && cursor.startsWith(root + sep)) {
    try {
      if (lstatSync(cursor).isSymbolicLink()) {
        return TalkErrors.pathAliased({ alias: "symlink", path: cursor });
      }
    } catch (cause) {
      return TalkErrors.pathUnreadable({ cause, path: cursor });
    }
    cursor = dirname(cursor);
  }
  return undefined;
}

/** The refusal for a leaf that is a symlink, a hard link, or not a regular file. */
function refuseAliasedLeaf({ absolute, path }: { absolute: string; path: string }): TalkError | undefined {
  let stat;
  try {
    stat = lstatSync(absolute);
  } catch (cause) {
    return TalkErrors.pathUnreadable({ cause, path });
  }
  if (stat.isSymbolicLink()) {
    return TalkErrors.pathAliased({ alias: "symlink", path });
  }
  if (!stat.isFile()) {
    return TalkErrors.pathAliased({ alias: "not-a-regular-file", path });
  }
  if (stat.nlink > 1) {
    return TalkErrors.pathAliased({ alias: "hard-link", path });
  }
  return undefined;
}

/**
 * The open flags every read in this domain uses: read-only, and REFUSING to follow a symlinked leaf.
 *
 * `O_NOFOLLOW` is what closes the window between `lstat` and `open`. A review
 * scheduled a replacement inside it — `tracked.txt` validated as an ordinary file, then swapped for a
 * symlink to a file outside the checkout before the open — and both readers followed it, because `fstat`
 * on the opened target sees a perfectly ordinary regular file with `nlink === 1`. No check ON the
 * descriptor can see that; only refusing to traverse the link at open time can, and the kernel is the only
 * thing positioned to do it atomically.
 *
 * It covers the LEAF only. A parent directory swapped underneath between the ancestor walk and the open is
 * still open, and `docs/console-voice-boundary.md` names it rather than claiming it closed.
 */
export const READ_NOFOLLOW = constants.O_RDONLY | constants.O_NOFOLLOW;

/**
 * The alias checks that can only be made against what was actually OPENED, rather than against a name.
 *
 * Extracted, and shared by both readers, for a reason a reviewer should know: reaching these arms through a
 * reader needs a writer to swap the file between its `lstat` and its `open`, which is a race no test can
 * stage deterministically. Every earlier check refuses a fixture built before the call. So the condition
 * itself — a descriptor whose `fstat` reports a directory, or a link count above one — is what a test
 * builds and hands straight to this function, and each reader is left a single delegation.
 *
 * @param stat the `fstat` of the open descriptor, never an `lstat` of the name
 * @returns why the opened descriptor is an alias, or `undefined` when it is the file the name promised
 */
export function refuseAliasedDescriptor({ stat, path }: { stat: Stats; path: string }): TalkError | undefined {
  if (!stat.isFile()) {
    return TalkErrors.pathAliased({ alias: "not-a-regular-file", path });
  }
  if (stat.nlink > 1) {
    return TalkErrors.pathAliased({ alias: "hard-link", path });
  }
  return undefined;
}

/** Open, RE-CHECK every alias property against the descriptor, and read the window from it. */
function readFromDescriptor({
  absolute,
  path,
  from,
  budget,
}: {
  absolute: string;
  path: string;
  from: number;
  budget: number;
}): Result<BoundedRead, TalkError> {
  let fd: number;
  try {
    fd = openSync(absolute, READ_NOFOLLOW);
  } catch (cause) {
    return err(TalkErrors.pathUnreadable({ cause, path }));
  }
  try {
    const stat = fstatSync(fd);
    // The name passed every check a moment ago; this is the same pair against what was actually OPENED,
    // which is what a writer replacing the file between lstat and open would otherwise slip past.
    const descriptorRefusal = refuseAliasedDescriptor({ path, stat });
    if (descriptorRefusal !== undefined) {
      return err(descriptorRefusal);
    }
    const size = stat.size;
    const planned = readWindow({ budget, from, size });
    if (planned.isErr()) {
      return err(planned.error);
    }
    const window = planned.value;
    const buffer = Buffer.alloc(window.end - window.start);
    const read = readSync(fd, buffer, 0, buffer.length, window.start);
    const bytes = buffer.subarray(0, read);
    const snapped = window.truncated ? utf8BoundaryAtOrBefore({ at: bytes.length, bytes }) : bytes.length;
    const carried = bytes.subarray(0, snapped);
    const end = window.start + snapped;
    const truncated = end < size;
    return ok({
      digest: digestOf({ bytes: carried }),
      path,
      size,
      text: new TextDecoder("utf-8").decode(carried),
      window: { end, nextFrom: truncated ? end : null, start: window.start, truncated },
    });
  } catch (cause) {
    return err(TalkErrors.pathUnreadable({ cause, path }));
  } finally {
    closeSync(fd);
  }
}

/** sha256 of what was actually carried, so a reader can tell two windows apart. */
function digestOf({ bytes }: { bytes: Uint8Array }): string {
  return createHash("sha256").update(bytes).digest("hex");
}
