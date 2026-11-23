/**
 * The owner's protect list as a deliberate verb has to honour it: both registries, read once, failing CLOSED.
 *
 * ## Which registries
 *
 * The home in use and the account's own default home, the same pair the `PreToolUse` guard reads
 * (`../admit/protectedPathGuardRunner.ts`), so a verb pointed at a throwaway home still keeps the owner's live
 * protection. An absent registry protects nothing, as `./registry.ts` defines.
 *
 * ## Why it fails closed
 *
 * The guard fails open because it runs on every tool call, and wedging all of them on one bad byte is worse. A verb
 * that reads or writes the corpus is deliberate, so one that cannot say what it may touch touches nothing: a
 * malformed or unreadable registry, an account default that cannot be resolved, and a dangling symlink where a
 * registry belongs are all `PROTECTION_UNKNOWN`, never an empty list.
 *
 * ## Spellings
 *
 * An entry recorded through a symlinked alias also covers its real path, resolved through its nearest existing
 * ancestor so an entry naming something not created yet still lands where it would. A path judged against the list
 * is judged under the same two spellings ({@link resolvedPathSpellings}), so a symlink into a protected tree is
 * refused before anything under it is listed or read. Judging and opening are separate system calls, so a path swapped for a symlink
 * between the two is not caught: this is lexical-and-resolved confinement, not descriptor-relative confinement.
 *
 * Domain-neutral on purpose: `../corpus/` and `../store/` both judge against it, and neither imports the other's
 * errors through it.
 */
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { isRecord } from "#lib/parsers.js";
import { err, ok, type Result } from "#lib/result.js";

import { accountDefaultHome } from "../homeDir.js";
import { stateHomePaths } from "../stateHome.js";

import { type ProtectedPath, readProtectedPaths } from "./registry.js";

/** The owner's protection could not be established, so nothing it might cover is touched. */
export interface OwnerProtectionUnknownError {
  readonly code: "PROTECTION_UNKNOWN";
  readonly message: string;
  /** Why, as the registry read or the home resolution reported it. */
  readonly reason: string;
}

/** Every way reading the owner's protection fails; one variant, because every failure means the same thing. */
export type OwnerProtectionError = OwnerProtectionUnknownError;

/** The factory every owner-protection failure is built through. */
export const OwnerProtectionErrors = {
  unknown: ({ reason }: { reason: string }): OwnerProtectionUnknownError => ({
    code: "PROTECTION_UNKNOWN",
    message: `the owner's protect list could not be read, so nothing it might cover is touched: ${reason}`,
    reason,
  }),
} as const;

/** Reads a file's text, `undefined` when there is no file there; any other failure throws. */
export type ProtectionTextReader = (args: { path: string }) => string | undefined;

/**
 * A file's text, `undefined` only when nothing at all is there — a permission or any other failure throws, so it is
 * never mistaken for an absent registry, and neither is a dangling symlink.
 *
 * @param path the file to read
 * @returns its text, or `undefined` when no directory entry exists
 */
function readRegistryText({ path }: { path: string }): string | undefined {
  try {
    return readFileSync(path, "utf8");
  } catch (cause) {
    if (isRecord(cause) && cause["code"] === "ENOENT" && !somethingAt({ path })) {
      return undefined;
    }
    throw cause;
  }
}

/**
 * Whether a directory entry exists at a path, a dangling symlink included.
 *
 * @param path the path to look at without following it
 * @returns `true` when anything is there
 */
function somethingAt({ path }: { path: string }): boolean {
  try {
    lstatSync(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * The homes whose registries apply: the one in use and the account's own default.
 *
 * @param home the Slopweaver home the verb runs against
 * @param accountHome resolves the account default, injected so a test never reads the owner's own registry
 * @returns the homes, deduplicated, or `PROTECTION_UNKNOWN` when the account default cannot be resolved
 */
export function protectionHomes({
  home,
  accountHome = accountDefaultHome,
}: {
  home: string;
  accountHome?: () => string;
}): Result<readonly string[], OwnerProtectionError> {
  try {
    return ok([...new Set([home, accountHome()])]);
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : String(cause);
    return err(
      OwnerProtectionErrors.unknown({ reason: `the account's default home could not be resolved: ${reason}` }),
    );
  }
}

/**
 * Every entry the given homes' registries hold, each under its recorded and its real spelling, failing closed on
 * any registry that cannot be read.
 *
 * Entries keep registry order, deduplicated by folded path AND mode, so a `read-only` copy of a path never displaces
 * its `no-access` one.
 *
 * @param homes the homes whose registries apply
 * @param readText reads a registry's text
 * @returns the entries, or why the owner's protection is unknown
 */
export function ownerProtection({
  homes,
  readText = readRegistryText,
}: {
  homes: readonly string[];
  readText?: ProtectionTextReader;
}): Result<readonly ProtectedPath[], OwnerProtectionError> {
  const entries: ProtectedPath[] = [];
  const seen = new Set<string>();
  for (const home of homes) {
    const registry = readProtectedPaths({ file: stateHomePaths({ home }).protectedPathsJson, readText });
    if (registry.isErr()) {
      return err(OwnerProtectionErrors.unknown({ reason: registry.error.message }));
    }
    for (const entry of registry.value.paths.flatMap((each) => resolvedEntries({ entry: each }))) {
      const key = `${entry.path.toLowerCase()}\u0000${entry.mode}`;
      if (!seen.has(key)) {
        seen.add(key);
        entries.push(entry);
      }
    }
  }
  return ok(entries);
}

/**
 * The owner's protection for a verb running against one home: both registries, read once.
 *
 * @param home the Slopweaver home the verb runs against
 * @returns the entries, or `PROTECTION_UNKNOWN`
 */
export function ownerProtectionFor({ home }: { home: string }): Result<readonly ProtectedPath[], OwnerProtectionError> {
  return protectionHomes({ home }).andThen((homes) => ownerProtection({ homes }));
}

/**
 * Every spelling a path is judged under: absolute as asked, and real through its nearest existing ancestor when
 * that differs — so an append target that does not exist yet still resolves through a symlinked parent.
 *
 * @param path the path as asked; a relative one resolves against the working directory
 * @returns one or two spellings, the asked one first
 */
export function resolvedPathSpellings({ path }: { path: string }): readonly string[] {
  const absolute = resolve(path);
  const real = realThroughNearestAncestor({ path: absolute });
  return real === absolute ? [absolute] : [absolute, real];
}

/**
 * One entry under its own spelling and, where that resolves elsewhere, under its real one too.
 *
 * @param entry one protect-list entry, as recorded
 * @returns the entry, followed by a copy at its real path when that differs
 */
function resolvedEntries({ entry }: { entry: ProtectedPath }): readonly ProtectedPath[] {
  const real = realThroughNearestAncestor({ path: resolve(entry.path) });
  return real === entry.path ? [entry] : [entry, { ...entry, path: real }];
}

/**
 * A path's real spelling, resolving the nearest ancestor that exists and keeping the rest as written.
 *
 * @param path an absolute path
 * @returns the path with its existing prefix resolved
 */
function realThroughNearestAncestor({ path }: { path: string }): string {
  let prefix = path;
  const tail: string[] = [];
  for (;;) {
    try {
      return join(realpathSync(prefix), ...tail.toReversed());
    } catch {
      const parent = dirname(prefix);
      if (parent === prefix) {
        return path;
      }
      tail.push(basename(prefix));
      prefix = parent;
    }
  }
}
