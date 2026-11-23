/**
 * `slopweaver store backup` and `store backup-register` — the backup leg for the local Supabase store, into a LIST
 * of local directories, every object encrypted under a backup key held in the login Keychain (Vault's table in the
 * nightly dump, a Keychain key the nightly run opens with no prompt, an encrypted object
 * format, a local destination, no cloud; one encrypt-and-send path to a list of local
 * destinations — this Mac's folder for rollback and the pinned SSD for disaster recovery — and only local ones).
 *
 * The thin dispatch shell: parsers and the recipe rows are in `./backupCore.ts`, the night in `./backupRun.ts`, the
 * sweep in `./backupSweepRun.ts`, one door per destination in `./backupTargets.ts`, `--status` and `--check` in
 * `./backupProbes.ts` over the pure `./backupStatus.ts`, the rendered lines in `./backupLines.ts`, and the
 * orchestration in `src/store/backup/run.ts`. `store restore`, the way back, is `./restoreRun.ts`.
 *
 * **Who runs it.** The recipe scheduler session, on its `automation run-due` tick, once `store backup-register` has
 * written the rows — there is no cron and no launch agent (AGENTS.md rule 2). A night that
 * could not stage, or whose send to any destination failed, exits non-zero, which `run-due` records against the
 * row; every night overwrites `$SLOPWEAVER_HOME/backups/store/last.json`, which `store backup --status` reads.
 */
import { join } from "node:path";

import { logger } from "../../../lib/logger.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { safeJsonStringify } from "../../../lib/safeJson.js";
import type { RecipeDefinition } from "../../../live/automation/definition.js";
import { writeDefinitionKeepingHold } from "../../../live/automation/failureHoldStore.js";
import { stateHomePaths } from "../../../stateHome.js";
import { storeUrl } from "../../../store/config.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK } from "../../exitCodes.js";
import {
  BACKUP_RECIPE_ID,
  BACKUP_SWEEP_CADENCE,
  BACKUP_SWEEP_RECIPE_ID,
  backupRecipeDefinition,
  backupSweepRecipeDefinition,
  DEFAULT_BACKUP_CADENCE,
  parseStoreBackupArgs,
  parseStoreBackupRegisterArgs,
  type StoreBackupArgs,
} from "./backupCore.js";
import { reportCopyMasterPassword, reportCreateMasterPassword } from "./backupMasterPassword.js";
import { reportCheck, reportCreateKey, reportStatus } from "./backupProbes.js";
import { reportNight } from "./backupRun.js";
import { reportSweepOnly } from "./backupSweepRun.js";
import { reportDestinationChange } from "./destinationSettingsReport.js";
import { storeCommandErrorLines } from "./errors.js";
import { fail, refuse, resolvedHome } from "./verbShell.js";

