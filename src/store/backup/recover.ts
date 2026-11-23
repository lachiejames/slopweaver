/**
 * `slopweaver store recover`, straight through: the one command that brings a wiped Mac back from the encrypted
 * local-destination backup (owner ask). Every piece already existed — `store restore`, the files and credentials legs,
 * `store push`, `store authored-restore` — and was sequenced only by prose a person had to follow in order;
 * this is that order, as code.
 *
 * **The order is the design.** The stack is checked before anything is downloaded. The store's roles are made
 * before `pg_restore`, because they are cluster-level and the dump's policies name them. The credentials are
 * decrypted BEFORE the database restore, so a mistyped passphrase costs seconds rather than the twenty minutes
 * a restore takes. `store-url` is written before the authored state is read back, because that read opens the
 * store the home selects.
 *
 * **A re-run resumes.** A marker under the recovery's own staging records each long step as it lands, so a
 * recovery killed halfway is finished by running the same command again, and one that already finished only
 * re-runs the idempotent tail.
 *
 * Every effect is a field of {@link RecoverDeps} (`./recoverSteps.ts`, beside the steps themselves), so the
 * sequence is unit-tested with plain fakes; the real set is the verb's (`src/cli/commands/store/recoverRun.ts`).
 */
import { join } from "node:path";

import { err, ok, type Result } from "#lib/result.js";

import { supabaseContainer } from "./plan.js";
import { type RecoverError, RecoverErrors } from "./recoverErrors.js";
import type { InstallReport } from "./recoverFiles.js";
import { databaseAction, homeStoreUrlRepoint, type RecoverMarker, resumeMarker } from "./recoverPlan.js";
import {
  conflictsOf,
  databaseStep,
  type Fetched,
  fetchAndDecrypt,
  filesStep,
  type RecoverDeps,
  secretsStep,
} from "./recoverSteps.js";

/** What a recovery asks for. */
export interface RecoverRequest {
  readonly home: string;
  /** A `<project>/<instant>/` prefix, or `null` for the newest finished backup. */
  readonly from: string | null;
  readonly database: string;
  /** The recovered database's connection string, derived by the verb before anything runs. */
  readonly url: string;
  /**
   * The database this home's own `secrets/store-url` names when `url` was derived from it, so may replace it when
   * the database alone differs and that database holds no store. `null` for a URL from `SLOPWEAVER_STORE_URL`, a
   * one-off that never repoints the home.
   */
  readonly homeStoreDatabase: string | null;
  /** The recovery's own staging directory for the chosen backup, given its prefix, made — or why it cannot be. */
  readonly stagingFor: (args: { prefix: string }) => Result<string, RecoverError>;
  /** The checkout the stack is started from, for the refusal when it is down. */
  readonly treeRoot: string;
  readonly dryRun: boolean;
}

/** What a recovery did, for the verb's closing report. Never carries a credential's value. */
export interface RecoverReport {
  readonly prefix: string;
  readonly database: string;
  readonly dryRun: boolean;
  /** `true` or `false` once read off the manifest; `null` when this run never needed it. */
  readonly credentialsCarried: boolean | null;
  readonly files: InstallReport | null;
  readonly secrets: InstallReport | null;
  readonly conflicts: readonly string[];
  /** Every step landed with no conflict. */
  readonly complete: boolean;
}

/** Where a recovery stands once the backup is chosen and its marker read. */
interface Started {
  readonly prefix: string;
  readonly staging: string;
  readonly markerPath: string;
  readonly marker: RecoverMarker;
}

/**
 * Recover a home from the destination's backup.
 *
 * @param request what to recover, and into what
 * @param deps every effect
 * @returns the report, or the step that stopped it — a re-run resumes from there
 */
export async function runRecover({
  request,
  deps,
}: {
  request: RecoverRequest;
  deps: RecoverDeps;
}): Promise<Result<RecoverReport, RecoverError>> {
  const started = await start({ deps, request });
  if (started.isErr()) {
    return err(started.error);
  }
  const { prefix, staging, markerPath } = started.value;
  const repoint = guardHomeStoreUrl({ deps, request });
  if (repoint.isErr()) {
    return err(repoint.error);
  }
  if (request.dryRun) {
    return ok(emptyReport({ database: request.database, prefix }));
  }
  const action = prepareDatabase({ database: request.database, deps, marker: started.value.marker });
  if (action.isErr()) {
    return err(action.error);
  }
  const marker = started.value.marker;
  const needsBackup =
    action.value === "restore" || marker.filesRestoredAtIso === null || marker.secretsInstalledAtIso === null;
  const fetched = needsBackup ? await fetchAndDecrypt({ deps, marker, prefix, staging }) : ok(null);
  if (fetched.isErr()) {
    return err(fetched.error);
  }
  const shared = { deps, fetched: fetched.value, markerPath };
  const database = await databaseStep({ ...shared, action: action.value, marker, url: request.url });
  if (database.isErr()) {
    return err(database.error);
  }
  const files = await filesStep({ ...shared, home: request.home, marker: database.value, staging });
  if (files.isErr()) {
    return err(files.error);
  }
  const secrets = secretsStep({ ...shared, marker: files.value.marker, request, staging });
  if (secrets.isErr()) {
    return err(secrets.error);
  }
  const authored = await deps.authoredRestore({ home: request.home, url: request.url });
  if (authored.isErr()) {
    return err(authored.error);
  }
  deps.progress({ line: "  authored    the board, the journals, the boot files and the rest of the authored state" });
  return ok(
    finish({
      deps,
      fetched: fetched.value,
      files: files.value.report,
      prefix,
      request,
      secrets: secrets.value.report,
    }),
  );
}

