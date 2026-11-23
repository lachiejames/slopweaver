/**
 * `slopweaver store restore` — the way back from the backup `./backup.ts` takes: verify a staged backup or one
 * fetched and decrypted from the destination, restore its dump and its Vault leg into a NEW database in the local
 * stack, and optionally rebuild the
 * backed-up files and decrypt the credentials bundle. Split out of `./backup.ts` along the verb seam when
 * that file grew past the size ratchet; the parsers and lines it uses stay in `./backupCore.ts` and
 * `./backupLines.ts`.
 */
import { logger } from "../../../lib/logger.js";
import { readStdin } from "../../../lib/readStdin.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { safeJsonStringify } from "../../../lib/safeJson.js";
import { promptSecretNoEcho } from "../../../secrets/prompt.js";
import { tableCounts } from "../../../store/backup/counts.js";
import { parseBackupSourceAddress } from "../../../store/backup/destination.js";
import { backupErrorLines } from "../../../store/backup/errors.js";
import { openDestinationBackup } from "../../../store/backup/keyWrapStore.js";
import { localDirectoryTransport } from "../../../store/backup/localDirectoryTransport.js";
import { type BackupManifest, SUPABASE_PROJECT_ID, withDatabase } from "../../../store/backup/plan.js";
import { type RestoreDeps, type RestoreReport, runRestore } from "../../../store/backup/restore.js";
import { type FilesRestoreReport, runRestoreFiles } from "../../../store/backup/restoreFiles.js";
import { runRestoreSecrets, type SecretsRestoreReport } from "../../../store/backup/restoreSecrets.js";
import { type RestoreSource, resolveRestoreSource } from "../../../store/backup/restoreSource.js";
import { digestFile, listArchive, untarStorage } from "../../../store/backup/stack.js";
import {
  createDatabase,
  createExtension,
  databaseExists,
  dropDatabase,
  restoreDatabase,
  targetShape,
} from "../../../store/backup/stackDatabase.js";
import { restoreVault } from "../../../store/backup/vault.js";
import { storeUrl } from "../../../store/config.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK } from "../../exitCodes.js";
import { parseStoreRestoreArgs, type StoreRestoreArgs } from "./backupCore.js";
import { filesRestoreLines, restoreLines, secretsRestoreLines } from "./backupLines.js";
import { destinationReader, fail, optionalBackupKey, refuse, resolvedHome } from "./verbShell.js";

const RESTORE_USAGE =
  "usage: slopweaver store restore --from <staging dir | <destination>/<project>/<instant>> --into <database>\n" +
  "                                [--compare] [--drop-after] [--files-into <dir>] [--secrets-into <dir>]\n" +
  "                                [--storage --overwrite-storage] [--home <dir>] [--json]\n" +
  "  A destination address opens with the master password, read once from a no-echo prompt or piped stdin and\n" +
  "  never from argv: it unwraps the backup key from <project>/keys/<fingerprint>.wrap beside the backup, so\n" +
  "  no Keychain is needed. A staging directory uses the login Keychain's key. A path or a file:// URL both\n" +
  "  work. Verifies the manifest's digests, creates <database> in the stack (refusing one that exists) and\n" +
  "  pg_restores into it, then re-creates the Vault leg's secrets in it, counted.\n" +
  "  --compare counts every table on the live store and the copy; --drop-after removes the copy once reported.\n" +
  "  --files-into rebuilds every backed-up root from the destination's blobs under <dir> and verifies every\n" +
  "  digest. --secrets-into decrypts the credentials bundle under <dir> with the same master password.\n" +
  "  --storage unpacks the tar over the LIVE Storage volume and needs its hatch.";

/** The stack effects a restore performs through — the production set, named once, and `store recover`'s too. */
export const RESTORE_DEPS: RestoreDeps = {
  createDatabase,
  createExtension,
  databaseExists,
  digestFile,
  dropDatabase,
  listArchive,
  restoreDatabase,
  restoreVault,
  tableCounts,
  targetShape,
  untarStorage,
};

/**
 * Rebuild the backed-up files when `--files-into` asked for them, else nothing.
 *
 * @param args what the invocation asked for
 * @param key the backup key the destination's blobs are opened with, or `null`
 * @param source where the backup was resolved from
 * @returns the report, `null` when the invocation did not ask, or why it could not be done
 */
