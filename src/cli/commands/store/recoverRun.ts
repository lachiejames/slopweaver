/**
 * `slopweaver store recover` — the one command that brings a wiped Mac back from the encrypted local-destination
 * backup: the store,
 * the files, the credentials, the board and the boot files, into one home. The sequence is
 * `src/store/backup/recover.ts`; this shell resolves what it needs, hands it the real effects, and prints.
 *
 * Every effect below is an existing verb's own production path — `store restore`'s restore deps and master-password
 * read, the key wrap's opener, the rehearsal's role statements and backup chooser, `store push`'s apply, `store authored-restore`
 * itself — so a recovery runs exactly what those verbs were proven running, in the order the runbook gave.
 */
import { logger } from "#lib/logger.js";
import { installedTreeRoot } from "#lib/pluginRoot.js";
import { err, ok, type Result } from "#lib/result.js";

import { backupErrorLines } from "../../../store/backup/errors.js";
import { supabaseContainer } from "../../../store/backup/plan.js";
import { runRecover } from "../../../store/backup/recover.js";
import { type RecoverError, RecoverErrors } from "../../../store/backup/recoverErrors.js";
import {
  clearStaging,
  installStagedFiles,
  makeRecoverStaging,
  readRecoverMarker,
  writeRecoverMarker,
} from "../../../store/backup/recoverFiles.js";
import { type RecoveredStoreUrl, recoveredStoreUrl } from "../../../store/backup/recoverPlan.js";
import { installStagedSecrets } from "../../../store/backup/recoverSecrets.js";
import type { RecoverDeps } from "../../../store/backup/recoverSteps.js";
import { runRestore } from "../../../store/backup/restore.js";
import { QUERY_STEP_TIMEOUT_MS, run } from "../../../store/backup/stack.js";
import { databaseExists, runStatementIn, targetShape } from "../../../store/backup/stackDatabase.js";
import { STORE_URL_ENV, storeUrlSelection } from "../../../store/config.js";
import { storeErrorLines } from "../../../store/errors.js";
import { pushStore } from "../../../store/lifecycle.js";
import { isLocalStoreUrl } from "../../../store/localStoreUrl.js";
import { storeRoleStatements } from "../../../store/policies.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK } from "../../exitCodes.js";
import { productionAuthoredVerbDeps } from "./authoredDeps.js";
import { runStoreAuthoredRestore } from "./authoredRun.js";
import { storeCommandErrorLines } from "./errors.js";
import { parseStoreRecoverArgs, recoverReportLines } from "./recoverCore.js";
import {
  type BackupSession,
  backupDeps,
  backupSession,
  type RecoverReader,
  recoverReader,
  stepFailed,
} from "./recoverSession.js";
import { RESTORE_DEPS } from "./restoreRun.js";
import { fail, refuse, resolvedHome } from "./verbShell.js";

const RECOVER_USAGE =
  "usage: slopweaver store recover [--destination <dir>] [--from <project>/<instant>/] [--into <database>] [--dry-run] [--home <dir>]\n" +
  "  Brings a home back from the encrypted local-destination backup in one run: checks the local Supabase stack\n" +
  "  is up, creates the store's roles, then asks ONCE for the master password you paste from your password\n" +
  "  manager (never argv) and unwraps the newest backup's (or --from's) key from the wrap beside it — the\n" +
  "  Keychain is never read — fetches, decrypts and digest-verifies it, decrypts its credentials under the same\n" +
  "  password, restores the database and its Vault secrets into --into (default store_recovered) and applies\n" +
  "  this checkout's migrations, rebuilds the files leg into the home, writes the credentials, store-url and\n" +
  "  backup-passphrase into secrets/, then restores the board, the journals and the boot files from the\n" +
  "  recovered store. Nothing the home already holds is overwritten; a difference is left in staging and named.\n" +
  "  The one exception: the home's own secrets/store-url is repointed at --into when the database is its only\n" +
  "  difference, and the report names both databases. It is refused before any download when the database it\n" +
  "  names holds a store. Needs a selected store: run `yarn store:start` first.\n" +
  "  --dry-run only chooses the backup and asks for nothing. Run it again to resume. See docs/store/new-machine.md.";

