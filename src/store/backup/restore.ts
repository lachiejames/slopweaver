/**
 * The other direction's second half: replaying a verified backup directory into a database, the storage volume
 * and Vault. Resolving `--from`, fetching and verifying it is `./restoreSource.ts`.
 *
 * Split from `./run.ts` because the two halves share only the manifest shapes — a backup writes and
 * uploads, a restore fetches and replays — and one file holding both grew past the size at which a reader
 * holds it in their head.
 */
import { join } from "node:path";

import { err, ok, type Result } from "#lib/result.js";

import { type BackupError, BackupErrors, backupErrorLines } from "./errors.js";
import { BACKUP_FILES, type BackupManifest, supabaseContainer } from "./plan.js";
import {
  type CountComparison,
  compareCounts,
  type RestoreMode,
  restoreModeFor,
  type TableCount,
} from "./restorePlan.js";
import { type RestoreSource, verifyBackupDirectory } from "./restoreSource.js";
import type { digestFile, listArchive, untarStorage } from "./stack.js";
import type {
  createDatabase,
  createExtension,
  databaseExists,
  dropDatabase,
  restoreDatabase,
  targetShape,
} from "./stackDatabase.js";
import type { restoreVault } from "./vault.js";

/** What a restore did. */
export interface RestoreReport {
  readonly source: RestoreSource;
  readonly manifest: BackupManifest;
  readonly database: string;
  /** Whether the target was created here or was a fresh-stack database that already stood. */
  readonly mode: RestoreMode;
  readonly created: boolean;
  readonly storageMembers: readonly string[];
  readonly storageRestored: boolean;
  readonly comparison: CountComparison | null;
  readonly dropped: boolean;
  /** How many Vault secrets were re-created, or `null` for a backup that carried no Vault leg. */
  readonly vaultRows: number | null;
}

/** The effects a restore runs through. */
export interface RestoreDeps {
  readonly databaseExists: typeof databaseExists;
  readonly targetShape: typeof targetShape;
  readonly createDatabase: typeof createDatabase;
  readonly createExtension: typeof createExtension;
  readonly dropDatabase: typeof dropDatabase;
  readonly restoreDatabase: typeof restoreDatabase;
  readonly untarStorage: typeof untarStorage;
  readonly listArchive: typeof listArchive;
  readonly digestFile: typeof digestFile;
  readonly restoreVault: typeof restoreVault;
  /** Count every table's rows in one database, by connection string. */
  readonly tableCounts: (args: { url: string }) => Promise<Result<readonly TableCount[], BackupError>>;
}

/**
 * Restore a verified backup into a fresh database, optionally compare it to the live one, optionally
 * unpack the storage bytes, and optionally drop the copy again.
 *
 * The database is created HERE and refused if it already exists — a restore never writes into a database
 * that has anything in it, which is what makes `--into` safe to type against the live stack.
 *
 * @param source where the three files are
 * @param database the database to create and restore into
 * @param liveUrl the store selection, for the comparison, or `null` to skip it
 * @param restoredUrl the connection string for the restored database, for the comparison
 * @param restoreStorage whether to unpack the storage tar into the LIVE storage volume
 * @param dropAfter whether to drop the restored database once reported on
 * @param key the backup key `vault.enc` is opened with, or `null` when none was read
 * @param deps the stack effects
 * @returns the report, or every reason the restore stopped
 */
export async function runRestore({
  source,
  database,
  liveUrl,
  restoredUrl,
  restoreStorage,
  dropAfter,
  key,
  deps,
}: {
  source: RestoreSource;
  database: string;
  liveUrl: string | null;
  restoredUrl: string;
  restoreStorage: boolean;
  dropAfter: boolean;
  key: Buffer | null;
  deps: RestoreDeps;
}): Promise<Result<RestoreReport, BackupError>> {
  const manifest = verifiedManifest({ deps, directory: source.directory, key });
  if (manifest.isErr()) {
    return err(manifest.error);
  }
  const target = await restoreDumpAndVault({
    database,
    deps,
    directory: source.directory,
    key,
    manifest: manifest.value,
  });
  if (target.isErr()) {
    return err(target.error);
  }
  const storage = restoreStorageHalf({ deps, directory: source.directory, unpack: restoreStorage });
  if (storage.isErr()) {
    return err(storage.error);
  }
  const comparison = await compareToLive({ deps, liveUrl, restoredUrl });
  if (comparison.isErr()) {
    return err(comparison.error);
  }
  const dropped = dropAfter ? deps.dropDatabase({ database }) : ok(undefined);
  if (dropped.isErr()) {
    return err(dropped.error);
  }
  return ok({
    comparison: comparison.value,
    created: target.value.created,
    database,
    dropped: dropAfter,
    manifest: manifest.value,
    mode: target.value.mode,
    source,
    storageMembers: storage.value,
    storageRestored: restoreStorage,
    vaultRows: target.value.vaultRows,
  });
}

/**
 * Verify a backup directory against its manifest, and refuse — before anything is written — a Vault leg there is
 * no key to open, which would otherwise leave a restore missing its secrets.
 *
 * @param directory the backup directory
 * @param key the backup key, or `null` when none was read
 * @param deps the stack effects
 * @returns the verified manifest, or why it did not verify or cannot be opened
 */
function verifiedManifest({
  directory,
  key,
  deps,
}: {
  directory: string;
  key: Buffer | null;
  deps: RestoreDeps;
}): Result<BackupManifest, BackupError> {
  const manifest = verifyBackupDirectory({ digest: deps.digestFile, directory });
  if (manifest.isErr()) {
    return err(manifest.error);
  }
  if (manifest.value.vault !== null && key === null) {
    const why = `this backup's Vault leg is sealed under backup key ${manifest.value.vault.keyFingerprint}, and no backup key was read`;
    return err(BackupErrors.stepFailed({ reasons: [why] }));
  }
  return ok(manifest.value);
}

