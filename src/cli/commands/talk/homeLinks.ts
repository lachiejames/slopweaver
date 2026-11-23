/**
 * Whether a home a console that is not the owner's names could carry a write into the owner's: any symlink, or any file with a
 * second hard link, anywhere under the trees the write touches.
 *
 * Why the whole tree rather than the paths a write names: a `talk transcript` appends the call
 * file, then the call index, the card-landing ledger, the sweep marks and the handover docs a landing writes, and each
 * pass found the next one a path list had missed. A witness home is a fresh directory that holds no link, so refusing
 * every link costs a witness nothing and leaves no write site to enumerate.
 */
import { type Dirent, lstatSync, readdirSync } from "node:fs";
import { join } from "node:path";

/** How many entries a vet walks before it stops and refuses: a witness home holds a handful, never this many. */
export const MAX_VETTED_ENTRIES = 20_000;

/**
 * The first link under any of `roots` that could carry a write elsewhere, or why the roots could not be vetted, or
 * `undefined` when none holds one. A root that does not exist yet holds nothing.
 *
 * @param roots the directories a write lands under
 * @param cap how many entries to walk before refusing as too many to vet
 * @returns what was found, as the refusal names it, or `undefined`
 */
export function homeLinkFault({ roots, cap }: { roots: readonly string[]; cap: number }): string | undefined {
  const pending = [...roots];
  let walked = 0;
  for (let dir = pending.pop(); dir !== undefined; dir = pending.pop()) {
    const listing = listed({ dir });
    if (typeof listing === "string") {
      return listing;
    }
    walked += listing.length;
    if (walked > cap) {
      return `more than ${String(cap)} entries under ${roots.join(", ")}, too many to vet for links`;
    }
    const fault = listingFault({ dir, entries: listing, pending });
    if (fault !== undefined) {
      return fault;
    }
  }
  return undefined;
}

/**
 * One directory's entries, none when it does not exist yet, or why it could not be read.
 *
 * @param dir the directory
 * @returns its entries, or the refusal
 */
function listed({ dir }: { dir: string }): Dirent[] | string {
  try {
    return readdirSync(dir, { withFileTypes: true });
  } catch (error) {
    if (isNotFound({ error })) {
      return [];
    }
    return `${dir} could not be read to vet it for links`;
  }
}

/**
 * The first entry of one directory that could carry a write elsewhere, queueing each subdirectory to walk.
 *
 * @param dir the directory listed
 * @param entries what it holds
 * @param pending the directories still to walk, which each subdirectory joins
 * @returns what was found, or `undefined`
 */
function listingFault({
  dir,
  entries,
  pending,
}: {
  dir: string;
  entries: readonly Dirent[];
  pending: string[];
}): string | undefined {
  for (const entry of entries) {
    const path = join(dir, entry.name);
    const fault = entryFault({ entry, path });
    if (fault !== undefined) {
      return fault;
    }
    if (entry.isDirectory()) {
      pending.push(path);
    }
  }
  return undefined;
}

/**
 * Why one entry could carry a write elsewhere, or `undefined` when it cannot.
 *
 * @param path the entry's path
 * @param entry the entry as the directory listed it
 * @returns what was found, or `undefined`
 */
function entryFault({ path, entry }: { path: string; entry: Dirent }): string | undefined {
  if (entry.isSymbolicLink()) {
    return `${path} is a symlink`;
  }
  if (!entry.isFile()) {
    return undefined;
  }
  try {
    if (lstatSync(path).nlink > 1) {
      return `${path} has a second hard link`;
    }
  } catch {
    return `${path} could not be read to vet it for links`;
  }
  return undefined;
}

/**
 * Whether a thrown filesystem error is a missing path.
 *
 * @param error what was thrown
 * @returns whether it is ENOENT
 */
function isNotFound({ error }: { error: unknown }): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
