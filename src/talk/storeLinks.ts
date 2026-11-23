/**
 * Whether a file on this machine is a credential store's by filesystem identity, not by spelling — the aliases
 * `./localPath.ts` cannot see by comparing strings.
 *
 * - **Another spelling of the same directory.** macOS reaches every file on the Data volume under a second
 *   path too: `/System/Volumes/Data/Users/<account>/.slopweaver/secrets/x` is `~/.slopweaver/secrets/x`, and
 *   `realpath` keeps whichever prefix it was given. MEASURED in review: that spelling listed all
 *   39 entries of the real `~/.slopweaver/secrets` as readable. So {@link insideStoreByIdentity} compares the
 *   `(dev, ino)` of the resolved path and every directory above it against each store root's own.
 * - **A copy beside a store.** `hygiene-denylist.txt.bak-…` holds what the denylist held, lines since removed
 *   included, and `~/.netrc.old` what `~/.netrc` did. {@link besideStoreByIdentity} refuses a name that
 *   extends a store's own name in the same directory, and anything inside one, the directory compared by
 *   `(dev, ino)`.
 * - **A hard link.** It has no target to resolve: both names are the same inode, and neither is "the" path.
 *   {@link storeLinkIndex} walks the stores ONCE per call for every file with a second link, bounded, because a
 *   store such as `~/.kube` carries a cache; a bound that runs out answers "linked" for every hard-linked file
 *   rather than "clean": fail closed, the same way an unreadable denylist does. MEASURED (r4 review): walking
 *   per entry instead, a listing of 500 hard-linked files took 128 s against the voice's 20 s tool timeout.
 */
import { type BigIntStats, lstatSync, readdirSync, type Stats, statSync } from "node:fs";
import { basename, dirname, join } from "node:path";

import { appendAll } from "../lib/arrays.js";

import type { LocalRefusalRule } from "./localFileErrors.js";

/** The most store entries one index will stat before it stops and treats every hard link as a store's. */
const WALK_LIMIT = 50_000;

/**
 * Every store file with a second link, by `dev:ino`; `incomplete` when the walk hit its bound first or met a
 * store directory it could not read (r16 review: a hard link out of a mode-000 `~/.kube/private` read in clear).
 */
export interface StoreLinkIndex {
  readonly ids: ReadonlySet<string>;
  readonly incomplete: boolean;
}

/**
 * Which identity check refuses a resolved path — a hard link into a store, a path inside one, or a copy beside
 * one, however it is spelt — or `undefined` when none does.
 *
 * @param real the path already resolved by `realpath`
 * @param stores every credential store, file or directory
 * @param index the store link index, built on first use
 * @returns the rule that refuses it; `credential-store` too when it cannot be stat'd
 */
export function identityRule({
  real,
  stores,
  index,
}: {
  real: string;
  stores: readonly string[];
  index: () => StoreLinkIndex;
}): LocalRefusalRule | undefined {
  let stat: Stats;
  try {
    stat = lstatSync(real);
  } catch {
    return "credential-store";
  }
  if (linkedIntoStore({ index, stat })) {
    return "credential-link";
  }
  if (insideStoreByIdentity({ real, stores }) || besideStoreByIdentity({ real, stores })) {
    return "credential-store";
  }
  return undefined;
}

/**
 * Whether a resolved path is a store root or lies anywhere under one, compared by `(dev, ino)`.
 *
 * @param real the path already resolved by `realpath`, in whatever spelling it came back
 * @param stores every credential store, file or directory; a missing one is skipped
 * @returns true when the path or any directory above it is a store root, or when one of them cannot be stat'd
 */
export function insideStoreByIdentity({ real, stores }: { real: string; stores: readonly string[] }): boolean {
  const roots = new Set(stores.flatMap((store) => identityOf({ path: store })));
  if (roots.size === 0) {
    return false;
  }
  let path = real;
  for (;;) {
    const identity = identityOf({ path });
    if (identity.length === 0 || roots.has(identity[0]!)) {
      return true;
    }
    const parent = dirname(path);
    if (parent === path) {
      return false;
    }
    path = parent;
  }
}

/**
 * Whether a resolved path IS, or lies anywhere inside, a copy beside a store: a name in the store's own
 * directory that extends the store's — `secrets.bak`, `.netrc~`, `secrets copy` (Finder's Duplicate),
 * `hygiene-denylist.txt.pre-…` — the directory compared by `(dev, ino)`. Every directory above the path is
 * checked, because a copied store directory holds its files one level down (measured in review:
 * `secrets.old` itself was refused while `secrets.old/db-password` read in clear).
 *
 * @param real the path already resolved by `realpath`
 * @param stores every credential store, file or directory
 * @returns true when the path or a directory above it is such a copy
 */
