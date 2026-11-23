/**
 * The pre-lock backup: before the lock first changes a store, retain an unencrypted copy of its database and its
 * Storage objects on this Mac, and PROVE that copy restores, or the lock does not start.
 *
 * Owner condition: an unencrypted backup to a local file is taken first, because losing something
 * irretrievably is the failure to avoid. So the gate is not "a dump
 * was written": the dump is replayed into the rehearsal throwaway (`../backup/rehearsal.ts`, its own container,
 * no mounts, the live stack's own image) and checked against the live store read-only — schema, every table's
 * count, and the newest rows byte-equal — and the Storage tar is unpacked and every object the store recorded
 * before the dump is found in it at its path, at its size, and digesting to its name (`./storageProof.ts`). Any
 * failed check refuses the lock.
 *
 * **What it covers is the lock's blast radius.** The lock changes one role, the server's login rules and the API
 * roles' table rights — all inside the database. It touches no file in `$SLOPWEAVER_HOME`, so the files leg
 * `store backup` carries is not retained here. The copy lands in `$SLOPWEAVER_HOME/store-lock/backups/<instant>/`
 * (0700) and is never pruned by this module: it is the owner's to keep.
 *
 * An EMPTY store — no table in `public` and no Storage object — has nothing to lose, so the gate says so and
 * skips: the fresh-install path. Either one present runs the whole gate.
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";

import { writeJsonFile } from "#lib/jsonFile.js";
import { err, ok, type Result } from "#lib/result.js";

import { stateHomePaths } from "../../stateHome.js";
import { backupErrorLines } from "../backup/errors.js";
import {
  BACKUP_FILES,
  BACKUP_MANIFEST_VERSION,
  type BackupManifest,
  backupDirectoryName,
  DUMPED_SCHEMAS,
  databaseNameOf,
  SUPABASE_PROJECT_ID,
} from "../backup/plan.js";
import type { RehearsalReport } from "../backup/rehearsalReport.js";
import type { verifyBackupDirectory } from "../backup/restoreSource.js";
import type { digestFile, dumpDatabase, pgDumpVersion, tarStorage } from "../backup/stack.js";
import type { listExtensions } from "../backup/stackDatabase.js";
import { type StoreLockError, StoreLockErrors } from "./errors.js";
import { type StorageObjectRow, storageProblems, type unpackAndDigest } from "./storageProof.js";

/** What a store holds of what the copy would carry, counted before deciding whether there is anything to copy. */
export interface StoreContentCounts {
  /** Tables in the dumped schemas the stack does not create itself — `public` and `drizzle`. */
  readonly ownedTables: number;
  /** Rows in `storage.buckets`: a bucket with nothing in it is still state the dump carries. */
  readonly storageBuckets: number;
  /** Rows in `storage.objects`. */
  readonly storageObjects: number;
}

/**
 * The three counts in ONE statement, so they are read from one snapshot: counted separately, a transaction
 * committing between them (a table created, a bucket dropped) could add up to an empty store that never existed. Prints `tables|buckets|objects`.
 */
export const STORE_CONTENT_COUNTS_QUERY =
  "select (select count(*) from pg_tables where schemaname in ('public', 'drizzle')) || '|' || " +
  "(select count(*) from storage.buckets) || '|' || (select count(*) from storage.objects)";

/**
 * Read {@link STORE_CONTENT_COUNTS_QUERY}'s one line.
 *
 * @param out what psql printed
 * @returns the counts, or the refusal naming what it printed instead
 */
export function parseContentCounts({ out }: { out: string }): Result<StoreContentCounts, StoreLockError> {
  const match = /^(\d+)\|(\d+)\|(\d+)$/.exec(out.trim());
  if (match === null) {
    return err(
      StoreLockErrors.stepFailed({ detail: `psql printed ${out.trim()}`, step: "counting what the store holds" }),
    );
  }
  return ok({ ownedTables: Number(match[1]!), storageBuckets: Number(match[2]!), storageObjects: Number(match[3]!) });
}

