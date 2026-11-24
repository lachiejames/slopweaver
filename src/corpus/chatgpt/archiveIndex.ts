/**
 * Which archive file on disk was already taken in as which held export — `<root>/archive-index.json` — so a scheduled
 * `chatgpt sync` with nothing new extracts nothing.
 *
 * **Why it exists.** Discovery finds every export zip in Downloads, and an export is recognised as
 * already held only by its content hash, which takes extracting, fsyncing and hashing every member. Kept exports would
 * make each daily no-op pass cost one whole history per zip the owner kept. The index answers "this file is unchanged since
 * it became export X" from the file's identity alone.
 *
 * **What makes a hit safe.** An entry binds the resolved path to the file's device, inode, size, and its modify AND
 * change times to the nanosecond. Any write to the file moves its change time, which no user-space call can set back,
 * so an entry matches only bytes that have not been written since they were hashed. A hit also needs that export to be
 * held still. A re-download is a new file with a new inode, so it misses and is taken in as ever — which is what keeps
 * its file time counting toward freshness (`exportFreshness.ts`). Only a regular file is indexed: a folder's own times
 * do not move when a member inside it is rewritten.
 *
 * A cache, not a record of truth: an index that will not read is reported and treated as empty, which costs one
 * full take-in pass and never a wrong answer.
 */
import { lstatSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { z } from "zod";
import { logger } from "#lib/logger.js";
import { err, ok, type Result } from "#lib/result.js";
import { writeFileAtomic } from "#lib/writeAtomic.js";

import type { OwnerProtectionResolver } from "../bronzeProtection.js";
import type { ChatgptArchiveDeps } from "./archive.js";
import { type ChatgptExportError, ChatgptExportErrors } from "./errors.js";
import { HASH_DIR, parseSmallJson } from "./exportReceipts.js";
import { type ImportOutcome, importChatgptExport } from "./exportStore.js";
import { fileIdentity, fileIdentitySchema, sameIdentity } from "./fileIdentity.js";

/** How many archives the index remembers; the oldest entry is dropped past it. */
const MAX_INDEX_ENTRIES = 200;

const indexSchema = z.strictObject({
  entries: z.array(
    z.strictObject({ contentHash: z.string().regex(HASH_DIR), evidence: fileIdentitySchema, path: z.string().min(1) }),
  ),
  schemaVersion: z.literal(1),
});

type IndexEntry = z.infer<typeof indexSchema>["entries"][number];

/** What taking one archive in did: recognised unchanged from the index, or read through the import. */
export type ArchiveTakeIn =
  | { readonly kind: "known"; readonly contentHash: string; readonly modifiedIso: string }
  | { readonly kind: "imported"; readonly outcome: ImportOutcome };

/** Where the index sits. */
function indexPath({ root }: { root: string }): string {
  return join(root, "archive-index.json");
}

/** Past this many bytes the file is not an index this writes ({@link MAX_INDEX_ENTRIES} entries of a few hundred). */
const MAX_INDEX_BYTES = MAX_INDEX_ENTRIES * 1024;

/** The index's entries; an absent index is empty, and an unreadable one is reported and read as empty. */
function readIndex({ root }: { root: string }): readonly IndexEntry[] {
  const path = indexPath({ root });
  let text: string;
  try {
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.size > MAX_INDEX_BYTES) {
      logger.error({ msg: `chatgpt: ${path} is not an index this writes, so every archive is taken in in full` });
      return [];
    }
    text = readFileSync(path, "utf8");
  } catch {
    // Absent before the first take-in; anything else costs one full pass, never a wrong hit.
    return [];
  }
  const parsed = indexSchema.safeParse(parseSmallJson({ text }));
  if (!parsed.success) {
    logger.error({ msg: `chatgpt: ${path} will not read, so every archive is taken in in full this pass` });
    return [];
  }
  return parsed.data.entries;
}

/**
 * Remember that the file at `path`, with this identity, is the held export `contentHash`. A failed write is reported
 * and the take-in stands: the export is held either way, and the next pass only takes the file in again.
 */
function remember({ root, entries, entry }: { root: string; entries: readonly IndexEntry[]; entry: IndexEntry }): void {
  const kept = [...entries.filter((existing) => existing.path !== entry.path), entry].slice(-MAX_INDEX_ENTRIES);
  const path = indexPath({ root });
  try {
    // Renamed into place, so a link planted at the path is replaced, never written through.
    writeFileAtomic({
      contents: `${JSON.stringify({ entries: kept, schemaVersion: 1 })}\n`,
      dirMode: 0o700,
      fileMode: 0o600,
      path,
    });
  } catch (cause) {
    logger.error({ msg: ChatgptExportErrors.exportStoreFailed({ cause, path }).message });
  }
}

/**
 * Take one archive in, unless the index already knows this exact unwritten file as an export still held.
 *
 * @param archive the process edges for a zip
 * @param from the archive file, folder or conversations file
 * @param nowIso the instant an import is stamped with
 * @param root the managed export root
 * @param heldHashes every export currently held, so a hit on one moved aside since is a miss
 * @param home the Slopweaver home whose protect registry the import judges against
 * @param protection an injected resolver, which a test supplies so it never reads the owner's own registry
 * @returns what was done, or why the import failed
 */
export function takeInArchive({
  archive,
  from,
  nowIso,
  root,
  heldHashes,
  home,
  protection,
}: {
  archive: ChatgptArchiveDeps;
  from: string;
  nowIso: string;
  root: string;
  heldHashes: ReadonlySet<string>;
  home: string;
  protection?: OwnerProtectionResolver | undefined;
}): Result<ArchiveTakeIn, ChatgptExportError> {
  const path = resolve(from);
  const before = fileIdentity({ path });
  if (before === undefined) {
    return importChatgptExport({ archive, from, home, nowIso, protection, root }).map((outcome) => ({
      kind: "imported" as const,
      outcome,
    }));
  }
  const entries = readIndex({ root });
  const known = entries.find((entry) => entry.path === path && sameIdentity({ a: entry.evidence, b: before }));
  if (known !== undefined && heldHashes.has(known.contentHash)) {
    // Not closed: a zip rewritten after this identity read is not re-read this pass. What this pass reads and
    // receipts is the held copy, hashed to its name; the rewritten zip carries a new identity, so the next sync
    // takes it in or refuses it by name. A second check here would only move the window, never shut it.
    return ok({ contentHash: known.contentHash, kind: "known", modifiedIso: before.modifiedIso });
  }
  const imported = importChatgptExport({ archive, from, home, nowIso, protection, root });
  if (imported.isErr()) {
    return err(imported.error);
  }
  const after = fileIdentity({ path });
  // Indexed only when the file did not change while it was read, so the hash is the hash of these exact bytes.
  if (after !== undefined && sameIdentity({ a: before, b: after })) {
    remember({ entries, entry: { contentHash: imported.value.stored.contentHash, evidence: before, path }, root });
  }
  return ok({ kind: "imported", outcome: imported.value });
}
