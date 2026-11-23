/**
 * The read edge of `slopweaver talk file` — any file or directory on this machine, bounded, with credentials
 * kept on it. The one place in this module family that touches a filesystem.
 *
 * `./checkout.ts` is the opposite trade: it reads only what git tracks in one checkout and refuses every alias,
 * because its promise is "the tracked files". This promise is "any file, like a Claude session", so a symlink
 * is followed and the protection is what `./localPath.ts` refuses and `./fileRedaction.ts` masks.
 *
 * ## What is checked, in order
 *
 * The path is expanded, resolved, and refused if EITHER spelling is a credential store or a credential name, if
 * the resolved path or a directory above it IS a store by `(dev, ino)` whatever it is called, if it is a copy
 * beside one, or if it is a hard link to a file inside one (`./storeLinks.ts`). A source file keeps the
 * masker's source exemptions (`./fileRedaction.ts`); any other file does not. The resolved path must be a regular file, and
 * it is opened without following a leaf symlink and without blocking — so a FIFO or device swapped in after the
 * check cannot hang the read — and the descriptor must be the same inode the check saw. A file whose first bytes
 * name a PNG, JPEG or WebP is read whole as a picture by `./localImage.ts`; any other file is one masked text
 * window, read by `./localText.ts` — an `.html` page's carrying its masked heading outline (`./pageOutline.ts`).
 */
import { closeSync, constants, fstatSync, lstatSync, openSync, readdirSync, realpathSync, type Stats } from "node:fs";
import { basename, dirname, join } from "node:path";

import { appendAll } from "../lib/arrays.js";
import { err, ok, type Result } from "../lib/result.js";

import { protectionHitAny } from "../protectedPaths/decide.js";
import type { ProtectedPath } from "../protectedPaths/registry.js";
import { readWindow } from "./codeBounds.js";
import { TalkErrors } from "./errors.js";
import { type LocalFileError, LocalFileErrors } from "./localFileErrors.js";
import { type LocalImageRead, readLocalImage, sniffOpened } from "./localImage.js";
import { expandLocalPath, refusalFor } from "./localPath.js";
import { type LocalRead, readLocalText } from "./localText.js";
import { identityRule, lazyStoreLinkIndex, type StoreLinkIndex } from "./storeLinks.js";

export type { LocalRead } from "./localText.js";

/** Read-only, refusing a symlinked leaf, and never blocking on a FIFO or device. */
const LOCAL_READ_FLAGS = constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK;

/** Everything a local read needs to decide what may leave the machine. */
export interface LocalReadPolicy {
  /** The owner's home directory, which `~` names. */
  readonly homeDir: string;
  /** Every credential store, in each spelling the caller could resolve. */
  readonly stores: readonly string[];
  /** The owner's private secret strings, masked wherever they appear. */
  readonly denylist: readonly string[];
  /** The `talk-file-credential` hatch: lifts the path refusal, never the masking. */
  readonly refusalsLifted: boolean;
  /** The owner's protected paths (`slopweaver protect`); a `no-access` one is refused whatever hatch is open. */
  readonly protectedPaths: readonly ProtectedPath[];
}

/** One entry of a directory listing. */
export interface LocalEntry {
  readonly name: string;
  readonly kind: "file" | "directory" | "symlink" | "other";
  /** Bytes, for a regular file; `null` otherwise. */
  readonly size: number | null;
  /** Whether `file_read` would refuse it as a credential. */
  readonly refused: boolean;
}

/** One directory, one level deep. */
export interface LocalListing {
  readonly dir: string;
  readonly resolvedDir: string;
  readonly entries: readonly LocalEntry[];
  /** How many entries the directory holds, listed or not. */
  readonly total: number;
  readonly truncated: boolean;
}

/**
 * Read one bounded, masked window of any file on this machine that is not a credential — or, when its own
 * first bytes name a PNG, JPEG or WebP, the whole picture.
 *
 * @param raw the absolute or `~/` path asked for
 * @param from the byte offset to start at, from a previous window's `nextFrom`
 * @param budget the most bytes one window carries
 * @param policy what is refused and masked
 * @returns the window or the picture, or the one reason it could not be read
 */