/**
 * Whether a store holds nothing the pre-lock copy would carry, so there is nothing to lose and nothing to copy.
 *
 * @param counts what the store holds
 * @returns true only when every count is zero
 */
export function isEmptyStore({ counts }: { counts: StoreContentCounts }): boolean {
  return counts.ownedTables === 0 && counts.storageBuckets === 0 && counts.storageObjects === 0;
}

/** The effects the gate runs through, so a test hands in plain fakes. */
export interface LockBackupDeps {
  readonly pgDumpVersion: typeof pgDumpVersion;
  readonly listExtensions: typeof listExtensions;
  readonly dumpDatabase: typeof dumpDatabase;
  readonly tarStorage: typeof tarStorage;
  readonly digestFile: typeof digestFile;
  readonly verifyBackupDirectory: typeof verifyBackupDirectory;
  /** What the store holds of what the copy would carry — {@link isEmptyStore} decides whether to copy at all. */
  readonly contentCounts: (args: { database: string }) => Result<StoreContentCounts, StoreLockError>;
  /** The Storage objects the live database records as created at or before an instant. */
  readonly storageObjects: (args: { beforeIso: string }) => Result<readonly StorageObjectRow[], StoreLockError>;
  readonly unpackAndDigest: typeof unpackAndDigest;
  /** Replay the verified copy into the rehearsal throwaway and check it against live, read-only. */
  readonly rehearse: (args: {
    liveUrl: string;
    directory: string;
    manifest: BackupManifest;
  }) => Promise<Result<RehearsalReport, StoreLockError>>;
  readonly nowIso: () => string;
}

/** What the gate did. */
export type LockBackupOutcome =
  | { readonly kind: "empty"; readonly database: string }
  | {
      readonly kind: "proven";
      readonly directory: string;
      readonly manifest: BackupManifest;
      readonly report: RehearsalReport;
      /** How many Storage objects the tar was proven to hold, by path, size and — where named so — digest. */
      readonly storageObjects: number;
    };

/**
 * Dump and tar into a fresh directory and write the manifest `verifyBackupDirectory` reads.
 *
 * @param database the store's database
 * @param directory where the copy lands
 * @param nowIso the copy's own instant
 * @param deps the stack effects
 * @returns the manifest, or the step that failed
 */
function writeLocalCopy({
  database,
  directory,
  nowIso,
  deps,
}: {
  database: string;
  directory: string;
  nowIso: string;
  deps: LockBackupDeps;
}): Result<BackupManifest, StoreLockError> {
  const failed = ({ error }: Parameters<typeof backupErrorLines>[0]): StoreLockError =>
    StoreLockErrors.backupGateFailed({ reasons: backupErrorLines({ error }) });
  const version = deps.pgDumpVersion();
  if (version.isErr()) {
    return err(failed({ error: version.error }));
  }
  const extensions = deps.listExtensions({ database });
  if (extensions.isErr()) {
    return err(failed({ error: extensions.error }));
  }
  mkdirSync(directory, { mode: 0o700, recursive: true });
  const dumpPath = join(directory, BACKUP_FILES.dump);
  const dumped = deps.dumpDatabase({ database, path: dumpPath });
  if (dumped.isErr()) {
    return err(failed({ error: dumped.error }));
  }
  const tarPath = join(directory, BACKUP_FILES.storage);
  const tarred = deps.tarStorage({ path: tarPath });
  if (tarred.isErr()) {
    return err(failed({ error: tarred.error }));
  }
  const dump = deps.digestFile({ path: dumpPath });
  if (dump.isErr()) {
    return err(failed({ error: dump.error }));
  }
  const storage = deps.digestFile({ path: tarPath });
  if (storage.isErr()) {
    return err(failed({ error: storage.error }));
  }
  const manifest: BackupManifest = {
    createdAtIso: nowIso,
    database,
    dump: { ...dump.value, chunked: null },
    extensions: extensions.value,
    pgDumpVersion: version.value,
    project: SUPABASE_PROJECT_ID,
    schemas: [...DUMPED_SCHEMAS],
    secrets: null,
    storage: storage.value,
    // The lock changes roles, rules and grants, never a Vault secret, and this copy is unencrypted on purpose.
    vault: null,
    version: BACKUP_MANIFEST_VERSION,
  };
  writeJsonFile({ path: join(directory, BACKUP_FILES.manifest), value: manifest });
  return ok(manifest);
}

