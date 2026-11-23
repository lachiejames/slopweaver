/**
 * The production effects of `store lock`'s pre-lock backup gate (`src/store/lock/backupGate.ts`): the dump, tar,
 * digest and Storage reads against the live stack, and the rehearsal that replays the retained copy into a
 * throwaway. Split from `./lockRun.ts`, which wires the result into the lock's own effects.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";

import { err, ok, type Result } from "#lib/result.js";
import { safeJsonParse } from "#lib/safeJson.js";

import { LocalDestinationErrors } from "../../../store/backup/localDestinationErrors.js";
import { BACKUP_FILES, FILES_MANIFEST, SUPABASE_PROJECT_ID } from "../../../store/backup/plan.js";
import { runRehearsal } from "../../../store/backup/rehearsal.js";
import type { LegsReading } from "../../../store/backup/rehearsalCheck.js";
import {
  containerNameTaken,
  inspectLiveContainer,
  restoreIntoThrowaway,
  startThrowaway,
  stopThrowaway,
  waitForThrowaway,
} from "../../../store/backup/rehearsalDocker.js";
import { type RehearsalError, RehearsalErrors } from "../../../store/backup/rehearsalErrors.js";
import { listTar } from "../../../store/backup/rehearsalSource.js";
import {
  DEFAULT_REHEARSAL_CONTAINER,
  DEFAULT_REHEARSAL_DATABASE,
  DEFAULT_REHEARSAL_PORT,
} from "../../../store/backup/rehearsalTarget.js";
import { verifyAgainstLive } from "../../../store/backup/rehearsalVerify.js";
import { verifyBackupDirectory } from "../../../store/backup/restoreSource.js";
import { digestFile, dumpDatabase, pgDumpVersion, tarStorage } from "../../../store/backup/stack.js";
import { listExtensions } from "../../../store/backup/stackDatabase.js";
import { vaultRowCount } from "../../../store/backup/vault.js";
import { VaultErrors } from "../../../store/backup/vaultErrors.js";
import {
  isEmptyStore,
  type LockBackupDeps,
  type LockBackupOutcome,
  parseContentCounts,
  STORE_CONTENT_COUNTS_QUERY,
  type StoreContentCounts,
  takeLockBackup,
} from "../../../store/lock/backupGate.js";
import { adminSql } from "../../../store/lock/edge.js";
import { type StoreLockError, StoreLockErrors } from "../../../store/lock/errors.js";
import type { LockDeps } from "../../../store/lock/reconcile.js";
import { parseStorageObjects, storageObjectsQuery, unpackAndDigest } from "../../../store/lock/storageProof.js";

/** Rows per table in the pre-lock rehearsal's byte-equal sample — `store rehearse`'s own default. */
const LOCK_REHEARSAL_SAMPLE = 5;

/**
 * The legs of the lock's copy that are not the database. The copy carries no files leg by design — the lock touches
 * no file in the home (`src/store/lock/backupGate.ts`) — so it names zero files, and that is checked rather than
 * assumed: a `files.json` in the directory means it is not the copy this gate wrote, and the rehearsal refuses.
 *
 * @param directory the retained copy
 * @returns the storage listing and an empty files leg, or the refusal
 */
export function lockCopyLegs({ directory }: { directory: string }): Result<LegsReading, RehearsalError> {
  if (existsSync(join(directory, FILES_MANIFEST))) {
    return err(
      RehearsalErrors.stepFailed({
        reasons: [`${directory} holds a ${FILES_MANIFEST}, which the pre-lock copy never writes`],
        step: `reading ${FILES_MANIFEST}`,
      }),
    );
  }
  return ok({ files: { missing: [], named: 0 }, storage: listTar({ path: join(directory, BACKUP_FILES.storage) }) });
}

/**
 * Replay the retained copy into the rehearsal throwaway and check it against live.
 *
 * @returns the gate's `rehearse` effect
 */
