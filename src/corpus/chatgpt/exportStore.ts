/**
 * The managed copy of every ChatGPT export taken in, under `CorpusPaths.chatgptExports`.
 *
 * ```text
 * <root>/<sha256>/manifest.json            what was taken in, when, and from which members
 * <root>/<sha256>/conversations*.json      the conversations files, byte for byte
 * <root>/receipts/<sha256>.json            written only once refresh AND the store took that export whole
 * ```
 *
 * **Named by content, not by archive.** The hash covers the sorted member names and their bytes, never the zip
 * container, so the same export re-zipped or downloaded twice is one directory and a second import is a no-op.
 *
 * **Atomic.** Members are copied into a staging directory beside the final one and renamed into place only once
 * every byte and the manifest are on disk, so a crash mid-copy leaves a staging directory nothing reads rather
 * than a half export that looks whole.
 *
 * **Private.** Directories are `0700` and files `0600`: this is the owner's own words to an assistant.
 *
 * **Ordered by content.** The newest export is the one whose conversations run latest (`exportFreshness.ts`), never
 * the one taken in last, and a held export is checked against its manifest every time it is listed
 * (`exportIntegrity.ts`).
 *
 * Where members are read from is `exportSource.ts`'s; the receipts are `exportReceipts.ts`'s.
 */
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
} from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { err, ok, type Result } from "#lib/result.js";
import { createFileExclusive, fsyncFile, renameStagedFile } from "#lib/writeAtomic.js";

import { type ChatgptArchiveDeps, CONVERSATIONS_FILE } from "./archive.js";
import { type ChatgptExportError, ChatgptExportErrors } from "./errors.js";
import { orderByChronology } from "./exportChronology.js";
import { latestActivityIso } from "./exportFreshness.js";
import { checkHeldShape, hashMembers } from "./exportIntegrity.js";
import { HASH_DIR, parseSmallJson } from "./exportReceipts.js";
import {
  type MemberSource,
  resolveMemberSource,
  acquiredAtIso as sourceAcquiredAtIso,
  stageMember,
  stagingBudgetBytes,
} from "./exportSource.js";
import { damagedHeldExports } from "./heldVerification.js";

const manifestSchema = z.strictObject({
  acquiredAtIso: z.string().min(1),
  contentHash: z.string().regex(HASH_DIR),
  importedAtIso: z.string(),
  latestActivityIso: z.string().nullable(),
  members: z
    .array(z.strictObject({ bytes: z.number().int().nonnegative(), name: z.string().regex(CONVERSATIONS_FILE) }))
    .min(1),
  schemaVersion: z.literal(1),
});

/** One export as the store holds it. */
export interface StoredExport {
  readonly contentHash: string;
  readonly directory: string;
  readonly importedAtIso: string;
  /**
   * When the owner came by it, from the file it was taken in from (`exportSource.ts#acquiredAtIso`) — the freshness floor and
   * the tie-break between two exports whose chats run equally late, where the import time is neither.
   */
  readonly acquiredAtIso: string;
  /** The newest instant on any conversation it holds — its chronology; `null` when none carries one. */
  readonly latestActivityIso: string | null;
  /** The conversations files' paths, in reading order. */
  readonly files: readonly string[];
}

/** What one import did. */
export interface ImportOutcome {
  readonly stored: StoredExport;
  /** False when this exact export was already held — nothing was written. */
  readonly fresh: boolean;
}

/** Read and validate one export's manifest. */
function readManifest({
  directory,
}: {
  directory: string;
}): Result<z.infer<typeof manifestSchema>, ChatgptExportError> {
  let text: string;
  try {
    text = readFileSync(join(directory, "manifest.json"), "utf8");
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    return err(ChatgptExportErrors.manifestUnreadable({ detail, directory }));
  }
  const parsed = manifestSchema.safeParse(parseSmallJson({ text }));
  if (!parsed.success) {
    return err(ChatgptExportErrors.manifestUnreadable({ detail: parsed.error.message, directory }));
  }
  return ok(parsed.data);
}

