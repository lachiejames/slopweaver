/**
 * A restore rehearsal, straight through: say what the live store is, refuse a target that is it, fetch the
 * newest backup, restore it into a throwaway Postgres of its own, verify the copy against live, and stop the
 * throwaway. Why each step is shaped the way it is lives in
 * `./rehearsalTarget.ts` (the guard), `./rehearsalVerify.ts` (the read-only live session) and
 * `./rehearsalCheck.ts` (the verdicts).
 *
 * **The order is the safety.** The target is checked against the live coordinates BEFORE a byte is downloaded
 * or a container started, so the wrong name costs nothing. The throwaway's mounts are read back the moment it
 * exists and it is stopped at once if it has any. Cleanup is a `finally` over exactly the container ID this
 * run created.
 *
 * This module never writes to the live store and has no way to: it holds no live write capability, and the
 * proof a rehearsal files afterwards is the CLI shell's, not this engine's.
 */
import { randomBytes } from "node:crypto";
import { join } from "node:path";

import { err, ok, type Result } from "#lib/result.js";

import { BACKUP_FILES, type VaultArtefact } from "./plan.js";
import type { LegsReading, VaultReading } from "./rehearsalCheck.js";
import type {
  containerNameTaken,
  inspectLiveContainer,
  restoreIntoThrowaway,
  startThrowaway,
  stopThrowaway,
  waitForThrowaway,
} from "./rehearsalDocker.js";
import { type RehearsalError, RehearsalErrors } from "./rehearsalErrors.js";
import { prepareRehearsal } from "./rehearsalPrepare.js";
import { assembleReport, type RehearsalReport } from "./rehearsalReport.js";
import type { fetchRehearsalSource, RehearsalSource } from "./rehearsalSource.js";
import {
  type LiveMount,
  type LiveStore,
  type RehearsalRequest,
  type RehearsalTarget,
  throwawayMountsClear,
  throwawayUrl,
} from "./rehearsalTarget.js";
import type { VerificationFacts } from "./rehearsalVerify.js";
import type { RestoreMode } from "./restorePlan.js";
import type { BackupTransport } from "./transport.js";
import type { vaultRowCount } from "./vault.js";
import type { VaultError } from "./vaultErrors.js";

/** Every effect a rehearsal performs, named once so a test can hand in plain fakes. */
export interface RehearsalDeps {
  readonly inspectLiveContainer: typeof inspectLiveContainer;
  readonly containerNameTaken: typeof containerNameTaken;
  readonly listBackups: (args: { prefix: string }) => ReturnType<BackupTransport["list"]>;
  readonly fetchSource: (args: { prefix: string }) => ReturnType<typeof fetchRehearsalSource>;
  readonly readOtherLegs: (args: { directory: string }) => Promise<Result<LegsReading, RehearsalError>>;
  readonly startThrowaway: typeof startThrowaway;
  readonly waitForThrowaway: typeof waitForThrowaway;
  readonly restoreIntoThrowaway: typeof restoreIntoThrowaway;
  readonly stopThrowaway: typeof stopThrowaway;
  /** Re-create the backup's Vault secrets in the throwaway, the backup key already bound by the caller. */
  readonly restoreVault: (args: {
    container: string;
    database: string;
    directory: string;
    artefact: VaultArtefact;
  }) => Promise<Result<void, VaultError>>;
  /** Count what the throwaway's Vault holds and can open, once restored. */
  readonly vaultRowCount: typeof vaultRowCount;
  /** Read the three kinds of fact off live (read-only) and the copy. */
  readonly verify: (args: {
    liveUrl: string;
    copyUrl: string;
    sampleSize: number;
    dumpStartedIso: string;
  }) => Promise<Result<VerificationFacts, RehearsalError>>;
  /** The instant, for the report. */
  readonly nowIso: () => string;
}

/**
 * Run one rehearsal.
 *
 * @param liveUrl the live store's connection string — read, never written
 * @param requested the throwaway the caller asked for
 * @param destination the local destination root the backups are in
 * @param from a prefix to rehearse instead of the newest, or `null`
 * @param sampleSize rows per table in the byte-equal sample
 * @param keep whether to leave the throwaway running afterwards
 * @param deps the effects
 * @returns the report, or why the rehearsal stopped before it had a verdict
 */
export async function runRehearsal({
  liveUrl,
  requested,
  destination,
  from,
  sampleSize,
  keep,
  deps,
}: {
  liveUrl: string;
  requested: RehearsalRequest;
  destination: string;
  from: string | null;
  sampleSize: number;
  keep: boolean;
  deps: RehearsalDeps;
}): Promise<Result<RehearsalReport, RehearsalError>> {
  const startedAtIso = deps.nowIso();
  const prepared = await prepareRehearsal({ deps, destination, from, liveUrl, requested });
  if (prepared.isErr()) {
    return err(prepared.error);
  }
  const password = randomBytes(24).toString("hex");
  const started = deps.startThrowaway({ password, target: prepared.value.target });
  if (started.isErr()) {
    return err(started.error);
  }
  const { id, mounts } = started.value;
  const outcome = await insideThrowaway({
    ...prepared.value,
    deps,
    id,
    keep,
    liveUrl,
    mounts,
    password,
    sampleSize,
    startedAtIso,
  });
  // A mount refusal stops it too, even under --keep: a throwaway holding a data directory is not one to keep.
  if (!keep || mounts.length > 0) {
    const stopped = deps.stopThrowaway({ id });
    if (stopped.isErr()) {
      return err(stopped.error);
    }
  }
  return outcome;
}