const BACKUP_USAGE =
  "usage: slopweaver store backup [--local-only | --check | --status | --sweep-only | --create-key |\n" +
  "                                --create-master-password | --copy-master-password |\n" +
  "                                --set-destination <address> | --add-destination <address> |\n" +
  "                                --remove-destination <address>]\n" +
  "                               [--destination <address>] [--keep-local <n>] [--home <dir>] [--json]\n" +
  "  Dumps the store's database, tars the Storage volume and seals Vault's secrets under the backup key into\n" +
  "  $SLOPWEAVER_HOME/backups/store/<instant>/, encrypts every credential under the master password\n" +
  "  (`secrets/backup-passphrase`) beside them, then writes each file, encrypted under the backup key, to EVERY\n" +
  "  destination on the list in order, each under <project>/<instant>/, verified, with its own receipt. The list\n" +
  "  is secrets/store-backup-directory, one address per line; --destination or SLOPWEAVER_BACKUP_DIRECTORY\n" +
  "  replaces it with one address for one run. The dump and every file of 64 MiB or more go as the\n" +
  "  content-defined chunks a destination lacks, so a night writes what changed.\n" +
  "  The backup key is 32 random bytes in the login Keychain (service slopweaver-backup-key), read with no\n" +
  "  prompt; --create-key makes it once and refuses to replace one. Every earlier backup needs it.\n" +
  "  The master password wraps that key at <project>/keys/<fingerprint>.wrap on every destination, checked before\n" +
  "  every backup (written once, never replaced, and the run refused when it does not open), so a lost Mac opens\n" +
  "  the backups with the password alone. --create-master-password generates it once (128\n" +
  "  random bits, 26 characters), copies it to the clipboard for your password manager and never prints it;\n" +
  "  --copy-master-password copies it again.\n" +
  "  --local-only stages and stops; --check probes every destination, reads the key and says per destination\n" +
  "  whether it holds the key's wrap, without dumping;\n" +
  "  --status reports the most recent attempt and, per destination, when bytes last reached it, and exits\n" +
  "  non-zero unless that attempt wrote to a destination and failed at none — a --local-only run is a red.\n" +
  "  A writing run NAMES any earlier staging a destination never got, and writes none of it.\n" +
  "  --sweep-only writes every staging each destination never got, newest first, takes NO new dump, and leaves\n" +
  "  last.json as the night wrote it. --keep-local keeps n written copies on disk (default 1).\n" +
  "  An address is an absolute path or a file:// URL; s3://, gs:// and drive:// are refused as not built.\n" +
  "  --set-destination replaces the list with one address, --add-destination appends one and\n" +
  "  --remove-destination drops one, and none runs anything else; an address on an external drive\n" +
  "  (/Volumes/<name>/…) also pins the volume mounted there by UUID, refusing when none is.\n" +
  "  A night that finds a pinned drive out stages here, records DRIVE NOT PLUGGED IN for that destination and\n" +
  "  still writes the others; --sweep-only with every drive out sends nothing, reads no key and exits 0; a\n" +
  "  different volume is refused.\n" +
  "  The owner's protected paths (`slopweaver protect`) bind every mode: a source under a no-access path is\n" +
  "  never listed or read and is printed as NOT backed up with the owner's reason; a destination at or under\n" +
  "  any protected path, or holding a no-access one, fails as HELD; a protected staging root or secrets/, or\n" +
  "  a registry that cannot be read, holds the whole run and exits non-zero, --status included.";
const REGISTER_USAGE =
  `usage: slopweaver store backup-register [--cadence "<cron>"] [--home <dir>] [--json]\n` +
  `  Writes the ${BACKUP_RECIPE_ID} verb-run row into $SLOPWEAVER_HOME/live/recipe/definitions (default cadence\n` +
  `  "${DEFAULT_BACKUP_CADENCE}", local time) and the ${BACKUP_SWEEP_RECIPE_ID} row, which runs\n` +
  `  store backup --sweep-only at "${BACKUP_SWEEP_CADENCE}" (--cadence moves only the daily row), so a night the\n` +
  `  drive was out starts sending at the first firing after it is plugged in — while the scheduler ticks and the\n` +
  `  row is not held. A hold on either row survives. The recipe scheduler's run-due tick runs both; nothing else does.`;

/**
 * The modes that are not a backup — each one decided by a flag, and each answered without dumping anything.
 *
 * @param args the parsed invocation
 * @param home the Slopweaver home
 * @returns the mode's exit code, or `null` when the invocation is a backup
 */
function reportMode({ args, home }: { args: StoreBackupArgs; home: string }): Promise<number> | number | null {
  if (args.status) {
    return reportStatus({ home, json: args.json });
  }
  if (args.createKey) {
    return reportCreateKey({ json: args.json });
  }
  if (args.createMasterPassword) {
    return reportCreateMasterPassword({ home, json: args.json, override: args.destination });
  }
  if (args.copyMasterPassword) {
    return reportCopyMasterPassword({ home, json: args.json });
  }
  if (args.check) {
    return reportCheck({ home, json: args.json, override: args.destination });
  }
  if (args.sweepOnly) {
    return reportSweepOnly({ home, json: args.json, keepLocal: args.keepLocal, override: args.destination });
  }
  if (args.destinationChange !== null) {
    const { address, change } = args.destinationChange;
    return reportDestinationChange({ address, change, home, json: args.json });
  }
  return null;
}

