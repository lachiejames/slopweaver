/**
 * Is a path the file we meant, or a link to somewhere else?
 *
 * The medallion store's separations are LEXICAL: `corpus/history/`, `corpus/members/` and `corpus/structures/`
 * are siblings of `corpus/bronze/` because their computed paths are siblings, and the record reader recurses
 * `bronze/` only. That reasoning holds for the paths a program COMPUTES and says nothing about the paths a
 * filesystem RESOLVES.
 *
 * An adversarial review pass found the gap: make `corpus/history/linear.jsonl` a symlink to
 * `../bronze/linear/history.jsonl` and `appendFileSync` follows it, so activity events land under `bronze/` and
 * the record reader picks them up — the one thing the sibling-store design exists to prevent. The target may
 * even be absent, so nothing looks wrong on the way in.
 *
 * The threat model is narrow: it needs write access to `$SLOPWEAVER_HOME`, which already permits writing bronze
 * directly. So this is not a security boundary and is not sold as one. It is a way for a store to notice that
 * its own invariant has been broken rather than silently violating it — and the argument that every other store
 * shares the hole is a reason to give them all this helper, not a reason to leave one open.
 *
 * ## Where this stops, stated rather than left to be discovered
 *
 * Two aliases are detectable from a path and are checked: a symlink (`lstat` sees the link) and a hard link
 * (`nlink > 1` says a second name exists). Aliases the kernel applies BELOW the path layer are not, and cannot
 * be: a bind mount, an overlay or a FUSE filesystem can make two paths the same bytes with nothing about either
 * path indicating it. So the honest guarantee is about what this program COMPUTES and WRITES, not about what the
 * filesystem ultimately resolves. A caller wanting the stronger property needs the store on a filesystem it
 * controls, which is a deployment decision rather than a code one.
 */
import { lstatSync, realpathSync } from "node:fs";
import { basename, dirname, join, resolve, sep } from "node:path";

import { isNotFoundError } from "./presentFile.js";

/**
 * Whether `candidate` is `root` itself or sits underneath it. Pure — a string comparison over resolved paths,
 * so it is testable without a filesystem.
 *
 * Compares against `root + sep` rather than `root` alone, so a sibling whose name merely STARTS with the root's
 * (`/corpus/history-old` against `/corpus/history`) is correctly reported as outside.
 *
 * @param candidate the path to test
 * @param root the directory it must be within
 * @returns true when candidate is inside root
 */
export function isContained({ candidate, root }: { candidate: string; root: string }): boolean {
  const resolvedRoot = resolve(root);
  const resolvedCandidate = resolve(candidate);
  return resolvedCandidate === resolvedRoot || resolvedCandidate.startsWith(`${resolvedRoot}${sep}`);
}

/**
 * The reason `path` cannot be written as a file inside `root`, or `undefined` when it can.
 *
 * Two checks, because a link can be planted at either level. The LEAF is checked with `lstat`, which does not
 * follow, so an existing symlink is seen as a symlink rather than as its target. The DIRECTORY is checked by
 * comparing REAL paths.
 *
 * Both sides of that comparison are resolved, and getting this wrong is easy: on macOS `/var` is itself a
 * symlink to `/private/var`, so resolving only the candidate and not the root reports every path under a temp
 * directory as an escape. But the root is resolved via its PARENT plus its own final segment, never wholesale —
 * resolving the root itself would follow the very link this is trying to catch, and `history` pointing at
 * `bronze` would then compare equal to itself and pass.
 *
 * @param path the file the caller intends to write
 * @param root the directory it must resolve inside
 * @returns the refusal reason, or undefined when the path is contained
 */
export function containmentRefusal({ path, root }: { path: string; root: string }): string | undefined {
  const leaf = symlinkRefusal({ path });
  if (leaf !== undefined) {
    return leaf;
  }
  const parent = realParent({ path });
  if (parent === undefined) {
    // The directory does not exist yet, so the writer is about to create it at the computed path. Nothing to
    // resolve and nothing to escape through.
    return undefined;
  }
  const expected = expectedRoot({ root });
  return isContained({ candidate: parent, root: expected })
    ? undefined
    : `${path} resolves outside ${expected} (its directory is really ${parent}) — refusing to write there`;
}

/** The root as it should really be: its parent resolved, plus its own final segment unresolved. */
function expectedRoot({ root }: { root: string }): string {
  const resolved = resolve(root);
  try {
    return join(realpathSync(dirname(resolved)), basename(resolved));
  } catch {
    return resolved;
  }
}

/**
 * The refusal for a leaf that is an ALIAS for some other file — a symlink, or a hard link. Undefined otherwise.
 *
 * Both arms came from adversarial review, in that order: the symlink check was added, and the pass immediately
 * pointed out that a HARD link defeats it, because it shares an inode and `lstat` sees an ordinary file. Link
 * count catches that: this store creates its own files, so a second name for one is never legitimate here, and
 * `nlink > 1` means a second name exists.
 */
function symlinkRefusal({ path }: { path: string }): string | undefined {
  try {
    const stat = lstatSync(path);
    if (stat.isSymbolicLink()) {
      return (
        `${path} is a symlink — refusing to write through it, because the store's separation from bronze is ` +
        "the whole point of writing here rather than there"
      );
    }
    return stat.nlink > 1
      ? `${path} has ${String(stat.nlink)} names (a hard link) — refusing to write through it, because the ` +
          "other name may be under bronze/, where the record reader would pick these rows up"
      : undefined;
  } catch {
    // Absent is the normal first-write case, and says nothing about containment.
    return undefined;
  }
}

/** The real path of `path`'s directory, or undefined when it does not exist yet. */
function realParent({ path }: { path: string }): string | undefined {
  try {
    return realpathSync(dirname(path));
  } catch {
    return undefined;
  }
}

/**
 * The first entry strictly below `top`, on the way down to `path`, that is a symbolic link — or `undefined` when
 * none is. One that does not exist yet is not a link, and nothing below it can be either.
 *
 * The walk a content store runs before it writes or reads a blob, so a link planted at any hop between the state
 * home and the blob is refused rather than followed out of the owner-only store. `top` itself is never checked:
 * the home is the operator's to place, and may be a link.
 *
 * @param top the directory the walk stops at, exclusive
 * @param path the blob the walk starts from, inclusive
 * @returns the linked path, or `undefined`
 */
export function firstLinkedEntry({ top, path }: { top: string; path: string }): string | undefined {
  const entries: string[] = [];
  for (let entry = path; entry !== top && entry !== dirname(entry); entry = dirname(entry)) {
    entries.unshift(entry);
  }
  for (const entry of entries) {
    try {
      if (lstatSync(entry).isSymbolicLink()) {
        return entry;
      }
    } catch (error: unknown) {
      if (isNotFoundError({ error })) {
        return undefined;
      }
      // Anything but "not there" is reported by the read or write that follows, which names the path and cause.
    }
  }
  return undefined;
}
