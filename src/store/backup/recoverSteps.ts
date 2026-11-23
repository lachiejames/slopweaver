/**
 * The steps `slopweaver store recover` runs once the backup is chosen, and the effects they share. The order
 * they run in is `runRecover`'s (`./recover.ts`); each step here owns one leg, skips it when the recovery's
 * marker says it already landed, and records it in the marker when it does.
 *
 * Every effect is a field of {@link RecoverDeps}, so each step is unit-tested with plain fakes; the real set is
 * the verb's (`src/cli/commands/store/recoverRun.ts`).
 */
import { join } from "node:path";

import { err, ok, type Result } from "#lib/result.js";

import { STORE_URL_SECRET } from "../config.js";
import type { BackupManifest } from "./plan.js";
import { type RecoverError, RecoverErrors } from "./recoverErrors.js";
import type { InstallReport } from "./recoverFiles.js";
import { bundleNamesToInstall, type RecoverMarker } from "./recoverPlan.js";
import type { DerivedSecret } from "./recoverSecrets.js";
import type { RestoreSource } from "./restoreSource.js";
import { BACKUP_PASSPHRASE_SECRET } from "./secretsBundle.js";

/** Every effect a recovery performs, named once so a test can hand in plain fakes. */
export interface RecoverDeps {
  /** Whether the local stack's database container is running. */
  readonly stackRunning: () => Result<boolean, RecoverError>;
  /** Create the store's three roles on the stack's server — idempotent. */
  readonly createRoles: () => Result<void, RecoverError>;
  /** The backup prefix to recover: the one named, or the newest finished one. */
  readonly chooseBackup: (args: { from: string | null }) => Promise<Result<string, RecoverError>>;
  /** Download one backup's manifest, dump, tar, files manifest and credentials bundle. */
  readonly fetchSource: (args: { prefix: string }) => Promise<Result<RestoreSource, RecoverError>>;
  /** Verify the downloaded payloads against the manifest, and return it. */
  readonly verifySource: (args: { source: RestoreSource }) => Result<BackupManifest, RecoverError>;
  /**
   * The master password, from a no-echo prompt or piped stdin — never argv. Read once per run: the fetch already
   * asked for it to unwrap the backup key, so every later call answers the same value without asking again.
   */
  readonly masterPassword: () => Promise<string>;
  /** Decrypt the bundle into a directory; the names written. */
  readonly decryptSecrets: (args: {
    source: RestoreSource;
    manifest: BackupManifest;
    into: string;
    passphrase: string;
  }) => Result<readonly string[], RecoverError>;
  /** How many tables the database's `public` schema holds — `0` when the database does not exist. */
  readonly publicTables: (args: { database: string }) => Result<number, RecoverError>;
  /** Create the database and `pg_restore` the dump into it. */
  readonly restoreDatabase: (args: { source: RestoreSource; database: string }) => Promise<Result<void, RecoverError>>;
  /** Apply every migration this checkout carries that the backup predates, and verify the schema. */
  readonly migrate: (args: { url: string }) => Promise<Result<void, RecoverError>>;
  /** Rebuild the files leg under an empty directory. */
  readonly restoreFiles: (args: { source: RestoreSource; into: string }) => Promise<Result<number, RecoverError>>;
  readonly installFiles: (args: { staged: string; home: string }) => Result<InstallReport, RecoverError>;
  readonly installSecrets: (args: {
    staged: string;
    names: readonly string[];
    derived: readonly DerivedSecret[];
    home: string;
  }) => Result<InstallReport, RecoverError>;
  /** Write the board, the journals, the boot files and the rest of the authored state from the recovered store. */
  readonly authoredRestore: (args: { home: string; url: string }) => Promise<Result<void, RecoverError>>;
  readonly readMarker: (args: { path: string }) => unknown;
  readonly writeMarker: (args: { path: string; marker: RecoverMarker }) => Result<void, RecoverError>;
  readonly clearStaging: (args: { path: string }) => void;
  readonly nowIso: () => string;
  /** One line per step, as it lands. */
  readonly progress: (args: { line: string }) => void;
}

/** What the steps that need the downloaded backup share once it is fetched. */
export interface Fetched {
  readonly source: RestoreSource;
  readonly manifest: BackupManifest;
  /** The decrypted bundle's names, empty when the backup carried none or the secrets step already landed. */
  readonly bundleNames: readonly string[];
  readonly passphrase: string | null;
}