async function maybeRestoreFiles({
  args,
  key,
  source,
}: {
  args: StoreRestoreArgs;
  key: Buffer | null;
  source: RestoreSource;
}): Promise<Result<FilesRestoreReport | null>> {
  if (args.filesInto === undefined || source.kind !== "local-destination") {
    return ok(null);
  }
  const transport = destinationReader({ key })({ root: source.root });
  if (transport.isErr()) {
    return err(transport.error);
  }
  const restored = await runRestoreFiles({ into: args.filesInto, source, transport: transport.value });
  return restored.mapErr((error) => backupErrorLines({ error }));
}

/**
 * The master password, from piped stdin when stdin is not a terminal and otherwise a no-echo prompt — never
 * argv, which reaches `ps`, the shell history and the door ledger.
 *
 * @returns the one line pasted out of the operator's password manager, its trailing newline removed
 */
export async function promptMasterPassword(): Promise<string> {
  if (process.stdin.isTTY) {
    return promptSecretNoEcho({ prompt: "backup master password (from your password manager): " });
  }
  return (await readStdin()).replace(/\r?\n$/, "");
}

/**
 * The key a restore opens its backup with, decided by WHERE `--from` points before anything else is read.
 *
 * A destination backup opens with the master password — read ONCE, here, and handed on so `--secrets-into` never
 * asks again — which unwraps the key from the wrap beside it; the Keychain is not consulted, because the Mac
 * restoring may not be the one that made it. A staging on this machine keeps the Keychain key its Vault leg was
 * sealed under, and may carry none.
 *
 * @param args the parsed invocation
 * @returns the key (or `null` for a staging with none) and the password when one was read, or why neither was
 */
async function restoreKey({
  args,
}: {
  args: StoreRestoreArgs;
}): Promise<Result<{ key: Buffer | null; password: string | null }>> {
  const address = parseBackupSourceAddress({ from: args.from, project: SUPABASE_PROJECT_ID });
  if (address.isErr()) {
    return err(backupErrorLines({ error: address.error }));
  }
  if (address.value.kind === "staging") {
    const held = optionalBackupKey();
    if (held.isErr()) {
      return err(held.error);
    }
    return ok({ key: held.value === null ? null : held.value.key, password: null });
  }
  const password = await promptMasterPassword();
  const opened = await openDestinationBackup({
    password,
    prefix: address.value.prefix,
    project: SUPABASE_PROJECT_ID,
    transport: localDirectoryTransport({ root: address.value.root, rootPolicy: "require-existing" }),
  });
  if (opened.isErr()) {
    return err([opened.error.message]);
  }
  return ok({ key: opened.value.key, password });
}

/**
 * Decrypt the credentials bundle, when `--secrets-into` was passed.
 *
 * **The password is never parsed from argv.** A destination restore already read it to open the backup and hands
 * it in; a staging restore reads it here, from piped stdin or a no-echo prompt — the same path `secrets set`
 * uses to capture a token.
 *
 * @param args the parsed invocation
 * @param source where the downloaded or staged files are
 * @param manifest the verified manifest, which is what says whether a bundle is expected
 * @param password the master password already read for this run, or `null` when none was
 * @returns what was written, `null` when it was not asked for, or why nothing was
 */
async function maybeRestoreSecrets({
  args,
  source,
  manifest,
  password,
}: {
  args: StoreRestoreArgs;
  source: RestoreSource;
  manifest: BackupManifest;
  password: string | null;
}): Promise<Result<SecretsRestoreReport | null>> {
  if (args.secretsInto === undefined) {
    return ok(null);
  }
  const passphrase = await passwordOrPrompt({ password });
  const restored = runRestoreSecrets({ into: args.secretsInto, manifest, passphrase, source });
  return restored.isErr() ? err([restored.error.message]) : ok(restored.value);
}

/**
 * The master password the verb already read, or the hidden prompt's answer when it read none.
 *
 * @param password the password read from this Mac's secrets, or `null` on a machine that has none
 * @returns the password to open the credentials leg with
 */
async function passwordOrPrompt({ password }: { password: string | null }): Promise<string> {
  if (password !== null) {
    return password;
  }
  return promptMasterPassword();
}

/**
 * Print what a restore did, as one document or as lines.
 *
 * @param report the database half
 * @param files the files half, or `null` when it was not asked for
 * @param secrets the credentials half, or `null` when it was not asked for
 * @param json whether to emit one machine-readable document
 */
