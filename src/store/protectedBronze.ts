/**
 * The owner's protect list, as the store verbs that read bronze have to honour it.
 *
 * ## The defect this exists for
 *
 * `store status` scans every source's bronze directory for its drift report, and `store ingest` reads one.
 * Neither consulted `$SLOPWEAVER_HOME/protected-paths.json`, because the `PreToolUse` guard that enforces it only
 * ever sees a tool call's own operands, never a path a verb resolves for itself. MEASURED on a real home: a
 * plain `store status` read about twenty-one thousand lines out of a bronze source directory the owner had
 * marked `no-access`, and printed a repair line that would have ingested every one of them into the store.
 *
 * ## What it decides
 *
 * A bronze DIRECTORY is judged as a search (`../protectedPaths/decide.ts`): refused when it is at or under a
 * `no-access` path, or is an ANCESTOR of one, since listing it recursively would read into the protected child.
 * A bronze FILE is judged as a read. Each is judged under its lexical spelling and, where it resolves, its real
 * one, so a symlink into a protected tree is refused before it is followed; the recursive walk below re-judges
 * every directory and file it meets for the same reason, which `../corpus/bronzeStorage.ts`'s lenient listing
 * does not. A path is made absolute before it is judged, so a relative `--home` cannot miss an absolute entry,
 * and an entry recorded through a symlinked alias also covers its real path.
 *
 * ## Which registries, and why it fails CLOSED
 *
 * Both registries are read by `../protectedPaths/ownerEntries.ts`, the one reader the bronze writer shares: the
 * home in use and the account's own default home, failing closed on anything it cannot read. Its
 * `PROTECTION_UNKNOWN` is mapped here into the store's own, so a store verb that cannot say what it may read
 * reads nothing.
 *
 * ## The residue, stated
 *
 * Judging and opening are separate system calls, so a path swapped for a symlink between the two is not caught:
 * this is lexical-and-resolved confinement, not descriptor-relative confinement.
 */