/**
 * The recovered database's connection string: the selected store rewritten to name it, with no store selected
 * refused (run `yarn store:start` first) rather than guessed. A non-local result is refused — a recovery
 * restores into THIS machine's stack — checked again on the derived URL, not only on the selection.
 *
 * @param home the home being recovered
 * @param database the recovered database
 * @returns the URL and whether it may repoint the home's own `store-url`, or why none could be derived
 */
function recoveredUrl({ home, database }: { home: string; database: string }): Result<RecoveredStoreUrl, RecoverError> {
  const selection = storeUrlSelection({ home });
  if (selection.isErr() && selection.error.code !== "STORE_URL_MISSING") {
    return err(RecoverErrors.urlUnresolved({ reasons: [selection.error.message] }));
  }
  const url = recoveredStoreUrl({
    database,
    selection: selection.isOk() ? { origin: selection.value.origin, url: selection.value.url } : null,
  });
  if (url.isOk() && !isLocalStoreUrl({ url: url.value.url })) {
    return err(RecoverErrors.urlUnresolved({ reasons: ["the selected store reaches another host"] }));
  }
  return url;
}

/** The effects that act on the local stack's database server. */
type StackDeps = Pick<RecoverDeps, "createRoles" | "migrate" | "publicTables" | "restoreDatabase" | "stackRunning">;

/**
 * The production effects, over a resolved destination opened with the master password.
 *
 * @param home the home being recovered
 * @param reader the destination and its plain transport
 * @param url the recovered database's connection string
 * @returns every effect the sequence performs
 */
function productionDeps({ home, reader, url }: { home: string; reader: RecoverReader; url: string }): RecoverDeps {
  const session = backupSession({ reader });
  return {
    ...backupDeps({ home, reader, session }),
    ...stackDeps({ session, url }),
    authoredRestore: async ({ home: target, url: storeUrlValue }) => {
      const env = { ...process.env, [STORE_URL_ENV]: storeUrlValue };
      const code = await runStoreAuthoredRestore({
        deps: productionAuthoredVerbDeps({ env }),
        rest: ["--home", target],
      });
      if (code === EXIT_OK) {
        return ok(undefined);
      }
      return err(
        stepFailed({
          reasons: ["store authored-restore reported a failure above"],
          step: "restoring the authored state",
        }),
      );
    },
    clearStaging,
    // The destination is kept out of every install: a link in the home must not carry a restored file into it.
    installFiles: (args) => installStagedFiles({ ...args, destination: reader.root }),
    installSecrets: (args) => installStagedSecrets({ ...args, destination: reader.root }),
    nowIso: () => new Date().toISOString(),
    progress: ({ line }) => {
      logger.out({ line });
    },
    masterPassword: session.masterPassword,
    readMarker: readRecoverMarker,
    writeMarker: writeRecoverMarker,
  };
}

/**
 * Apply every migration this checkout carries to the recovered database, through `store push`'s own path, and
 * verify the schema it leaves.
 *
 * @param url the recovered database's connection string
 * @returns nothing, or the migration or schema finding that stopped it
 */
async function migrateRecovered({ url }: { url: string }): Promise<Result<void, RecoverError>> {
  const pushed = await pushStore({
    cwd: installedTreeRoot({ importMetaUrl: import.meta.url }),
    generate: false,
    url,
  });
  if (pushed.isErr()) {
    return err(
      stepFailed({ reasons: storeErrorLines({ error: pushed.error }), step: "applying this checkout's migrations" }),
    );
  }
  const findings = pushed.value.verify.findings;
  if (findings.length > 0) {
    return err(
      stepFailed({ reasons: findings.map((finding) => JSON.stringify(finding)), step: "verifying the schema" }),
    );
  }
  return ok(undefined);
}

/**
 * How many tables a stack database's `public` schema holds, `0` when the database does not exist.
 *
 * @param database the database on the local stack
 * @returns the count, or why the stack could not be read
 */
