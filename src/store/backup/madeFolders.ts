/**
 * The folders a recursive mkdir made, and how to take them back.
 *
 * A destination on an external drive is made, then checked again: the drive could have been pulled between the
 * last check and the mkdir, leaving the folder on the boot disk where the drive's mount point was. A run that finds
 * that removes what it made — and only what it made, matched by device and inode, so neither what was already there
 * nor a folder another process put at the same path is ever removed.
 */
import { lstatSync, mkdirSync, rmdirSync } from "node:fs";
import { dirname } from "node:path";

import type { EntryIdentity } from "./realPlace.js";

/** A folder a run made, with the identity it had the moment it was made. */
export interface MadeFolder {
  readonly path: string;
  readonly identity: EntryIdentity;
}

/**
 * Make a root (0700) and every missing folder above it, and say which ones this call made.
 *
 * @param root the folder to make
 * @returns the folders this call made, deepest first — none when the root was already there
 * @throws when the folder cannot be made, exactly as `mkdirSync` does
 */
export function makeFolders({ root }: { root: string }): readonly MadeFolder[] {
  const first = mkdirSync(root, { mode: 0o700, recursive: true });
  return first === undefined ? [] : madeFolders({ first, root });
}

/**
 * Make a root, then ask again whether it is where it must be; when it is not, take back what was made.
 *
 * @param root the folder to make
 * @param stillHolds asked once the folder exists — whether it landed where it must
 * @returns the folders made, deepest first, or `null` when it did not hold and they were removed again
 * @throws when the folder cannot be made, exactly as `mkdirSync` does
 */
export function makeFoldersHeld({
  root,
  stillHolds,
}: {
  root: string;
  stillHolds: () => boolean;
}): readonly MadeFolder[] | null {
  const made = makeFolders({ root });
  if (stillHolds()) {
    return made;
  }
  removeMadeFolders({ made });
  return null;
}

/**
 * The folders a recursive mkdir made, read back right after it: from the root up to the first one it made.
 *
 * @param first what the recursive mkdir answered, the shallowest folder it made
 * @param root the deepest folder it made
 * @returns each made folder with its identity, deepest first; a folder already gone is left out, with every one
 *   above it
 */
export function madeFolders({ first, root }: { first: string; root: string }): readonly MadeFolder[] {
  const made: MadeFolder[] = [];
  let folder = root;
  for (;;) {
    const identity = folderIdentity({ path: folder });
    if (identity === null) {
      return made;
    }
    made.push({ identity, path: folder });
    if (folder === first || dirname(folder) === folder) {
      return made;
    }
    folder = dirname(folder);
  }
}

/**
 * A real folder's own identity, never a link's target's.
 *
 * @param path the folder to read
 * @returns its device and inode, or `null` when nothing, or something other than a folder, is there
 */
function folderIdentity({ path }: { path: string }): EntryIdentity | null {
  const stats = lstatSync(path, { throwIfNoEntry: false });
  if (stats === undefined || !stats.isDirectory()) {
    return null;
  }
  return { dev: stats.dev, ino: stats.ino };
}

/**
 * Remove the folders a run made, deepest first. A folder is removed only while it is still the very folder the run
 * made — same device and inode — AND empty; anything else stops the walk. The one window left is between that
 * identity read and the `rmdir` right after it, and what it could remove is an empty folder.
 *
 * @param made the folders the run made, deepest first, with the identities they had when made
 */
export function removeMadeFolders({ made }: { made: readonly MadeFolder[] }): void {
  for (const folder of made) {
    const now = folderIdentity({ path: folder.path });
    if (now === null || now.dev !== folder.identity.dev || now.ino !== folder.identity.ino) {
      return;
    }
    try {
      rmdirSync(folder.path);
    } catch {
      return;
    }
  }
}