/**
 * Everything between starting the throwaway and stopping it, with a throw turned into a failure so the caller's
 * stop always runs.
 *
 * @param mounts what docker reports the throwaway mounted — any at all refuses it
 * @returns the report, or why it stopped
 */
async function insideThrowaway({
  mounts,
  ...rest
}: Parameters<typeof restoreAndVerify>[0] & { mounts: readonly LiveMount[] }): Promise<
  Result<RehearsalReport, RehearsalError>
> {
  const clear = throwawayMountsClear({ live: rest.live, mounts });
  if (clear.isErr()) {
    return err(clear.error);
  }
  try {
    return await restoreAndVerify(rest);
  } catch (cause: unknown) {
    const why = cause instanceof Error ? cause.message : String(cause);
    return err(RehearsalErrors.stepFailed({ reasons: [why], step: "restoring and verifying the throwaway" }));
  }
}

/**
 * Wait for the throwaway, then replay the dump into it, timing the replay alone.
 *
 * @param id the container this run created
 * @param source the verified backup, whose dump and manifest are replayed
 * @param target the checked target
 * @param deps the effects
 * @returns the restore mode it took and how many seconds the replay ran, or why it stopped
 */
function restoreTimed({
  id,
  source,
  target,
  deps,
}: {
  id: string;
  source: RehearsalSource;
  target: RehearsalTarget;
  deps: RehearsalDeps;
}): Result<{ mode: RestoreMode; restoreSeconds: number }, RehearsalError> {
  const ready = deps.waitForThrowaway({ id });
  if (ready.isErr()) {
    return err(ready.error);
  }
  const restoreStarted = Date.parse(deps.nowIso());
  const mode = deps.restoreIntoThrowaway({
    dumpPath: join(source.directory, BACKUP_FILES.dump),
    id,
    manifest: source.manifest,
    target,
  });
  if (mode.isErr()) {
    return err(mode.error);
  }
  return ok({ mode: mode.value, restoreSeconds: Math.round((Date.parse(deps.nowIso()) - restoreStarted) / 1000) });
}

/**
 * The part of a rehearsal that runs inside a started throwaway: wait, restore, verify, judge.
 *
 * @param target the checked target
 * @param id the container this run created
 * @param password the throwaway's per-run password
 * @param live what the live store is
 * @param liveUrl its connection string, opened read-only
 * @param source the verified backup
 * @param sampleSize rows per table
 * @param keep whether the throwaway is being left running
 * @param startedAtIso the rehearsal's own start
 * @param legs the storage and files legs, already read
 * @param deps the effects
 * @returns the report, or why it stopped
 */
async function restoreAndVerify({
  target,
  id,
  password,
  live,
  liveUrl,
  source,
  sampleSize,
  keep,
  startedAtIso,
  legs,
  deps,
}: {
  target: RehearsalTarget;
  id: string;
  password: string;
  live: LiveStore;
  liveUrl: string;
  source: RehearsalSource;
  sampleSize: number;
  keep: boolean;
  startedAtIso: string;
  legs: LegsReading;
  deps: RehearsalDeps;
}): Promise<Result<RehearsalReport, RehearsalError>> {
  const restored = restoreTimed({ deps, id, source, target });
  if (restored.isErr()) {
    return err(restored.error);
  }
  const facts = await deps.verify({
    copyUrl: throwawayUrl({ password, target }),
    dumpStartedIso: source.manifest.createdAtIso,
    liveUrl,
    sampleSize,
  });
  if (facts.isErr()) {
    return err(facts.error);
  }
  // After verification, never before: re-creating Vault may install its extension, which the catalog compare would
  // otherwise read as the copy's schema drifting from live's.
  const vault = await readVaultLeg({ deps, id, source, target });
  const finishedAtIso = deps.nowIso();
  const { mode, restoreSeconds } = restored.value;
  return ok(
    assembleReport({
      facts: facts.value,
      finishedAtIso,
      id,
      keep,
      legs,
      live,
      mode,
      restoreSeconds,
      source,
      startedAtIso,
      target,
      vault,
    }),
  );
}

/**
 * Restore the backup's Vault leg into the throwaway and count what came back. A failure is a READING rather than a
 * stop, so the report still carries the database half's verdict beside it.
 *
 * @param id the container this run created — the Vault import addresses it, never a name
 * @param source the verified backup, whose manifest says whether it carries a Vault leg
 * @param target the checked target, whose database the secrets go into
 * @param deps the effects
 * @returns what the Vault leg recorded against what the copy now holds, or why it did not get that far
 */
async function readVaultLeg({
  id,
  source,
  target,
  deps,
}: {
  id: string;
  source: RehearsalSource;
  target: RehearsalTarget;
  deps: Pick<RehearsalDeps, "restoreVault" | "vaultRowCount">;
}): Promise<VaultReading> {
  const artefact = source.manifest.vault;
  if (artefact === null) {
    return { status: "absent" };
  }
  const imported = await deps.restoreVault({
    artefact,
    container: id,
    database: target.database,
    directory: source.directory,
  });
  if (imported.isErr()) {
    return { status: "failed", why: imported.error.message };
  }
  const counted = deps.vaultRowCount({ container: id, database: target.database });
  if (counted.isErr()) {
    return { status: "failed", why: counted.error.message };
  }
  return { expected: artefact.rows, restored: counted.value, status: "restored" };
}