/**
 * Download and verify the backup, then — before the long restore — decrypt its credentials, so a wrong
 * passphrase stops the run while it has cost nothing.
 *
 * @param prefix the backup
 * @param staging the recovery's staging directory
 * @param marker how far the recovery got
 * @param deps the effects
 * @returns what the later steps need, or why the backup could not be read
 */
export async function fetchAndDecrypt({
  prefix,
  staging,
  marker,
  deps,
}: {
  prefix: string;
  staging: string;
  marker: RecoverMarker;
  deps: RecoverDeps;
}): Promise<Result<Fetched, RecoverError>> {
  const source = await deps.fetchSource({ prefix });
  if (source.isErr()) {
    return err(source.error);
  }
  const manifest = deps.verifySource({ source: source.value });
  if (manifest.isErr()) {
    return err(manifest.error);
  }
  deps.progress({ line: `  backup      downloaded and digest-verified, taken ${manifest.value.createdAtIso}` });
  if (marker.secretsInstalledAtIso !== null) {
    return ok({ bundleNames: [], manifest: manifest.value, passphrase: null, source: source.value });
  }
  // Read even when the backup carries no credentials: the password opened this backup, so it is installed as
  // `backup-passphrase` whatever the bundle holds, and the next nightly writes the credentials leg under it.
  const passphrase = await deps.masterPassword();
  if (manifest.value.secrets === null) {
    deps.progress({
      line: "  credentials NOT IN THIS BACKUP — backup-passphrase was never set on the machine that took it",
    });
    return ok({ bundleNames: [], manifest: manifest.value, passphrase, source: source.value });
  }
  const into = join(staging, "secrets");
  deps.clearStaging({ path: into });
  const names = deps.decryptSecrets({ into, manifest: manifest.value, passphrase, source: source.value });
  if (names.isErr()) {
    return err(names.error);
  }
  deps.progress({ line: `  credentials ${String(names.value.length)} decrypted into the recovery's staging` });
  return ok({ bundleNames: names.value, manifest: manifest.value, passphrase, source: source.value });
}

/**
 * Restore the database, when this recovery has not already, then bring its schema up to this checkout.
 *
 * @param action whether the database is restored here or was already, decided before anything was fetched
 * @param fetched the downloaded backup, `null` when every step needing it already landed
 * @param marker how far the recovery got
 * @param markerPath where the marker is written
 * @param url the recovered database's connection string
 * @param deps the effects
 * @returns the marker after this step, or why it stopped
 */
export async function databaseStep({
  action,
  fetched,
  marker,
  markerPath,
  url,
  deps,
}: {
  action: "restore" | "skip";
  fetched: Fetched | null;
  marker: RecoverMarker;
  markerPath: string;
  url: string;
  deps: RecoverDeps;
}): Promise<Result<RecoverMarker, RecoverError>> {
  let next = marker;
  if (action === "restore") {
    if (fetched === null) {
      return err(RecoverErrors.stepFailed({ reasons: ["no backup was fetched"], step: "restoring the database" }));
    }
    const restored = await deps.restoreDatabase({ database: marker.database, source: fetched.source });
    if (restored.isErr()) {
      return err(restored.error);
    }
    next = { ...marker, databaseRestoredAtIso: deps.nowIso() };
    const written = deps.writeMarker({ marker: next, path: markerPath });
    if (written.isErr()) {
      return err(written.error);
    }
  }
  deps.progress({
    line: `  database    ${marker.database} ${action === "restore" ? "restored" : "already restored by this recovery"}`,
  });
  const migrated = await deps.migrate({ url });
  if (migrated.isErr()) {
    return err(migrated.error);
  }
  deps.progress({ line: "  schema      every migration this checkout carries applied, and the schema verified" });
  return ok(next);
}

/**
 * Rebuild the files leg into staging and move it into the home, when this recovery has not already.
 *
 * @param fetched the downloaded backup, `null` when every step needing it already landed
 * @param marker how far the recovery got
 * @param markerPath where the marker is written
 * @param staging the recovery's staging directory
 * @param home the home being recovered
 * @param deps the effects
 * @returns the marker after this step and what the install did (`null` when skipped), or why it stopped
 */