/**
 * Check the stack is up, choose the backup and read how far an earlier run of this recovery got.
 *
 * @param request what to recover
 * @param deps the effects
 * @returns the chosen backup, its staging and marker, or why the recovery cannot start
 */
async function start({
  request,
  deps,
}: {
  request: RecoverRequest;
  deps: RecoverDeps;
}): Promise<Result<Started, RecoverError>> {
  const running = deps.stackRunning();
  if (running.isErr()) {
    return err(running.error);
  }
  if (!running.value) {
    return err(
      RecoverErrors.stackDown({ container: supabaseContainer({ service: "db" }), treeRoot: request.treeRoot }),
    );
  }
  const prefix = await deps.chooseBackup({ from: request.from });
  if (prefix.isErr()) {
    return err(prefix.error);
  }
  const made = request.stagingFor({ prefix: prefix.value });
  if (made.isErr()) {
    return err(made.error);
  }
  const staging = made.value;
  const markerPath = join(staging, "marker.json");
  const marker = resumeMarker({
    database: request.database,
    decoded: deps.readMarker({ path: markerPath }),
    prefix: prefix.value,
  });
  deps.progress({ line: `store recover: backup ${prefix.value} → database ${request.database}, home ${request.home}` });
  return ok({ marker, markerPath, prefix: prefix.value, staging });
}

/**
 * Refuse, before anything is downloaded or written, a recovery that would repoint the home's own `store-url` away
 * from a database holding a store. Nothing to check when the URL came from the environment, or when the home already
 * names the recovered database — a re-run after the credentials step landed. A dry run checks it too, so it names the
 * refusal a real run would meet.
 *
 * @param request what to recover, and the database the home's `store-url` names
 * @param deps the effects, of which only the table count is read
 * @returns nothing when the recovery may go on, else the refusal or the failed read
 */
function guardHomeStoreUrl({
  request,
  deps,
}: {
  request: RecoverRequest;
  deps: RecoverDeps;
}): Result<void, RecoverError> {
  const current = request.homeStoreDatabase;
  if (current === null || current === request.database) {
    return ok(undefined);
  }
  return deps
    .publicTables({ database: current })
    .andThen((publicTables) => homeStoreUrlRepoint({ current, publicTables, recovered: request.database }));
}

/**
 * Make the store's roles, then decide whether the database is restored here, was already, or is refused.
 *
 * @param database the database recovered into
 * @param marker how far the recovery got
 * @param deps the effects
 * @returns `restore` or `skip`, or why the database cannot be recovered into
 */
function prepareDatabase({
  database,
  marker,
  deps,
}: {
  database: string;
  marker: RecoverMarker;
  deps: RecoverDeps;
}): Result<"restore" | "skip", RecoverError> {
  const roles = deps.createRoles();
  if (roles.isErr()) {
    return err(roles.error);
  }
  deps.progress({ line: "  roles       the store's three roles exist on the stack's server" });
  const tables = deps.publicTables({ database });
  if (tables.isErr()) {
    return err(tables.error);
  }
  return databaseAction({ marker, publicTables: tables.value });
}

/**
 * Remove a finished recovery's download, and report what it did.
 *
 * @param fetched the downloaded backup, `null` when every step needing it had already landed
 * @param files what the files install did
 * @param secrets what the credentials install did
 * @param prefix the backup recovered
 * @param request what was asked for
 * @param deps the effects
 * @returns the report
 */
function finish({
  fetched,
  files,
  secrets,
  prefix,
  request,
  deps,
}: {
  fetched: Fetched | null;
  files: InstallReport | null;
  secrets: InstallReport | null;
  prefix: string;
  request: RecoverRequest;
  deps: RecoverDeps;
}): RecoverReport {
  const conflicts = [...conflictsOf({ report: files }), ...conflictsOf({ report: secrets })];
  if (conflicts.length === 0 && fetched?.source.kind === "local-destination") {
    deps.clearStaging({ path: fetched.source.directory });
    deps.progress({ line: "  download    removed — every step landed, and the marker stays for a re-run" });
  }
  return {
    complete: conflicts.length === 0,
    conflicts,
    credentialsCarried: fetched === null ? null : fetched.manifest.secrets !== null,
    database: request.database,
    dryRun: false,
    files,
    prefix,
    secrets,
  };
}

/**
 * The report for a dry run, which stops before any step.
 *
 * @param prefix the backup chosen
 * @param database the database named
 * @returns the report
 */
function emptyReport({ prefix, database }: { prefix: string; database: string }): RecoverReport {
  return {
    complete: false,
    conflicts: [],
    credentialsCarried: null,
    database,
    dryRun: true,
    files: null,
    prefix,
    secrets: null,
  };
}