/** A held export, from its directory, refused when it no longer stands as its manifest declares. */
function storedFrom({ directory }: { directory: string }): Result<StoredExport, ChatgptExportError> {
  const manifest = readManifest({ directory });
  if (manifest.isErr()) {
    return err(manifest.error);
  }
  const { contentHash, importedAtIso, members } = manifest.value;
  const shape = checkHeldShape({ contentHash, directory, members });
  if (shape.isErr()) {
    return err(shape.error);
  }
  return ok({
    acquiredAtIso: manifest.value.acquiredAtIso,
    contentHash,
    directory,
    files: members.map((member) => join(directory, member.name)),
    importedAtIso,
    latestActivityIso: manifest.value.latestActivityIso,
  });
}

/**
 * Take one export in: copy its conversations files under `root`, named by content.
 *
 * @param from a zip, an unzipped export directory, or one conversations file
 * @param root the managed export root (`CorpusPaths.chatgptExports`)
 * @param nowIso the instant recorded as the import time
 * @param archive the process edges for a zip
 * @returns the stored export and whether it was new, or why it could not be taken in
 */
export function importChatgptExport({
  from,
  root,
  nowIso,
  archive,
}: {
  from: string;
  root: string;
  nowIso: string;
  archive: ChatgptArchiveDeps;
}): Result<ImportOutcome, ChatgptExportError> {
  const source = resolveMemberSource({ archive, from });
  if (source.isErr()) {
    return err(source.error);
  }
  const acquired = sourceAcquiredAtIso({ nowIso, source: source.value });
  if (acquired.isErr()) {
    return err(acquired.error);
  }
  let staging: string;
  try {
    mkdirSync(root, { mode: 0o700, recursive: true });
    // A symbolic link standing at the root would carry every write below it out of the home, so it is refused
    // rather than followed.
    if (lstatSync(root).isSymbolicLink()) {
      return err(
        ChatgptExportErrors.exportStoreFailed({
          cause: new Error("the export root is a symbolic link, and an export is never written through one"),
          path: root,
        }),
      );
    }
    chmodSync(root, 0o700);
    staging = mkdtempSync(join(root, ".staging-"));
  } catch (cause) {
    return err(ChatgptExportErrors.exportStoreFailed({ cause, path: root }));
  }
  const staged = stageAndPublish({
    acquiredAtIso: acquired.value,
    archive,
    nowIso,
    root,
    source: source.value,
    staging,
  });
  rmSync(staging, { force: true, recursive: true });
  return staged;
}

/** Copy every member into staging, flushed to the device, then hash names and bytes and date the export. */
function stageMembers({
  source,
  staging,
  archive,
}: {
  source: MemberSource;
  staging: string;
  archive: ChatgptArchiveDeps;
}): Result<
  {
    readonly contentHash: string;
    readonly members: readonly { name: string; bytes: number }[];
    readonly latestActivityIso: string | null;
  },
  ChatgptExportError
> {
  const names = source.members.map((member) => member.name);
  // One budget for the whole export, spent member by member, so a run of many files is held to it as one file is.
  const budget = stagingBudgetBytes({ dir: staging });
  if (budget.isErr()) {
    return err(budget.error);
  }
  let left = budget.value;
  for (const member of source.members) {
    const toPath = join(staging, member.name);
    const staged = stageMember({ archive, maxBytes: left, member, source, toPath });
    if (staged.isErr()) {
      return err(staged.error);
    }
    try {
      fsyncFile({ path: toPath });
      left -= statSync(toPath).size;
    } catch (cause) {
      return err(ChatgptExportErrors.exportStoreFailed({ cause, path: toPath }));
    }
  }
  try {
    const { bytes, contentHash } = hashMembers({ directory: staging, names });
    const members = names.map((name, index) => ({ bytes: bytes[index]!, name }));
    const files = names.map((name) => join(staging, name));
    return ok({ contentHash, latestActivityIso: latestActivityIso({ files }), members });
  } catch (cause) {
    return err(ChatgptExportErrors.exportStoreFailed({ cause, path: staging }));
  }
}