function publicTablesIn({ database }: { database: string }): Result<number, RecoverError> {
  const exists = databaseExists({ database });
  if (exists.isErr()) {
    return err(
      stepFailed({ reasons: backupErrorLines({ error: exists.error }), step: "reading the stack's databases" }),
    );
  }
  if (!exists.value) {
    return ok(0);
  }
  return targetShape({ database })
    .map((shape) => shape.publicTables)
    .mapErr((error) => stepFailed({ reasons: backupErrorLines({ error }), step: `reading ${database}` }));
}

/**
 * The production effects on the local stack: the store's roles, the restore, and this checkout's migrations.
 *
 * @param session the opened backup, whose key the Vault leg is opened with
 * @param url the recovered database's connection string
 * @returns those effects
 */
function stackDeps({ session, url }: { session: BackupSession; url: string }): StackDeps {
  const container = supabaseContainer({ service: "db" });
  return {
    createRoles: () => {
      for (const statement of storeRoleStatements()) {
        const made = runStatementIn({
          container,
          database: "postgres",
          label: "creating the store's roles",
          statement,
        });
        if (made.isErr()) {
          return err(
            stepFailed({ reasons: backupErrorLines({ error: made.error }), step: "creating the store's roles" }),
          );
        }
      }
      return ok(undefined);
    },
    migrate: migrateRecovered,
    publicTables: publicTablesIn,
    restoreDatabase: async ({ source, database }) => {
      const opened = session.opened();
      if (opened.isErr()) {
        return err(opened.error);
      }
      return (
        await runRestore({
          database,
          deps: RESTORE_DEPS,
          dropAfter: false,
          key: opened.value.key,
          liveUrl: null,
          restoreStorage: false,
          restoredUrl: url,
          source,
        })
      )
        .map(() => undefined)
        .mapErr((error) => stepFailed({ reasons: backupErrorLines({ error }), step: "restoring the database" }));
    },
    stackRunning: () =>
      ok(
        run({
          args: ["container", "inspect", "--format", "{{.State.Running}}", container],
          command: "docker",
          label: `docker inspect ${container}`,
          stdio: ["ignore", "pipe", "pipe"],
          timeoutMs: QUERY_STEP_TIMEOUT_MS,
        }).match(
          (out) => out.trim() === "true",
          () => false,
        ),
      ),
  };
}

/**
 * Recover a home from the destination's backup.
 *
 * @param argv the full process argv
 * @returns the process exit code — 0 whole, 1 stopped or left something in staging, 2 refused before anything ran
 */
export async function runStoreRecover(argv: readonly string[]): Promise<number> {
  const rest = argv.slice(argv[3] === "recover" ? 4 : 3);
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: RECOVER_USAGE });
    return EXIT_OK;
  }
  const parsed = parseStoreRecoverArgs({ rest });
  if (parsed.isErr()) {
    return refuse({ lines: storeCommandErrorLines({ error: parsed.error }), usage: RECOVER_USAGE });
  }
  const args = parsed.value;
  const home = resolvedHome({ home: args.home });
  const treeRoot = installedTreeRoot({ importMetaUrl: import.meta.url });
  const url = recoveredUrl({ database: args.database, home });
  if (url.isErr()) {
    return fail({ lines: [`store recover: ${url.error.message}`] });
  }
  const reader = recoverReader({ home, override: args.destination });
  if (reader.isErr()) {
    return fail({ lines: reader.error });
  }
  const report = await runRecover({
    deps: productionDeps({ home, reader: reader.value, url: url.value.url }),
    request: {
      database: args.database,
      dryRun: args.dryRun,
      from: args.from,
      home,
      homeStoreDatabase: url.value.homeStoreDatabase,
      stagingFor: ({ prefix }) => makeRecoverStaging({ home, prefix }),
      treeRoot,
      url: url.value.url,
    },
  });
  if (report.isErr()) {
    return fail({ lines: [`store recover: ${report.error.message}`] });
  }
  recoverReportLines({ home, report: report.value }).forEach((line) => {
    logger.out({ line });
  });
  return report.value.complete || report.value.dryRun ? EXIT_OK : EXIT_ERROR;
}

export const storeRecoverCommand = defineCommand({ run: runStoreRecover });