import { readdirSync, realpathSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { isRecord } from "#lib/parsers.js";
import { err, ok, type Result } from "#lib/result.js";
import type { BronzeFileStat } from "../corpus/bronzeStorage.js";
import { bronzeSourceDir, sortBronzeEntries } from "../corpus/corpusPaths.js";
import type { CorpusSource } from "../corpus/types.js";

import { type PathAccess, protectionHitAny } from "../protectedPaths/decide.js";
import {
  type OwnerProtectionError,
  ownerProtectionFor as readOwnerProtection,
} from "../protectedPaths/ownerEntries.js";
import type { ProtectedPath } from "../protectedPaths/registry.js";

import { type StoreError, StoreErrors } from "./errors.js";

/**
 * The owner's protection for a store verb running against one home: both registries, read once, with an unknown
 * protection mapped into the store's own `PROTECTION_UNKNOWN`.
 *
 * @param home the Slopweaver home the verb runs against
 * @param read reads both registries, injected so a test never reads the owner's own
 * @returns the entries, or `PROTECTION_UNKNOWN`
 */
export function ownerProtectionFor({
  home,
  read = readOwnerProtection,
}: {
  home: string;
  read?: (args: { home: string }) => Result<readonly ProtectedPath[], OwnerProtectionError>;
}): Result<readonly ProtectedPath[], StoreError> {
  return read({ home }).mapErr((error) => StoreErrors.protectionUnknown({ reason: error.reason }));
}

/**
 * The real spelling of a path that exists, beside the one asked; only the asked one when it does not resolve.
 *
 * @param path the absolute path as asked
 * @returns every spelling to judge
 */
function spellings({ path }: { path: string }): readonly string[] {
  try {
    const real = realpathSync(path);
    return real === path ? [path] : [path, real];
  } catch {
    return [path];
  }
}

/**
 * The refusal one access earns, or `undefined` when the protect list allows it. Pure but for resolving the path.
 *
 * @param path the absolute bronze path about to be listed or read
 * @param access `search` for a directory about to be listed, `read` for a file about to be read
 * @param entries the owner's protect-list entries
 * @returns the typed refusal naming the entry it reaches, or `undefined`
 */
function refusalFor({
  path,
  access,
  entries,
}: {
  path: string;
  access: PathAccess;
  entries: readonly ProtectedPath[];
}): StoreError | undefined {
  // Judged absolute, so a relative `--home` cannot slip a spelling past an absolute entry.
  const hit = protectionHitAny({ access, entries, targets: spellings({ path: resolve(path) }) });
  if (hit === undefined) {
    return undefined;
  }
  return StoreErrors.bronzeProtected({ path, protectedPath: hit.path, why: hit.why });
}

/** Whether a thrown filesystem error is "nothing is there", which is an empty source rather than a fault. */
function isNotFound({ error }: { error: unknown }): boolean {
  return isRecord(error) && error["code"] === "ENOENT";
}

/**
 * Every `.jsonl` under one directory, in bronze read order, judging each directory before it is listed and each
 * entry before it is followed.
 *
 * Mirrors `../corpus/bronzeStorage.ts`'s strict listing — a missing directory is empty, an unreadable one is
 * `BRONZE_UNREADABLE` — so the files and their order are exactly what the loader reads.
 *
 * @param dir the directory to walk, absolute
 * @param entries the owner's protect-list entries
 * @returns the files, or the first refusal or filesystem failure
 */
function walk({
  dir,
  entries,
}: {
  dir: string;
  entries: readonly ProtectedPath[];
}): Result<readonly BronzeFileStat[], StoreError> {
  const refused = refusalFor({ access: "search", entries, path: dir });
  if (refused !== undefined) {
    return err(refused);
  }
  const names = listNames({ dir });
  if (names.isErr()) {
    return err(names.error);
  }
  const files: BronzeFileStat[] = [];
  for (const name of sortBronzeEntries({ entries: names.value })) {
    const found = walkEntry({ entries, name, path: join(dir, name) });
    if (found.isErr()) {
      return found;
    }
    for (const file of found.value) {
      files.push(file);
    }
  }
  return ok(files);
}

/**
 * One directory's entry names, a missing directory listing as empty and any other failure as `BRONZE_UNREADABLE`.
 *
 * @param dir the directory already judged allowed
 * @returns the names, unsorted
 */
function listNames({ dir }: { dir: string }): Result<readonly string[], StoreError> {
  try {
    return ok(readdirSync(dir));
  } catch (error: unknown) {
    if (isNotFound({ error })) {
      return ok([]);
    }
    return err(StoreErrors.bronzeUnreadable({ cause: error, path: dir }));
  }
}

/**
 * One entry of a walked directory: judged before it is followed, then recursed into, kept as a `.jsonl`, or skipped.
 *
 * @param path the entry's path under the walked directory
 * @param name its basename, which decides whether a file is bronze
 * @param entries the owner's protect-list entries
 * @returns the files it contributes, or the first refusal or filesystem failure
 */
function walkEntry({
  path,
  name,
  entries,
}: {
  path: string;
  name: string;
  entries: readonly ProtectedPath[];
}): Result<readonly BronzeFileStat[], StoreError> {
  const refused = refusalFor({ access: "search", entries, path });
  if (refused !== undefined) {
    return err(refused);
  }
  let stat: ReturnType<typeof statSync>;
  try {
    stat = statSync(path);
  } catch (error: unknown) {
    return err(StoreErrors.bronzeUnreadable({ cause: error, path }));
  }
  if (stat.isDirectory()) {
    return walk({ dir: path, entries });
  }
  return ok(name.endsWith(".jsonl") ? [{ bytes: stat.size, path }] : []);
}

/**
 * One source's bronze `.jsonl` files in bronze read order, refused before anything is listed when the source
 * reaches a `no-access` path.
 *
 * @param home the Slopweaver home the bronze resolves under
 * @param source the source to list
 * @param entries the owner's protect-list entries
 * @returns the files, `BRONZE_PROTECTED`, or `BRONZE_UNREADABLE`
 */
export function listProtectedBronzeFiles({
  home,
  source,
  entries,
}: {
  home: string;
  source: CorpusSource;
  entries: readonly ProtectedPath[];
}): Result<readonly BronzeFileStat[], StoreError> {
  return walk({ dir: bronzeSourceDir({ home, source }), entries });
}

/**
 * One bronze file, judged as a read under its absolute and real spellings before anything opens it.
 *
 * @param path the file as the caller named it; a relative one resolves against the working directory
 * @param entries the owner's protect-list entries
 * @returns the path to read — its real spelling where it resolves, so a later open does not follow the symlink
 *   that was judged a second time — or `BRONZE_PROTECTED`
 */
export function protectedBronzeFile({
  path,
  entries,
}: {
  path: string;
  entries: readonly ProtectedPath[];
}): Result<string, StoreError> {
  const absolute = resolve(path);
  const refused = refusalFor({ access: "read", entries, path: absolute });
  if (refused !== undefined) {
    return err(refused);
  }
  return ok(spellings({ path: absolute }).at(-1)!);
}