export function readLocalFile({
  raw,
  from,
  budget,
  policy,
}: {
  raw: string;
  from: number;
  budget: number;
  policy: LocalReadPolicy;
}): Result<LocalRead | LocalImageRead, LocalFileError> {
  const resolved = resolveAllowed({ policy, raw });
  if (resolved.isErr()) {
    return err(resolved.error);
  }
  const { path, real, stat } = resolved.value;
  if (!stat.isFile()) {
    return err(LocalFileErrors.notAFile({ kind: kindOf({ stat }), path }));
  }
  let fd: number;
  try {
    fd = openSync(real, LOCAL_READ_FLAGS);
  } catch (cause) {
    return err(LocalFileErrors.unreadable({ cause, path }));
  }
  try {
    return readOpened({ budget, checked: stat, fd, from, path, policy, real });
  } catch (cause) {
    return err(LocalFileErrors.unreadable({ cause, path }));
  } finally {
    closeSync(fd);
  }
}

/**
 * List one directory on this machine, one level deep, marking what `file_read` would refuse.
 *
 * @param raw the absolute or `~/` directory asked for
 * @param limit the most entries returned
 * @param policy what is refused
 * @returns the listing, or the one reason it could not be made
 */
export function listLocalDir({
  raw,
  limit,
  policy,
}: {
  raw: string;
  limit: number;
  policy: LocalReadPolicy;
}): Result<LocalListing, LocalFileError> {
  const resolved = resolveAllowed({ policy, raw });
  if (resolved.isErr()) {
    return err(resolved.error);
  }
  const { path, real, stat } = resolved.value;
  if (!stat.isDirectory()) {
    return err(LocalFileErrors.notADirectory({ path }));
  }
  let names: string[];
  try {
    // A child inside a `no-access` path the owner protected is left out, and out of the total, so a listing never says
    // it exists — under either spelling of the directory, and wherever a symlink child resolves.
    names = readdirSync(real)
      .toSorted()
      .filter((name) => !ownerHidden({ name, path, policy, real }));
  } catch (cause) {
    return err(LocalFileErrors.unreadable({ cause, path }));
  }
  const index = lazyStoreLinkIndex({ stores: policy.stores });
  const entries = names.slice(0, Math.max(limit, 0)).map((name) => entryOf({ dir: path, index, name, policy, real }));
  return ok({ dir: path, entries, resolvedDir: real, total: names.length, truncated: names.length > entries.length });
}

/** Expand, resolve and refuse — the checks a read and a listing share. */
function resolveAllowed({
  raw,
  policy,
}: {
  raw: string;
  policy: LocalReadPolicy;
}): Result<{ path: string; real: string; stat: Stats }, LocalFileError> {
  const expanded = expandLocalPath({ homeDir: policy.homeDir, raw });
  if (expanded.isErr()) {
    return err(expanded.error);
  }
  const path = expanded.value;
  // Judged on the path as asked BEFORE it is resolved, so a refusal never says whether a protected file exists.
  const asked = ownerProtection({ path, policy, targets: [path] });
  if (asked !== undefined) {
    return err(asked);
  }
  let real: string;
  let stat: Stats;
  try {
    real = realpathSync.native(path);
    stat = lstatSync(real);
  } catch (cause) {
    // A path that does not resolve is judged where its nearest existing ancestor resolves, so a symlink into a
    // protected path answers OWNER_PROTECTED whether or not the file behind it exists, never "does not exist".
    const beyond = ownerProtection({ path, policy, targets: [nearestRealSpelling({ path })] });
    if (beyond !== undefined) {
      return err(beyond);
    }
    return err(LocalFileErrors.unreadable({ cause, path }));
  }
  // And on where it resolves, ahead of the credential hatch, which never lifts the owner's protection.
  const resolvedHit = ownerProtection({ path, policy, targets: [real] });
  if (resolvedHit !== undefined) {
    return err(resolvedHit);
  }
  if (policy.refusalsLifted) {
    return ok({ path, real, stat });
  }
  const rule = refusalFor({ paths: [path, real], stores: policy.stores });
  if (rule !== undefined) {
    return err(LocalFileErrors.refused({ path, rule }));
  }
  const identity = identityRule({ index: lazyStoreLinkIndex({ stores: policy.stores }), real, stores: policy.stores });
  if (identity !== undefined) {
    return err(LocalFileErrors.refused({ path, rule: identity }));
  }
  return ok({ path, real, stat });
}

