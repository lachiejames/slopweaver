/**
 * Where a write to a path would really land, for the two overlap checks `codex plugin-sync` makes before it
 * writes: a Codex home against the export root (`./homes.ts`), and the marketplace's source path against the
 * marketplace file (`./marketplaceStore.ts`). A lexical `path.resolve` comparison misses an overlap reached
 * through a symlink — a parent directory that is a link, or a home that is a DANGLING link to a directory the
 * run is about to create — so both checks compare the paths these functions return.
 *
 * The residue, stated rather than discovered: a link created or retargeted between this read and the write it
 * guards is not seen, and a chain longer than {@link MAX_LINK_HOPS} is compared as it stands.
 */
import { existsSync, lstatSync, readlinkSync, realpathSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

/** The most links followed before a chain is compared as it stands, matching the usual `SYMLOOP_MAX`. */
const MAX_LINK_HOPS = 40;

/** True when `path` itself is a symbolic link, dangling or not. */
function isLink({ path }: { path: string }): boolean {
  return lstatSync(path, { throwIfNoEntry: false })?.isSymbolicLink() === true;
}

/** {@link landingPath}'s walk, counting the links followed so a cycle of dangling links ends. */
function landingPathAfter({ path, hops }: { path: string; hops: number }): string {
  if (existsSync(path)) {
    return realpathSync(path);
  }
  const parent = dirname(path);
  if (parent === path || hops >= MAX_LINK_HOPS) {
    return path;
  }
  if (isLink({ path })) {
    // A relative target is resolved against where the link really lives, never its lexical parent.
    const realParent = landingPathAfter({ hops, path: parent });
    return landingPathAfter({ hops: hops + 1, path: resolve(realParent, readlinkSync(path)) });
  }
  return join(landingPathAfter({ hops, path: parent }), basename(path));
}

/**
 * The real path `path` names, following every link — a dangling one included — and, where nothing exists yet,
 * the real path of its deepest existing ancestor with the rest appended. That is where `mkdir -p` would create it.
 *
 * @param path any absolute or relative path
 * @returns the path a write to `path` would land on
 */
export function landingPath({ path }: { path: string }): string {
  return landingPathAfter({ hops: 0, path: resolve(path) });
}

/**
 * The directory entry `path` names: its parent's {@link landingPath} with its own last component, the final link
 * NOT followed. That is the entry a rename onto `path` replaces.
 *
 * @param path any absolute or relative path
 * @returns the real location of the entry itself
 */
export function entryPath({ path }: { path: string }): string {
  const resolved = resolve(path);
  return join(landingPath({ path: dirname(resolved) }), basename(resolved));
}