function reportRestore({
  report,
  files,
  secrets,
  json,
}: {
  report: RestoreReport;
  files: FilesRestoreReport | null;
  secrets: SecretsRestoreReport | null;
  json: boolean;
}): void {
  if (json) {
    logger.out({ line: safeJsonStringify({ label: "store restore", value: { ...report, files, secrets } }) });
    return;
  }
  restoreLines({ report }).forEach((line) => {
    logger.out({ line });
  });
  if (files !== null) {
    filesRestoreLines({ report: files }).forEach((line) => {
      logger.out({ line });
    });
  }
  if (secrets !== null) {
    secretsRestoreLines({ report: secrets }).forEach((line) => {
      logger.out({ line });
    });
  }
}

/**
 * Resolve everything a restore needs before it touches the stack: the store selection, the connection
 * string for the copy, and the directory the backup's files are in.
 *
 * @param args what the invocation asked for
 * @param home the Slopweaver home
 * @param key the backup key a destination's objects are opened with, or `null`
 * @returns the three, or every reason one of them could not be resolved
 */
async function resolveRestoreInputs({
  args,
  home,
  key,
}: {
  args: StoreRestoreArgs;
  home: string;
  key: Buffer | null;
}): Promise<Result<{ liveUrl: string; restoredUrl: string; source: RestoreSource }>> {
  const url = storeUrl({ home });
  if (url.isErr()) {
    return err([url.error.message]);
  }
  const restoredUrl = withDatabase({ database: args.into, url: url.value });
  const source = await resolveRestoreSource({
    from: args.from,
    home,
    transportFor: destinationReader({ key }),
    writesTo: [
      ...(args.filesInto === undefined ? [] : [{ path: args.filesInto, role: "--files-into" }]),
      ...(args.secretsInto === undefined ? [] : [{ path: args.secretsInto, role: "--secrets-into" }]),
    ],
  });
  if (restoredUrl.isErr() || source.isErr()) {
    return err([
      ...(restoredUrl.isErr() ? backupErrorLines({ error: restoredUrl.error }) : []),
      ...(source.isErr() ? backupErrorLines({ error: source.error }) : []),
    ]);
  }
  return ok({ liveUrl: url.value, restoredUrl: restoredUrl.value, source: source.value });
}

/**
 * Restore a backup into a fresh database, and optionally prove it against the live one.
 *
 * @param argv the full process argv
 * @returns the process exit code
 */
export async function runStoreRestore(argv: readonly string[]): Promise<number> {
  const rest = argv.slice(argv[3] === "restore" ? 4 : 3);
  if (rest.includes("--help") || rest.includes("-h")) {
    logger.out({ line: RESTORE_USAGE });
    return EXIT_OK;
  }
  const parsed = parseStoreRestoreArgs({ rest });
  if (parsed.isErr()) {
    return refuse({ lines: parsed.error, usage: RESTORE_USAGE });
  }
  const args = parsed.value;
  const home = resolvedHome({ home: args.home });
  const opened = await restoreKey({ args });
  if (opened.isErr()) {
    return fail({ lines: opened.error });
  }
  const { key, password } = opened.value;
  const resolved = await resolveRestoreInputs({ args, home, key });
  if (resolved.isErr()) {
    return fail({ lines: resolved.error });
  }
  const { liveUrl, restoredUrl, source } = resolved.value;
  const report = await runRestore({
    database: args.into,
    deps: RESTORE_DEPS,
    dropAfter: args.dropAfter,
    key,
    liveUrl: args.compare ? liveUrl : null,
    restoreStorage: args.storage,
    restoredUrl,
    source,
  });
  if (report.isErr()) {
    return fail({ lines: backupErrorLines({ error: report.error }) });
  }
  const files = await maybeRestoreFiles({ args, key, source });
  if (files.isErr()) {
    return fail({ lines: files.error });
  }
  const secrets = await maybeRestoreSecrets({ args, manifest: report.value.manifest, password, source });
  if (secrets.isErr()) {
    return fail({ lines: secrets.error });
  }
  reportRestore({ files: files.value, json: args.json, report: report.value, secrets: secrets.value });
  const countsIdentical = report.value.comparison === null || report.value.comparison.identical;
  return countsIdentical ? EXIT_OK : EXIT_ERROR;
}

export const storeRestoreCommand = defineCommand({ run: runStoreRestore });