/**
 * Prepare the target database, replay the dump into it, then the Vault leg on top of it.
 *
 * @param database the database to create (or reuse, when empty) and restore into
 * @param directory the verified backup directory
 * @param manifest its manifest
 * @param key the backup key, or `null` for a backup with no Vault leg
 * @param deps the stack effects
 * @returns how the dump was replayed, whether the database was created, how many Vault secrets were re-created
 *   (`null` for none carried), or the first step that failed
 */
async function restoreDumpAndVault({
  database,
  directory,
  manifest,
  key,
  deps,
}: {
  database: string;
  directory: string;
  manifest: BackupManifest;
  key: Buffer | null;
  deps: RestoreDeps;
}): Promise<Result<{ mode: RestoreMode; created: boolean; vaultRows: number | null }, BackupError>> {
  const target = prepareTarget({ database, deps, manifest });
  if (target.isErr()) {
    return err(target.error);
  }
  const { mode, created } = target.value;
  const restored = deps.restoreDatabase({ database, mode, path: join(directory, BACKUP_FILES.dump) });
  if (restored.isErr()) {
    return err(restored.error);
  }
  const vaultRows = await restoreVaultHalf({ database, deps, directory, key, manifest });
  if (vaultRows.isErr()) {
    return err(vaultRows.error);
  }
  return ok({ created, mode, vaultRows: vaultRows.value });
}

/**
 * Re-create the Vault leg's secrets in the restored database, when the backup carried one.
 *
 * @param database the restored database
 * @param directory the verified backup directory
 * @param manifest its manifest
 * @param key the backup key, already required non-null when the manifest records a Vault leg
 * @param deps the stack effects
 * @returns how many secrets were re-created, `null` for a backup with no Vault leg, or why the import failed
 */
async function restoreVaultHalf({
  database,
  directory,
  manifest,
  key,
  deps,
}: {
  database: string;
  directory: string;
  manifest: BackupManifest;
  key: Buffer | null;
  deps: RestoreDeps;
}): Promise<Result<number | null, BackupError>> {
  const artefact = manifest.vault;
  if (artefact === null || key === null) {
    return ok(null);
  }
  const container = supabaseContainer({ service: "db" });
  const imported = await deps.restoreVault({ artefact, container, database, directory, key });
  if (imported.isErr()) {
    return err(BackupErrors.stepFailed({ reasons: [imported.error.message] }));
  }
  return ok(artefact.rows);
}

/**
 * Make the target ready: create it when it is not there, decide which restore shape it needs, and put back
 * the extensions a schema-scoped dump does not carry.
 *
 * @param database the target
 * @param manifest the backup being restored, whose extensions are re-created here
 * @param deps the stack effects
 * @returns the mode and whether this call created the database, or why it cannot be restored into
 */
function prepareTarget({
  database,
  manifest,
  deps,
}: {
  database: string;
  manifest: BackupManifest;
  deps: RestoreDeps;
}): Result<{ mode: RestoreMode; created: boolean }, BackupError> {
  const exists = deps.databaseExists({ database });
  if (exists.isErr()) {
    return err(exists.error);
  }
  let created = false;
  if (!exists.value) {
    const made = deps.createDatabase({ database });
    if (made.isErr()) {
      return err(made.error);
    }
    created = true;
  }
  const shape = deps.targetShape({ database });
  if (shape.isErr()) {
    return err(shape.error);
  }
  const mode = restoreModeFor(shape.value);
  if (mode.isErr()) {
    return err(mode.error);
  }
  for (const extension of manifest.extensions) {
    const made = deps.createExtension({ database, extension });
    if (made.isErr()) {
      return err(made.error);
    }
  }
  return ok({ created, mode: mode.value });
}

/**
 * Read what the storage tar carries, and unpack it over the live volume when that was asked for.
 *
 * The listing happens either way: a restore that did not unpack still reports what it could have.
 *
 * @param directory the backup directory holding the tar
 * @param unpack whether to write it into the live Storage volume
 * @param deps the stack effects
 * @returns the archive's members, or why the tar could not be read or written
 */
function restoreStorageHalf({
  directory,
  unpack,
  deps,
}: {
  directory: string;
  unpack: boolean;
  deps: RestoreDeps;
}): Result<readonly string[], BackupError> {
  const path = join(directory, BACKUP_FILES.storage);
  const members = deps.listArchive({ path });
  if (members.isErr() || !unpack) {
    return members;
  }
  const unpacked = deps.untarStorage({ path });
  return unpacked.isErr() ? err(unpacked.error) : members;
}

/**
 * Count both databases and compare them, when a live one was named.
 *
 * @param liveUrl the store selection, or `null` to skip the comparison entirely
 * @param restoredUrl the restored copy's connection string
 * @param deps the stack effects
 * @returns the comparison, `null` when none was asked for, or why either side could not be counted
 */
async function compareToLive({
  liveUrl,
  restoredUrl,
  deps,
}: {
  liveUrl: string | null;
  restoredUrl: string;
  deps: RestoreDeps;
}): Promise<Result<CountComparison | null, BackupError>> {
  if (liveUrl === null) {
    return ok(null);
  }
  const live = await deps.tableCounts({ url: liveUrl });
  const copy = await deps.tableCounts({ url: restoredUrl });
  if (live.isErr() || copy.isErr()) {
    const lines = [live, copy].flatMap((side) => (side.isErr() ? backupErrorLines({ error: side.error }) : []));
    return err(BackupErrors.stepFailed({ reasons: lines }));
  }
  return ok(compareCounts({ live: live.value, restored: copy.value }));
}