function rehearseLocal(): LockBackupDeps["rehearse"] {
  return async ({ liveUrl, directory, manifest }) => {
    const report = await runRehearsal({
      deps: {
        containerNameTaken,
        fetchSource: async ({ prefix }) => ok({ destination: directory, directory, manifest, prefix }),
        inspectLiveContainer,
        // `from` names the copy, so the rehearsal never lists for the newest; were it to, it refuses by name.
        listBackups: async ({ prefix }) =>
          err(
            LocalDestinationErrors.listFailed({
              cause: new Error("the pre-lock rehearsal replays the one copy it names and never lists for another"),
              prefix,
              root: directory,
            }),
          ),
        nowIso: () => new Date().toISOString(),
        readOtherLegs: async () => lockCopyLegs({ directory }),
        restoreIntoThrowaway,
        // The lock's copy is written with `vault: null`, so the rehearsal reads its Vault leg as absent and never
        // calls this; were a copy ever to carry one, it refuses by name rather than reporting a restore it never did.
        restoreVault: async () =>
          err(
            VaultErrors.stepFailed({
              cause: new Error("the pre-lock copy carries no Vault leg and holds no backup key"),
              step: "restoring the pre-lock copy's Vault secrets",
            }),
          ),
        startThrowaway,
        stopThrowaway,
        vaultRowCount,
        verify: verifyAgainstLive,
        waitForThrowaway,
      },
      destination: directory,
      from: `local/${manifest.createdAtIso}/`,
      keep: false,
      liveUrl,
      requested: {
        container: DEFAULT_REHEARSAL_CONTAINER,
        database: DEFAULT_REHEARSAL_DATABASE,
        port: DEFAULT_REHEARSAL_PORT,
      },
      sampleSize: LOCK_REHEARSAL_SAMPLE,
    });
    return report.mapErr((error) =>
      StoreLockErrors.backupGateFailed({ reasons: [`the rehearsal stopped: ${error.message}`] }),
    );
  };
}

/**
 * Read the Storage objects the live database records as created at or before an instant.
 *
 * @param projectId the stack's `project_id`
 * @param beforeIso the instant that bounds which objects count
 * @returns the rows, or the step that failed
 */
function readStorageObjects({
  projectId,
  beforeIso,
}: {
  projectId: string;
  beforeIso: string;
}): ReturnType<LockBackupDeps["storageObjects"]> {
  const query = storageObjectsQuery({ beforeIso });
  if (query.isErr()) {
    return err(query.error);
  }
  const read = adminSql({ database: "postgres", projectId, script: query.value, step: "listing Storage objects" });
  if (read.isErr()) {
    return err(read.error);
  }
  let value: unknown;
  try {
    value = safeJsonParse({ label: "storage.objects", text: read.value.trim() });
  } catch (cause: unknown) {
    const why = cause instanceof Error ? cause.message : String(cause);
    return err(StoreLockErrors.backupGateFailed({ reasons: [`storage.objects: ${why}`] }));
  }
  return parseStorageObjects({ value });
}

/**
 * The gate's effects on one stack.
 *
 * @param projectId the stack's `project_id`
 * @returns the effects
 */
function backupDeps({ projectId }: { projectId: string }): LockBackupDeps {
  return {
    contentCounts: ({ database }) =>
      adminSql({
        database,
        projectId,
        script: `${STORE_CONTENT_COUNTS_QUERY};\n`,
        step: "counting what the store holds",
      }).andThen((out) => parseContentCounts({ out })),
    digestFile,
    dumpDatabase,
    listExtensions,
    nowIso: () => new Date().toISOString(),
    pgDumpVersion,
    rehearse: rehearseLocal(),
    storageObjects: ({ beforeIso }) => readStorageObjects({ beforeIso, projectId }),
    tarStorage,
    unpackAndDigest,
    verifyBackupDirectory,
  };
}

/**
 * The pre-lock backup's verdict on a stack other than `slopweaver`, whose containers the dump and tar cannot
 * address: an empty one has nothing to lose, anything else refuses — never dumping one stack while locking another.
 *
 * @param currentUrl the selection the lock is about to change, whose path names the database
 * @param projectId the stack's `project_id`
 * @param counts what that database holds of what a copy would carry
 * @returns the empty outcome, or the refusal
 */
export function foreignStackBackup({
  currentUrl,
  projectId,
  counts,
}: {
  currentUrl: string;
  projectId: string;
  counts: StoreContentCounts;
}): Result<LockBackupOutcome, StoreLockError> {
  const database = decodeURIComponent(new URL(currentUrl).pathname.replace(/^\//, ""));
  if (isEmptyStore({ counts })) {
    return ok({ database, kind: "empty" });
  }
  return err(
    StoreLockErrors.backupGateFailed({
      reasons: [
        `the pre-lock backup reads the ${SUPABASE_PROJECT_ID} stack's containers only, and the ${projectId} stack is not empty`,
      ],
    }),
  );
}

/**
 * The pre-lock backup for one stack: the whole gate on `slopweaver`, {@link foreignStackBackup} on any other.
 *
 * @returns the lock's `takeBackup` effect
 */
export function takeBackup(): LockDeps["takeBackup"] {
  return async ({ home, currentUrl, projectId }): Promise<Result<LockBackupOutcome, StoreLockError>> => {
    const deps = backupDeps({ projectId });
    if (projectId === SUPABASE_PROJECT_ID) {
      return takeLockBackup({ deps, home, storeUrl: currentUrl });
    }
    const database = decodeURIComponent(new URL(currentUrl).pathname.replace(/^\//, ""));
    const counts = deps.contentCounts({ database });
    if (counts.isErr()) {
      return err(counts.error);
    }
    return foreignStackBackup({ counts: counts.value, currentUrl, projectId });
  };
}
