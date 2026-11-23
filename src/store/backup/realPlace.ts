/**
 * Where a write to a host path really lands, resolved ONCE so a containment check and the write that follows
 * it act on the same place. A caller that checks a resolved path and then writes through the unresolved one
 * has a window in which a link along the way can be re-pointed; resolving first and writing only to the
 * result closes that window for every link that existed when it was resolved.
 *
 * A path carrying a link that points at nothing is REFUSED rather than kept: such a link cannot be resolved
 * now, so keeping it would leave exactly the re-pointable link this module exists to remove.
 *
 * The residue, stated: an entry on a pinned path that is swapped for a link (or created as one) in the
 * instant between a check and the filesystem call after it still redirects that call. Node offers no
 * `openat`/`O_NOFOLLOW` walk to close it, and winning that race needs a process running as the same user at
 * the right instant — which can already open the backup key with no prompt by design and read every object.
 * Every link present when a check runs, existing or dangling, at the root or below, is refused or resolved.
 */
import { lstatSync, realpathSync, statSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

import { errorMessage } from "#lib/errorMessage.js";
import { err, ok, type Result } from "#lib/result.js";

/**
 * Whether an entry exists at a path itself, a link counted as present whether or not it points anywhere.
 *
 * @param path the path
 * @returns true when there is an entry of any kind at it
 */
function entryAt({ path }: { path: string }): boolean {
  try {
    lstatSync(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Whether a path spells a `.` or `..` segment. `resolve`, `relative` and `join` all normalise one away
 * lexically, so `<dir>/link/../out` would be checked as `<dir>/out` while the filesystem follows `link` first and
 * lands wherever it points, or fails at it. A place a backup writes plaintext to is refused with one instead.
 *
 * @param path the path as the caller spelled it
 * @returns true when any segment, split on either separator, is `.` or `..`
 */
export function carriesDotSegment({ path }: { path: string }): boolean {
  return path.split(/[\\/]/u).some((segment) => segment === "." || segment === "..");
}

/**
 * A path with every existing entry's links resolved — the real place a write to it would land, even when
 * the path itself does not exist yet.
 *
 * @param path a host path, made absolute against the working directory first
 * @returns the real path of its deepest existing entry joined with the not-yet-existing rest, or why it
 *   could not be resolved — a link pointing at nothing, or an entry this process cannot read
 */
export function realPlace({ path }: { path: string }): Result<string, PlaceUnresolvedError> {
  let existing = resolve(path);
  const rest: string[] = [];
  while (!entryAt({ path: existing }) && dirname(existing) !== existing) {
    rest.unshift(basename(existing));
    existing = dirname(existing);
  }
  try {
    return ok(join(realpathSync(existing), ...rest));
  } catch (cause: unknown) {
    return err(RealPlaceErrors.unresolved({ at: existing, cause, path }));
  }
}

/** A path that could not be resolved to a real place: a link along it points at nothing, or is unreadable. */
export interface PlaceUnresolvedError {
  readonly code: "PLACE_UNRESOLVED";
  readonly message: string;
  readonly path: string;
  /** The deepest existing entry, where resolution failed. */
  readonly at: string;
  readonly cause: unknown;
}

/** How to raise one — the factory the real code calls, so a test built the same way catches a drift. */
const RealPlaceErrors = {
  unresolved: ({ path, at, cause }: { path: string; at: string; cause: unknown }): PlaceUnresolvedError => ({
    at,
    cause,
    code: "PLACE_UNRESOLVED",
    message: `${path} cannot be resolved to a real place at ${at}: ${errorMessage({ error: cause })}`,
    path,
  }),
} as const;

/** A directory entry's identity on its filesystem, the same whichever path spelling reached it. */
export interface EntryIdentity {
  readonly dev: number;
  readonly ino: number;
}

/** How an identity is read: the entry's identity following links, `null` when absent, or a throw when unreadable. */
export type IdentityOf = (args: { path: string }) => EntryIdentity | null;

/**
 * The production identity reader over `stat`.
 *
 * @param path the path to read
 * @returns the entry's device and inode, or `null` when nothing is there
 */
export const statIdentity: IdentityOf = ({ path }) => {
  const stats = statSync(path, { throwIfNoEntry: false });
  if (stats === undefined) {
    return null;
  }
  return { dev: stats.dev, ino: stats.ino };
};

/**
 * Whether the root DIRECTORY ITSELF sits anywhere on the chain from `place` up to the filesystem root,
 * compared by device and inode. A path comparison misses two spellings of one directory — an APFS firmlink
 * (`/Users` and `/System/Volumes/Data/Users`), a case-insensitive volume, a bind mount — and identity does
 * not, so this is the containment test a write is gated on. An entry that cannot be read counts as held:
 * nothing is written on the strength of a check that could not run.
 *
 * @param root the destination root, by path
 * @param place the candidate, by path
 * @param identityOf how an entry's identity is read; {@link statIdentity} in production
 * @returns true when the root is the place or one of its ancestors
 */
export function heldByIdentity({
  root,
  place,
  identityOf,
}: {
  root: string;
  place: string;
  identityOf: IdentityOf;
}): boolean {
  try {
    const rootIdentity = identityOf({ path: root });
    if (rootIdentity === null) {
      // No root yet: no existing entry can be it, and the lexical test covers a path that would be created.
      return placeWithin({ place, root });
    }
    let current = resolve(place);
    for (;;) {
      const identity = identityOf({ path: current });
      if (identity !== null && identity.dev === rootIdentity.dev && identity.ino === rootIdentity.ino) {
        return true;
      }
      const parent = dirname(current);
      if (parent === current) {
        return placeWithin({ place, root });
      }
      current = parent;
    }
  } catch {
    return true;
  }
}

/**
 * Whether one already-resolved place lies at or below another, by path alone — the fallback for a root
 * that does not exist yet. A write is gated on {@link heldByIdentity}, which also catches two spellings.
 *
 * @param root the containing place, resolved with {@link realPlace}
 * @param place the candidate, resolved with {@link realPlace}
 * @returns true when the candidate is the root or below it
 */
export function placeWithin({ root, place }: { root: string; place: string }): boolean {
  const back = relative(root, place);
  // A whole `..` SEGMENT climbs out; a name merely starting with two dots (`..victim`) is a child.
  const climbsOut = back === ".." || back.startsWith(`..${sep}`);
  return !climbsOut && !isAbsolute(back);
}
