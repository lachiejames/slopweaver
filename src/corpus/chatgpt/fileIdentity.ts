/**
 * A regular file's identity — device, inode, size, and its modify AND change times to the nanosecond — the one
 * definition the archive index (`archiveIndex.ts`) and the verified index (`heldVerification.ts`) both match on.
 *
 * **What a match proves.** Any write to a file moves its change time, which no user-space call can set back, so two
 * equal identities read at two moments are the same bytes, unwritten between them. A copy or a re-download is a new
 * inode. That is what lets a cache skip a full re-read of a file it hashed before, and nothing weaker would.
 */
import { statSync } from "node:fs";

import { z } from "zod";

/** The identity as it is stored: every number a decimal string, so a nanosecond survives JSON. */
export const fileIdentitySchema = z.strictObject({
  ctimeNs: z.string().min(1),
  dev: z.string().min(1),
  ino: z.string().min(1),
  /** The file time freshness counts from, carried so a hit needs no second stat. */
  modifiedIso: z.string().min(1),
  mtimeNs: z.string().min(1),
  size: z.string().min(1),
});

/** One file's identity. */
export type FileIdentity = z.infer<typeof fileIdentitySchema>;

/**
 * A regular file's identity, following a link at the path — the caller decides whether a link may stand there.
 *
 * @param path the file
 * @returns its identity, or `undefined` for anything but a regular file, or a path that will not stat
 */
export function fileIdentity({ path }: { path: string }): FileIdentity | undefined {
  try {
    const stat = statSync(path, { bigint: true });
    if (!stat.isFile()) {
      return undefined;
    }
    return {
      ctimeNs: stat.ctimeNs.toString(),
      dev: stat.dev.toString(),
      ino: stat.ino.toString(),
      modifiedIso: stat.mtime.toISOString(),
      mtimeNs: stat.mtimeNs.toString(),
      size: stat.size.toString(),
    };
  } catch {
    return undefined;
  }
}

/**
 * Whether two identities are the same unwritten file. Pure.
 *
 * @param a one identity
 * @param b the other
 * @returns true when every field a write would move is equal
 */
export function sameIdentity({ a, b }: { a: FileIdentity; b: FileIdentity }): boolean {
  return a.ctimeNs === b.ctimeNs && a.dev === b.dev && a.ino === b.ino && a.mtimeNs === b.mtimeNs && a.size === b.size;
}
