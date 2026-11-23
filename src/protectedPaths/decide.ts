/**
 * Whether one access to one path is refused by the owner's protected-path registry — pure, no I/O.
 *
 * ## The rule
 *
 * - A WRITE is refused at or under any protected path, `read-only` and `no-access` alike.
 * - A READ is refused at or under a `no-access` path.
 * - A SEARCH (a `Grep`/`Glob` root, a recursive listing) is a read of everything beneath its root, so it is refused
 *   when its root is at or under a `no-access` path OR is an ANCESTOR of one: `Grep` over the home directory would
 *   read straight into it. Narrowing the root is the way past.
 * - A LIST (one directory's own entries, named by a walk that judges every child before it stats, follows or opens
 *   it) is refused only at or under a `no-access` path. It is never a hook's access: a `Grep`/`Glob` root is a
 *   search, because nothing judges what it reads beneath that root.
 *
 * ## Compared folded, by segment
 *
 * APFS ignores case by default, so `/X/Y` opens `/x/y`: every comparison folds case and Unicode normalisation, and
 * containment is by path SEGMENT, never by string prefix, so `/a/bc` is not inside `/a/b`. A caller that can resolve
 * a symlink passes both spellings; resolution here is lexical and never reads an inode.
 */
import { isAbsolute, normalize, relative, sep } from "node:path";

import type { ProtectedPath } from "./registry.js";

/**
 * What a caller is about to do with a path.
 *
 * `list` carries a PRECONDITION the type cannot: its caller judges every entry it lists, under each spelling, before
 * it stats, follows or opens one, and skips an entry the registry covers. A caller that lists without that judgement
 * asks `search`, which refuses an ancestor of a `no-access` path outright.
 */
export type PathAccess = "read" | "write" | "search" | "list";

/** Case- and normalisation-folded, so APFS's idea of "the same name" is this module's too. */
function fold({ path }: { path: string }): string {
  return normalize(path).normalize("NFC").toLowerCase();
}

/**
 * Whether `path` is `root` or lies under it, compared folded and by segment.
 *
 * @param path the candidate, absolute
 * @param root the protected path, absolute
 * @returns true when the candidate is the root or inside it
 */
export function isAtOrUnder({ path, root }: { path: string; root: string }): boolean {
  const within = relative(fold({ path: root }), fold({ path }));
  if (within === "") {
    return true;
  }
  return !(within === ".." || within.startsWith(`..${sep}`) || isAbsolute(within));
}

/**
 * The protected entry one access reaches, or `undefined` when the registry allows it.
 *
 * @param target the absolute path the access names — a relative one is never judged, since this cannot know its base
 * @param access read, write, search, or a judged walk's list
 * @param entries the registry's entries
 * @returns the first entry that refuses the access
 */
export function protectionHit({
  target,
  access,
  entries,
}: {
  target: string;
  access: PathAccess;
  entries: readonly ProtectedPath[];
}): ProtectedPath | undefined {
  if (!isAbsolute(target)) {
    return undefined;
  }
  return entries.find((entry) => {
    if (access === "write") {
      return isAtOrUnder({ path: target, root: entry.path });
    }
    if (entry.mode !== "no-access") {
      return false;
    }
    if (access === "search") {
      return isAtOrUnder({ path: target, root: entry.path }) || isAtOrUnder({ path: entry.path, root: target });
    }
    return isAtOrUnder({ path: target, root: entry.path });
  });
}

/**
 * The first entry any spelling of one access reaches — the path as asked and the path it resolves to.
 *
 * @param targets every spelling of the same path
 * @param access read, write, search, or a judged walk's list
 * @param entries the registry's entries
 * @returns the first entry that refuses it, or `undefined`
 */
export function protectionHitAny({
  targets,
  access,
  entries,
}: {
  targets: readonly string[];
  access: PathAccess;
  entries: readonly ProtectedPath[];
}): ProtectedPath | undefined {
  for (const target of targets) {
    const hit = protectionHit({ access, entries, target });
    if (hit !== undefined) {
      return hit;
    }
  }
  return undefined;
}
