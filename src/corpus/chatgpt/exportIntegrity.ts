/**
 * Whether a held ChatGPT export is still the export that was taken in.
 *
 * A held export is named by the hash of its members (`exportStore.ts`), and that name is only a promise while the
 * bytes still hash to it. A member deleted, truncated, swapped for a link or rewritten after import would otherwise
 * be read — or, once receipted, not read at all — while `chatgpt sync` certified the corpus current off rows the
 * archive no longer backs. So two checks run on the read path, never only at import:
 *
 * - **Shape, on every listing** — the directory is named for its manifest's hash, and every declared member is a
 *   regular file (never a link) of exactly its declared size. A few `lstat` calls.
 * - **Content, on every pass** — the members re-hash to the directory's name, for EVERY held export, a receipted older
 *   one included. That is a full read, so `heldVerification.ts` skips an export whose members are unwritten since it
 *   last matched.
 */
import { createHash } from "node:crypto";
import { closeSync, lstatSync, openSync, readSync } from "node:fs";
import { basename, join } from "node:path";

import { err, ok, type Result } from "#lib/result.js";

import { type ChatgptExportError, ChatgptExportErrors } from "./errors.js";

/** Bytes read per chunk while hashing a member. */
const HASH_CHUNK = 1024 * 1024;

/** One member as a manifest declares it. */
interface DeclaredMember {
  readonly name: string;
  readonly bytes: number;
}

/**
 * Feed one file's bytes into a hash, a chunk at a time, so a member of any size is never one buffer.
 *
 * @param hash the running hash the bytes go into
 * @param path the file to read
 * @returns how many bytes it read
 */
export function hashFile({ hash, path }: { hash: ReturnType<typeof createHash>; path: string }): number {
  const fd = openSync(path, "r");
  const buffer = Buffer.alloc(HASH_CHUNK);
  let total = 0;
  try {
    for (;;) {
      const read = readSync(fd, buffer, 0, HASH_CHUNK, null);
      if (read === 0) {
        return total;
      }
      hash.update(buffer.subarray(0, read));
      total += read;
    }
  } finally {
    closeSync(fd);
  }
}

/** Why one declared member no longer stands as declared, or `undefined` when it does. */
function memberProblem({ directory, member }: { directory: string; member: DeclaredMember }): string | undefined {
  let stat: ReturnType<typeof lstatSync>;
  try {
    stat = lstatSync(join(directory, member.name));
  } catch (cause) {
    return `${member.name} cannot be read: ${cause instanceof Error ? cause.message : String(cause)}`;
  }
  if (!stat.isFile()) {
    return `${member.name} is not a regular file`;
  }
  if (stat.size !== member.bytes) {
    return `${member.name} is ${String(stat.size)} bytes, and the manifest declares ${String(member.bytes)}`;
  }
  return undefined;
}

/**
 * The cheap check: the directory is named for its manifest's hash, and every declared member is a regular file of
 * exactly its declared size.
 *
 * @param directory the held export's directory
 * @param contentHash the hash its manifest records
 * @param members the members its manifest declares
 * @returns nothing when it stands as declared, or what does not
 */
export function checkHeldShape({
  directory,
  contentHash,
  members,
}: {
  directory: string;
  contentHash: string;
  members: readonly DeclaredMember[];
}): Result<void, ChatgptExportError> {
  if (basename(directory) !== contentHash) {
    return err(
      ChatgptExportErrors.heldExportDamaged({ detail: `its manifest names the hash ${contentHash}`, directory }),
    );
  }
  for (const member of members) {
    const problem = memberProblem({ directory, member });
    if (problem !== undefined) {
      return err(ChatgptExportErrors.heldExportDamaged({ detail: problem, directory }));
    }
  }
  return ok(undefined);
}

/**
 * The content hash of a set of members: each name, a NUL, its bytes, a NUL, in reading order — the one definition
 * the import and every later check share.
 *
 * @param directory where the members are
 * @param names the members, in reading order
 * @returns the hex digest, and each member's byte count in the same order
 */
export function hashMembers({ directory, names }: { directory: string; names: readonly string[] }): {
  readonly contentHash: string;
  readonly bytes: readonly number[];
} {
  const hash = createHash("sha256");
  const bytes: number[] = [];
  for (const name of names) {
    hash.update(`${name}\0`);
    bytes.push(hashFile({ hash, path: join(directory, name) }));
    hash.update("\0");
  }
  return { bytes, contentHash: hash.digest("hex") };
}

/**
 * The full check: the members still hash to the directory's name. A full read of the export.
 *
 * @param directory the held export's directory, named by its content hash
 * @param files its members' paths, in reading order
 * @returns nothing when the bytes are the ones taken in, or what changed
 */
export function verifyHeldContent({
  directory,
  files,
}: {
  directory: string;
  files: readonly string[];
}): Result<void, ChatgptExportError> {
  let rehashed: string;
  try {
    rehashed = hashMembers({ directory, names: files.map((file) => basename(file)) }).contentHash;
  } catch (cause) {
    const detail = `a member cannot be read: ${cause instanceof Error ? cause.message : String(cause)}`;
    return err(ChatgptExportErrors.heldExportDamaged({ detail, directory }));
  }
  if (rehashed !== basename(directory)) {
    return err(
      ChatgptExportErrors.heldExportDamaged({
        detail: "its members no longer hash to its name, so their bytes changed after it was taken in",
        directory,
      }),
    );
  }
  return ok(undefined);
}