/**
 * Take the pre-lock backup and prove it restores, or say the store is empty.
 *
 * @param home the Slopweaver home the copy lands under
 * @param storeUrl the selection the lock is about to change — dumped, then read-only for the comparison
 * @param deps the effects
 * @returns what the gate did, or why the lock must not start
 */
export async function takeLockBackup({
  home,
  storeUrl,
  deps,
}: {
  home: string;
  storeUrl: string;
  deps: LockBackupDeps;
}): Promise<Result<LockBackupOutcome, StoreLockError>> {
  const database = databaseNameOf({ url: storeUrl });
  if (database.isErr()) {
    return err(StoreLockErrors.backupGateFailed({ reasons: backupErrorLines({ error: database.error }) }));
  }
  const counts = deps.contentCounts({ database: database.value });
  if (counts.isErr()) {
    return err(counts.error);
  }
  if (isEmptyStore({ counts: counts.value })) {
    return ok({ database: database.value, kind: "empty" });
  }
  const nowIso = deps.nowIso();
  const directory = join(stateHomePaths({ home }).storeLockBackups, backupDirectoryName({ createdAtIso: nowIso }));
  const written = writeLocalCopy({ database: database.value, deps, directory, nowIso });
  if (written.isErr()) {
    return err(written.error);
  }
  const verified = deps.verifyBackupDirectory({ directory });
  if (verified.isErr()) {
    return err(StoreLockErrors.backupGateFailed({ reasons: backupErrorLines({ error: verified.error }) }));
  }
  const report = await deps.rehearse({ directory, liveUrl: storeUrl, manifest: verified.value });
  if (report.isErr()) {
    return err(report.error);
  }
  if (!report.value.verdict.passed) {
    return err(
      StoreLockErrors.backupGateFailed({
        reasons: [`the copy at ${directory} did not restore cleanly:`, ...report.value.verdict.failures],
      }),
    );
  }
  const storage = proveStorage({ deps, directory, manifest: verified.value });
  if (storage.isErr()) {
    return err(storage.error);
  }
  return ok({
    directory,
    kind: "proven",
    manifest: verified.value,
    report: report.value,
    storageObjects: storage.value,
  });
}

/**
 * Prove the retained tar holds every Storage object the store recorded before the dump began.
 *
 * @param directory the retained copy
 * @param manifest its verified manifest, whose instant bounds which objects are expected
 * @param deps the effects
 * @returns how many objects were proven, or every gap
 */
function proveStorage({
  directory,
  manifest,
  deps,
}: {
  directory: string;
  manifest: BackupManifest;
  deps: LockBackupDeps;
}): Result<number, StoreLockError> {
  const objects = deps.storageObjects({ beforeIso: manifest.createdAtIso });
  if (objects.isErr()) {
    return err(objects.error);
  }
  const files = deps.unpackAndDigest({
    scratch: join(directory, "storage-check"),
    tarPath: join(directory, BACKUP_FILES.storage),
  });
  if (files.isErr()) {
    return err(files.error);
  }
  const problems = storageProblems({ files: files.value, objects: objects.value });
  if (problems.length > 0) {
    return err(
      StoreLockErrors.backupGateFailed({
        reasons: [`the copy at ${directory} is missing Storage bytes:`, ...problems],
      }),
    );
  }
  return ok(objects.value.length);
}