/** The refusal for a path any of whose spellings is inside a `no-access` path the owner protected. */
function ownerProtection({
  path,
  targets,
  policy,
}: {
  path: string;
  targets: readonly string[];
  policy: LocalReadPolicy;
}): LocalFileError | undefined {
  const hit = protectionHitAny({ access: "read", entries: policy.protectedPaths, targets });
  return hit === undefined
    ? undefined
    : LocalFileErrors.ownerProtected({ path, protectedPath: hit.path, why: hit.why });
}

/** A path's nearest existing ancestor, resolved, with the rest of the path appended — the path as it WOULD resolve. */
function nearestRealSpelling({ path }: { path: string }): string {
  const tail: string[] = [];
  let at = path;
  for (;;) {
    try {
      return join(realpathSync.native(at), ...tail.toReversed());
    } catch {
      const parent = dirname(at);
      if (parent === at) {
        return path;
      }
      tail.push(basename(at));
      at = parent;
    }
  }
}

/** Whether a directory child is inside a `no-access` path, as listed or where it resolves. */
function ownerHidden({
  name,
  path,
  real,
  policy,
}: {
  name: string;
  path: string;
  real: string;
  policy: LocalReadPolicy;
}): boolean {
  const targets = [join(path, name), join(real, name), ...resolvedOrNone({ path: join(real, name) })];
  return protectionHitAny({ access: "read", entries: policy.protectedPaths, targets }) !== undefined;
}

/** Read the window out of an open descriptor, after checking it is the file that was checked. */
function readOpened({
  fd,
  checked,
  path,
  real,
  from,
  budget,
  policy,
}: {
  fd: number;
  checked: Stats;
  path: string;
  real: string;
  from: number;
  budget: number;
  policy: LocalReadPolicy;
}): Result<LocalRead | LocalImageRead, LocalFileError> {
  const opened = fstatSync(fd);
  if (!opened.isFile() || opened.ino !== checked.ino || opened.dev !== checked.dev) {
    return err(LocalFileErrors.notAFile({ kind: "file replaced while it was being opened", path }));
  }
  // The window is judged before a byte is read, the format sniff included.
  const planned = readWindow({ budget, from, size: opened.size });
  if (planned.isErr()) {
    return err(TalkErrors.windowInvalid({ from, size: opened.size }));
  }
  const { head, mediaType } = sniffOpened({ fd, size: opened.size });
  if (mediaType !== undefined) {
    return readLocalImage({ fd, from, head, mediaType, path, real, size: opened.size });
  }
  return readLocalText({ denylist: policy.denylist, fd, head, path, planned: planned.value, real, size: opened.size });
}

/** One listed entry, from its own `lstat`. */
function entryOf({
  dir,
  real,
  name,
  policy,
  index,
}: {
  dir: string;
  real: string;
  name: string;
  policy: LocalReadPolicy;
  index: () => StoreLinkIndex;
}): LocalEntry {
  const paths = [join(dir, name), join(real, name)];
  let stat: Stats;
  try {
    stat = lstatSync(join(real, name));
  } catch {
    const refusedOther = refusalFor({ paths, stores: policy.stores }) !== undefined;
    return { kind: "other", name, refused: refusedOther, size: null };
  }
  const kind = entryKind({ stat });
  const resolved = resolvedOrNone({ path: join(real, name) });
  if (kind === "symlink") {
    appendAll({ from: resolved, into: paths });
  }
  const refused =
    refusalFor({ paths, stores: policy.stores }) !== undefined ||
    resolved.some((target) => identityRule({ index, real: target, stores: policy.stores }) !== undefined);
  return { kind, name, refused, size: kind === "file" ? stat.size : null };
}

/** Where a symlink resolves to, or nothing when it dangles or loops. */
function resolvedOrNone({ path }: { path: string }): readonly string[] {
  try {
    return [realpathSync.native(path)];
  } catch {
    return [];
  }
}

/** A listing's word for what an entry is. */
function entryKind({ stat }: { stat: Stats }): LocalEntry["kind"] {
  if (stat.isFile()) {
    return "file";
  }
  if (stat.isDirectory()) {
    return "directory";
  }
  if (stat.isSymbolicLink()) {
    return "symlink";
  }
  return "other";
}

/** What a path that is not a regular file is, in a word the refusal can say. */
function kindOf({ stat }: { stat: Stats }): string {
  if (stat.isDirectory()) {
    return "directory";
  }
  if (stat.isFIFO()) {
    return "named pipe";
  }
  if (stat.isCharacterDevice() || stat.isBlockDevice()) {
    return "device";
  }
  if (stat.isSocket()) {
    return "socket";
  }
  return "special file";
}