/**
 * Back the store up: stage once, then send to every destination on the list.
 *
 * @param argv the full process argv
 * @returns the process exit code
 */
export async function runStoreBackup(argv: readonly string[]): Promise<number> {
  const rest = argv.slice(argv[3] === "backup" ? 4 : 3);
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: BACKUP_USAGE });
    return EXIT_OK;
  }
  const parsed = parseStoreBackupArgs({ rest });
  if (parsed.isErr()) {
    return refuse({ lines: parsed.error, usage: BACKUP_USAGE });
  }
  const args = parsed.value;
  const home = resolvedHome({ home: args.home });
  const mode = reportMode({ args, home });
  if (mode !== null) {
    return mode;
  }
  const url = storeUrl({ home });
  if (url.isErr()) {
    return fail({ lines: [url.error.message] });
  }
  return reportNight({ args, home, nowIso: new Date().toISOString(), storeSelection: url.value });
}

/**
 * Write the daily backup's recipe row and the hourly sweep's.
 *
 * @param argv the full process argv
 * @returns the process exit code
 */
export function runStoreBackupRegister(argv: readonly string[]): number {
  const rest = argv.slice(argv[3] === "backup-register" ? 4 : 3);
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: REGISTER_USAGE });
    return EXIT_OK;
  }
  const parsed = parseStoreBackupRegisterArgs({ rest });
  if (parsed.isErr()) {
    return refuse({ lines: storeCommandErrorLines({ error: parsed.error }), usage: REGISTER_USAGE });
  }
  const home = resolvedHome({ home: parsed.value.home });
  const nowIso = new Date().toISOString();
  const daily = writeRow({ definition: backupRecipeDefinition({ cadence: parsed.value.cadence }), home, nowIso });
  if (daily.isErr()) {
    logger.error({ msg: `store backup-register: ${daily.error}` });
    return EXIT_ERROR;
  }
  const sweep = writeRow({ definition: backupSweepRecipeDefinition(), home, nowIso });
  if (sweep.isErr()) {
    logger.error({ msg: `store backup-register: ${sweep.error}` });
    return EXIT_ERROR;
  }
  if (parsed.value.json) {
    // The daily row's fields stay at the top level, where they always were; the sweep row sits beside them.
    logger.out({
      line: safeJsonStringify({ label: "store backup-register", value: { ...daily.value, sweep: sweep.value } }),
    });
  } else {
    [daily.value, sweep.value].forEach((row) => {
      logger.out({
        line: `store backup-register: ${row.replaced ? "replaced" : "wrote"} ${row.path} (cadence "${row.definition.cadence}", local time)`,
      });
    });
  }
  return EXIT_OK;
}

/**
 * Write one backup recipe row into the home's definition store, keeping a hold already standing on it.
 *
 * @param definition the row to write
 * @param home the Slopweaver home
 * @param nowIso the instant the write is stamped with
 * @returns what was written and whether it replaced a row, or the reason it could not be written
 */
function writeRow({
  definition,
  home,
  nowIso,
}: {
  definition: RecipeDefinition;
  home: string;
  nowIso: string;
}): Result<{ readonly definition: RecipeDefinition; readonly path: string; readonly replaced: boolean }, string> {
  const path = join(stateHomePaths({ home }).live.recipe.definitionsDir, `${definition.recipeId}.json`);
  const outcome = writeDefinitionKeepingHold({ definition, home, nowIso, path });
  if (outcome.isErr()) {
    return err(outcome.error.message);
  }
  return ok({ definition: outcome.value.written, path, replaced: outcome.value.replaced });
}

export const storeBackupCommand = defineCommand({ run: runStoreBackup });
export const storeBackupRegisterCommand = defineCommand({ run: runStoreBackupRegister });
