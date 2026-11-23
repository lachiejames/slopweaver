/**
 * Steps 1 to 3 of one backup: reach the stack, dump and tar into a fresh staging directory, stage the credentials
 * and Vault legs, digest everything and write the manifest that describes it. The order and why is in `./run.ts`,
 * which drives this and then the files leg and the upload.
 *
 * Split from `./run.ts` when it grew past the size ratchet: this half writes the staging directory, that half
 * sends it.
 */
import { join } from "node:path";

import { writeJsonFile } from "#lib/jsonFile.js";
import { err, ok, type Result } from "#lib/result.js";

import { planFileChunks } from "./chunks.js";
import { type BackupError, BackupErrors, backupErrorLines } from "./errors.js";
import {
  BACKUP_FILES,
  BACKUP_MANIFEST_VERSION,
  type BackupArtefact,
  type BackupManifest,
  DUMPED_SCHEMAS,
  type DumpArtefact,
  databaseNameOf,
  SUPABASE_PROJECT_ID,
  supabaseContainer,
  type VaultArtefact,
} from "./plan.js";
import type { BackupDeps } from "./run.js";
import { stageSecretsLeg } from "./stageSecrets.js";
import { makeStagingDirectory } from "./stagingDirectory.js";

/**
 * Digest the dump and the tar together, so a failure names every side that failed rather than the first,
 * and cut the dump into the chunks it will be sent as.
 *
 * @param dumpPath the staged dump
 * @param tarPath the staged Storage tar
 * @param deps the stack effects
 * @returns both digests and the dump's chunk list, or one line per side that could not be digested
 */
function digestPair({
  deps,
  dumpPath,
  tarPath,
}: {
  deps: BackupDeps;
  dumpPath: string;
  tarPath: string;
}): Result<{ dump: DumpArtefact; storage: BackupArtefact }, BackupError> {
  const dump = deps.digestFile({ path: dumpPath });
  const storage = deps.digestFile({ path: tarPath });
  if (dump.isErr() || storage.isErr()) {
    const lines = [dump, storage].flatMap((side) => (side.isErr() ? backupErrorLines({ error: side.error }) : []));
    return err(BackupErrors.stepFailed({ reasons: lines }));
  }
  const planned = planFileChunks({ encoding: "identity", path: dumpPath });
  if (planned.isErr()) {
    return err(BackupErrors.stepFailed({ reasons: [planned.error.message] }));
  }
  // Two reads of one staged file nothing else writes; disagreeing would mean the chunk list describes other bytes.
  if (planned.value.sha256 !== dump.value.sha256 || planned.value.bytes !== dump.value.bytes) {
    const why = `the dump's chunks rebuild ${String(planned.value.bytes)} byte(s), not the ${String(dump.value.bytes)} it digested to`;
    return err(BackupErrors.stepFailed({ reasons: [why] }));
  }
  return ok({ dump: { ...dump.value, chunked: planned.value.content }, storage: storage.value });
}

/**
 * Dump the database and tar Storage into the staging directory, then digest both.
 *
 * @param database the database to dump
 * @param directory the staging directory, already made
 * @param deps the stack effects
 * @returns both digests and the dump's chunk list, or the first step that failed
 */
function dumpAndTar({
  database,
  directory,
  deps,
}: {
  database: string;
  directory: string;
  deps: BackupDeps;
}): Result<{ dump: DumpArtefact; storage: BackupArtefact }, BackupError> {
  const dumpPath = join(directory, BACKUP_FILES.dump);
  const dumped = deps.dumpDatabase({ database, path: dumpPath });
  if (dumped.isErr()) {
    return err(dumped.error);
  }
  const tarPath = join(directory, BACKUP_FILES.storage);
  const tarred = deps.tarStorage({ path: tarPath });
  if (tarred.isErr()) {
    return err(tarred.error);
  }
  return digestPair({ deps, dumpPath, tarPath });
}

/**
 * Reach the stack before anything is made: the database the URL names, `pg_dump`'s version and its extensions.
 *
 * @param storeUrl the store selection, whose database is what gets dumped
 * @param deps the stack effects
 * @returns the three the manifest records, or the first that failed
 */