export function besideStoreByIdentity({ real, stores }: { real: string; stores: readonly string[] }): boolean {
  const copies = stores.flatMap((store) => {
    const parent = identityOf({ path: dirname(store) });
    return parent.map((id) => ({ name: foldName({ path: store }), parent: id }));
  });
  let path = real;
  for (;;) {
    const parent = dirname(path);
    if (parent === path || copies.length === 0) {
      return false;
    }
    const name = foldName({ path });
    const named = copies.filter((copy) => extendsStoreName({ name, storeName: copy.name }));
    if (named.length > 0) {
      const id = identityOf({ path: parent });
      if (id.length > 0 && named.some((copy) => copy.parent === id[0])) {
        return true;
      }
    }
    path = parent;
  }
}

/** A path's last segment, folded for case and Unicode the way every store comparison is. */
function foldName({ path }: { path: string }): string {
  return basename(path).normalize("NFC").toLowerCase();
}

/**
 * Whether a name is a store's name plus a separator, a digit or `(` and anything after it — `secrets.old`,
 * `secrets copy`, and a duplicate's `secrets2` or `.netrc(1)` (r13).
 */
function extendsStoreName({ name, storeName }: { name: string; storeName: string }): boolean {
  return name.length > storeName.length && name.startsWith(storeName) && /[-._~ (0-9]/u.test(name[storeName.length]!);
}

/**
 * Every file with a second link inside any store, walked once and bounded.
 *
 * @param stores every credential store, file or directory
 * @returns the index a hard-linked candidate is looked up in
 */
export function storeLinkIndex({ stores }: { stores: readonly string[] }): StoreLinkIndex {
  const ids = new Set<string>();
  const pending = [...stores];
  let visited = 0;
  while (pending.length > 0) {
    const path = pending.pop()!;
    const [entry] = lstatOf({ path });
    if (entry === undefined) {
      continue;
    }
    visited += 1;
    if (visited > WALK_LIMIT || !indexEntry({ entry, ids, path, pending })) {
      return { ids, incomplete: true };
    }
  }
  return { ids, incomplete: false };
}

/** Index one walked entry: a file with a second link joins `ids`, a directory's children join `pending`. */
function indexEntry({
  entry,
  ids,
  path,
  pending,
}: {
  entry: Stats;
  ids: Set<string>;
  path: string;
  pending: string[];
}): boolean {
  if (entry.isFile() && entry.nlink > 1) {
    ids.add(linkKey({ stat: entry }));
  }
  if (!entry.isDirectory()) {
    return true;
  }
  const [children] = childrenOf({ dir: path });
  if (children === undefined) {
    return false;
  }
  appendAll({ from: children, into: pending });
  return true;
}

/**
 * Whether `stat` names the same inode as a file inside a store. Only a file with a second link can, so the
 * index is only asked for — and built — when one turns up.
 *
 * @param stat the candidate's own `lstat`
 * @param index the store index, built on first use and shared by every entry of one call
 * @returns true when a store holds the same inode, or the index ran out before it could say
 */
export function linkedIntoStore({ stat, index }: { stat: Stats; index: () => StoreLinkIndex }): boolean {
  if (!stat.isFile() || stat.nlink <= 1) {
    return false;
  }
  const built = index();
  return built.incomplete || built.ids.has(linkKey({ stat }));
}

/**
 * A {@link storeLinkIndex} built on first call and reused after, so one listing walks the stores once.
 *
 * @param stores every credential store, file or directory
 * @returns the memoised index
 */
export function lazyStoreLinkIndex({ stores }: { stores: readonly string[] }): () => StoreLinkIndex {
  let built: StoreLinkIndex | undefined;
  return () => {
    if (built !== undefined) {
      return built;
    }
    const index = storeLinkIndex({ stores });
    built = index;
    return index;
  };
}

/** A file's `dev:ino` from a number `Stats`, the key the index holds. */
function linkKey({ stat }: { stat: Stats }): string {
  return `${String(stat.dev)}:${String(stat.ino)}`;
}

/** A path's `dev:ino` after following links, exact as bigints; none when it cannot be stat'd. */
function identityOf({ path }: { path: string }): readonly string[] {
  let stat: BigIntStats;
  try {
    stat = statSync(path, { bigint: true });
  } catch {
    return [];
  }
  return [`${stat.dev.toString()}:${stat.ino.toString()}`];
}

/** A path's own `lstat`, wrapped in a one-element list; an empty list when it cannot be stat'd. */
function lstatOf({ path }: { path: string }): readonly Stats[] {
  try {
    return [lstatSync(path)];
  } catch {
    return [];
  }
}

/** A directory's children as paths, wrapped in a one-element list; an empty list when it cannot be read. */
function childrenOf({ dir }: { dir: string }): readonly (readonly string[])[] {
  try {
    return [readdirSync(dir).map((name) => join(dir, name))];
  } catch {
    return [];
  }
}