export async function filesStep({
  fetched,
  marker,
  markerPath,
  staging,
  home,
  deps,
}: {
  fetched: Fetched | null;
  marker: RecoverMarker;
  markerPath: string;
  staging: string;
  home: string;
  deps: RecoverDeps;
}): Promise<Result<{ marker: RecoverMarker; report: InstallReport | null }, RecoverError>> {
  if (marker.filesRestoredAtIso !== null || fetched === null) {
    deps.progress({ line: "  files       already restored by this recovery" });
    return ok({ marker, report: null });
  }
  const into = join(staging, "files");
  deps.clearStaging({ path: into });
  const rebuilt = await deps.restoreFiles({ into, source: fetched.source });
  if (rebuilt.isErr()) {
    return err(rebuilt.error);
  }
  const installed = deps.installFiles({ home, staged: into });
  if (installed.isErr()) {
    return err(installed.error);
  }
  deps.progress({
    line: `  files       ${String(rebuilt.value)} rebuilt and verified; ${installLine({ report: installed.value })}`,
  });
  if (installed.value.conflicts.length > 0) {
    return ok({ marker, report: installed.value });
  }
  const next = { ...marker, filesRestoredAtIso: deps.nowIso() };
  const written = deps.writeMarker({ marker: next, path: markerPath });
  if (written.isErr()) {
    return err(written.error);
  }
  return ok({ marker: next, report: installed.value });
}

/**
 * Install the credentials, the recovered `store-url` and the master password (as `backup-passphrase`) into
 * `<home>/secrets/`.
 *
 * `store-url` is written even when the backup carried no credentials: it is what makes the next step, and
 * every verb after the recovery, read the recovered database.
 *
 * @param fetched the downloaded backup, `null` when every step needing it already landed
 * @param marker how far the recovery got
 * @param markerPath where the marker is written
 * @param staging the recovery's staging directory
 * @param request the home being recovered, the recovered database's connection string, and the database the home's
 *   own `store-url` names when that URL was derived from it, so may replace it where the database is the only
 *   difference — `runRecover` has already refused one naming a database that holds a store
 * @param deps the effects
 * @returns what the install did (`null` when skipped), or why it stopped
 */
export function secretsStep({
  fetched,
  marker,
  markerPath,
  staging,
  request,
  deps,
}: {
  fetched: Fetched | null;
  marker: RecoverMarker;
  markerPath: string;
  staging: string;
  request: { readonly home: string; readonly url: string; readonly homeStoreDatabase: string | null };
  deps: RecoverDeps;
}): Result<{ report: InstallReport | null }, RecoverError> {
  if (marker.secretsInstalledAtIso !== null || fetched === null) {
    deps.progress({ line: "  secrets     already installed by this recovery" });
    return ok({ report: null });
  }
  const { home, url } = request;
  const derived: DerivedSecret[] = [
    { name: STORE_URL_SECRET, replaceDatabaseOnly: request.homeStoreDatabase !== null, value: url },
  ];
  if (fetched.passphrase !== null) {
    derived.push({ name: BACKUP_PASSPHRASE_SECRET, replaceDatabaseOnly: false, value: fetched.passphrase });
  }
  const installed = deps.installSecrets({
    derived,
    home,
    names: bundleNamesToInstall({ names: fetched.bundleNames }),
    staged: join(staging, "secrets"),
  });
  if (installed.isErr()) {
    return err(installed.error);
  }
  deps.progress({ line: `  secrets     ${installLine({ report: installed.value })}` });
  if (installed.value.conflicts.length > 0) {
    return ok({ report: installed.value });
  }
  const written = deps.writeMarker({ marker: { ...marker, secretsInstalledAtIso: deps.nowIso() }, path: markerPath });
  if (written.isErr()) {
    return err(written.error);
  }
  return ok({ report: installed.value });
}

/**
 * The paths one install left behind.
 *
 * @param report what the install did, `null` when the step was skipped
 * @returns its conflicts, none when it was skipped
 */
export function conflictsOf({ report }: { report: InstallReport | null }): readonly string[] {
  if (report === null) {
    return [];
  }
  return report.conflicts;
}

/**
 * One install's counts as a phrase.
 *
 * @param report what the install did
 * @returns `<n> written, <n> already identical, <n> left in staging (differs)`, and `<n> replaced` when one was
 */
export function installLine({ report }: { report: InstallReport }): string {
  const replaced = report.replaced.length > 0 ? `${String(report.replaced.length)} replaced, ` : "";
  return (
    `${String(report.written)} written, ${replaced}${String(report.identical)} already identical, ` +
    `${String(report.conflicts.length)} left in staging because the home holds different bytes`
  );
}