function reachStack({
  storeUrl,
  deps,
}: {
  storeUrl: string;
  deps: BackupDeps;
}): Result<{ database: string; extensions: BackupManifest["extensions"]; version: string }, BackupError> {
  const database = databaseNameOf({ url: storeUrl });
  if (database.isErr()) {
    return err(database.error);
  }
  const version = deps.pgDumpVersion();
  if (version.isErr()) {
    return err(version.error);
  }
  const extensions = deps.listExtensions({ database: database.value });
  if (extensions.isErr()) {
    return err(extensions.error);
  }
  return ok({ database: database.value, extensions: extensions.value, version: version.value });
}

/**
 * Reach the stack, dump and tar into a fresh staging directory, and write the manifest that describes them.
 *
 * `pg_dump --version` runs before the directory is made, so a stopped stack leaves nothing behind at all.
 *
 * @param storeUrl the store selection, whose database is what gets dumped
 * @param directory the staging directory to create and fill
 * @param home the Slopweaver home, whose staging root holds the directory and whose secrets the credentials leg seals
 * @param key the backup key the Vault leg is sealed under, or `null` for a staging with no Vault leg
 * @param masterPassword the password `secrets.enc` is sealed under, or `null` to stage no credentials leg
 * @param nowIso the backup's own instant
 * @param deps the stack effects
 * @returns the manifest it wrote, or the first step that failed
 */
export async function prepareStaging({
  storeUrl,
  directory,
  home,
  key,
  masterPassword,
  nowIso,
  deps,
}: {
  storeUrl: string;
  directory: string;
  home: string;
  key: Buffer | null;
  masterPassword: string | null;
  nowIso: string;
  deps: BackupDeps;
}): Promise<Result<BackupManifest, BackupError>> {
  const reached = reachStack({ deps, storeUrl });
  if (reached.isErr()) {
    return err(reached.error);
  }
  const { database, extensions, version } = reached.value;
  // Made by this run, through no link: a planted `<instant>` link would carry tonight's plaintext elsewhere.
  const made = makeStagingDirectory({ directory, fresh: true, home });
  if (made.isErr()) {
    return err(made.error);
  }
  const digests = dumpAndTar({ database, deps, directory });
  if (digests.isErr()) {
    return err(digests.error);
  }
  const secrets = stageSecretsLeg({ deps, directory, home, masterPassword });
  if (secrets.isErr()) {
    return err(BackupErrors.stepFailed({ reasons: secrets.error }));
  }
  const vault = await stageVaultLeg({ database, deps, directory, key });
  if (vault.isErr()) {
    return err(vault.error);
  }
  const manifest: BackupManifest = {
    createdAtIso: nowIso,
    database,
    dump: digests.value.dump,
    extensions,
    pgDumpVersion: version,
    project: SUPABASE_PROJECT_ID,
    schemas: [...DUMPED_SCHEMAS],
    secrets: secrets.value,
    storage: digests.value.storage,
    vault: vault.value,
    version: BACKUP_MANIFEST_VERSION,
  };
  writeJsonFile({ path: join(directory, BACKUP_FILES.manifest), value: manifest });
  return ok(manifest);
}

/**
 * The Vault leg: sealed under the backup key into `vault.enc`, or `null` — said, not skipped — with no key.
 *
 * @param database the database being backed up, whose `vault.secrets` is carried
 * @param directory the staging directory
 * @param key the backup key, or `null`
 * @param deps the stack effects
 * @returns the manifest's vault record, or why the leg failed
 */
async function stageVaultLeg({
  database,
  directory,
  key,
  deps,
}: {
  database: string;
  directory: string;
  key: Buffer | null;
  deps: BackupDeps;
}): Promise<Result<VaultArtefact | null, BackupError>> {
  if (key === null) {
    return ok(null);
  }
  const sealed = await deps.sealVault({ container: supabaseContainer({ service: "db" }), database, directory, key });
  if (sealed.isErr()) {
    return err(BackupErrors.stepFailed({ reasons: [sealed.error.message] }));
  }
  return ok(sealed.value);
}