/** Copy, hash, write the manifest and rename into place — the staging directory is the caller's to remove. */
function stageAndPublish({
  acquiredAtIso,
  source,
  staging,
  root,
  nowIso,
  archive,
}: {
  acquiredAtIso: string;
  source: MemberSource;
  staging: string;
  root: string;
  nowIso: string;
  archive: ChatgptArchiveDeps;
}): Result<ImportOutcome, ChatgptExportError> {
  const staged = stageMembers({ archive, source, staging });
  if (staged.isErr()) {
    return err(staged.error);
  }
  const { contentHash, members } = staged.value;
  const target = join(root, contentHash);
  if (existsSync(target)) {
    return storedOutcome({ directory: target, fresh: false });
  }
  const manifest = JSON.stringify(
    {
      acquiredAtIso,
      contentHash,
      importedAtIso: nowIso,
      latestActivityIso: staged.value.latestActivityIso,
      members,
      schemaVersion: 1,
    },
    null,
    2,
  );
  try {
    const manifestPath = join(staging, "manifest.json");
    createFileExclusive({ contents: `${manifest}\n`, path: manifestPath });
    chmodSync(manifestPath, 0o600);
    renameStagedFile({ flushDirectory: true, from: staging, to: target });
  } catch (cause) {
    // Another import of the same export won the rename: the export is held, which is what was asked for.
    if (existsSync(target)) {
      return storedOutcome({ directory: target, fresh: false });
    }
    return err(ChatgptExportErrors.exportStoreFailed({ cause, path: target }));
  }
  return storedOutcome({ directory: target, fresh: true });
}

/** An import's outcome, read back from the directory it left. */
function storedOutcome({
  directory,
  fresh,
}: {
  directory: string;
  fresh: boolean;
}): Result<ImportOutcome, ChatgptExportError> {
  return storedFrom({ directory }).map((stored) => ({ fresh, stored }));
}

/**
 * Every held export, the newest snapshot first (`exportChronology.ts`).
 *
 * @param root the managed export root
 * @returns the exports that stand as their manifests declare, and a line naming each one that does not
 */
export function heldExports({ root }: { root: string }): {
  readonly exports: readonly StoredExport[];
  readonly unreadable: readonly string[];
} {
  if (!existsSync(root)) {
    return { exports: [], unreadable: [] };
  }
  const exports: StoredExport[] = [];
  const unreadable: string[] = [];
  for (const entry of readdirSync(root)) {
    if (!HASH_DIR.test(entry)) {
      continue;
    }
    const stored = storedFrom({ directory: join(root, entry) });
    if (stored.isErr()) {
      unreadable.push(stored.error.message);
      continue;
    }
    exports.push(stored.value);
  }
  return { exports: orderByChronology({ exports }), unreadable };
}

/**
 * The exports a refresh reads: every held one, newest snapshot first, receipted or not.
 *
 * An export is a snapshot of the owner's account, so a chat deleted before a later export exists only in the earlier one,
 * and no one instant orders two snapshots for every chat they share. So the ingest weighs every held export's version
 * of each conversation and writes the latest (`conversationMerge.ts`); leaving a receipted one out would let an older
 * copy win the chats only it and the export being read share. A receipt says what `chatgpt sync` still owes a
 * refresh, never what a refresh may skip.
 *
 * A held export that will not read, or no longer matches what was taken in, refuses the whole read rather than being
 * passed over: the store's older rows would otherwise stand in for an archive that is no longer there. EVERY held
 * export's bytes are checked against its name, a receipted one read no more included (`heldVerification.ts`).
 *
 * @param root the managed export root
 * @returns the exports to read, or the refusal naming the owner's step when none is held or one will not read
 */
export function exportsToRead({ root }: { root: string }): Result<readonly StoredExport[], ChatgptExportError> {
  const held = verifiedHeldExports({ root });
  if (held.isErr()) {
    return err(held.error);
  }
  if (held.value.length === 0) {
    return err(ChatgptExportErrors.noImportedExport());
  }
  return ok(held.value);
}

/**
 * Every held export, newest first, refused whole when any one will not read or no longer hashes to its name.
 *
 * @param root the managed export root
 * @returns the held exports — empty when none is — or the refusal naming each one that does not stand
 */
export function verifiedHeldExports({ root }: { root: string }): Result<readonly StoredExport[], ChatgptExportError> {
  const { exports: held, unreadable } = heldExports({ root });
  if (unreadable.length > 0) {
    return err(ChatgptExportErrors.heldExportUnreadable({ root, unreadable }));
  }
  const damaged = damagedHeldExports({ held, root });
  if (damaged.length > 0) {
    return err(ChatgptExportErrors.heldExportUnreadable({ root, unreadable: damaged }));
  }
  return ok(held);
}
