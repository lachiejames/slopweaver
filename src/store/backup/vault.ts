/**
 * The Vault leg (owner ruling): the store's `vault.secrets` table, which the scoped dump leaves out
 * because it lives in the `vault` schema, carried as plaintext rows and re-created on restore.
 *
 * Why plaintext rows rather than the table's own ciphertext: Vault encrypts each row under a key the database
 * server holds outside the dump, so a copy of `vault.secrets` restored anywhere else is rows nothing can open.
 * The leg reads `vault.decrypted_secrets` instead, and the plaintext never rests: it is written 0600 into the
 * staging directory, sealed at once under the backup key into `vault.enc` (the object format, `./objectCrypto.ts`)
 * and removed, whatever happened. A restore opens it into a fixed-name 0700 scratch directory inside the backup
 * directory, cleared before the restore does anything else and removed after it, so a killed restore's rows are
 * removed by the next restore over that backup rather than stranded in a random temp directory.
 *
 * Each field travels base64 inside CSV, measured on a throwaway `supabase/postgres:17.6.1.143`:
 * a NULL name stays an empty unquoted field, an empty description becomes `""`, and no value can spell psql's
 * `\.` end-of-data line. The `postgres` role, which is not a superuser there, can create the extension in a fresh
 * database, call `vault.create_secret` and read `decrypted_secret` — which is every privilege the leg uses.
 * Repro: `docker run -d --rm --name sw-vault-probe -e POSTGRES_PASSWORD=x <image>`, then `docker exec -i
 * sw-vault-probe psql -U postgres -h localhost` with the statements below.
 */
import { closeSync, mkdirSync, openSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";

import { errorMessage } from "#lib/errorMessage.js";
import { err, ok, type Result } from "#lib/result.js";

import { decryptObjectFile, encryptObjectFile, keyFingerprint } from "./objectCrypto.js";
import { BACKUP_FILES, type VaultArtefact } from "./plan.js";
import { digestFile, PAYLOAD_STEP_TIMEOUT_MS, QUERY_STEP_TIMEOUT_MS, run, withInput } from "./stack.js";
import { type VaultError, VaultErrors } from "./vaultErrors.js";

/** The extension that owns `vault.secrets`. */
const VAULT_EXTENSION = "supabase_vault";

/** The plaintext rows' file while they exist at all — inside staging, 0600, removed before the leg returns. */
const PLAINTEXT_NAME = ".vault.csv.partial";

/**
 * Where a restore opens `vault.enc`: a FIXED name inside the backup directory, never a random temp directory, so
 * whatever a killed restore left there is found and removed by the next restore over the same backup.
 */
const RESTORE_SCRATCH_NAME = ".vault-restore.partial";

/** `1` when the extension is installed in the database, else `0`. */
const VAULT_INSTALLED_QUERY = `select count(*) from pg_extension where extname = '${VAULT_EXTENSION}'`;

/** Rows whose ciphertext is there but whose plaintext is not, then every row, as `<undecryptable>,<rows>`. */
const VAULT_ROWS_QUERY =
  "select count(*) filter (where decrypted_secret is null and secret is not null) || ',' || count(*) from vault.decrypted_secrets";

/** Every row in the table, opened or not — what a restore target must hold none of. */
const VAULT_STORED_QUERY = "select count(*) from vault.secrets";

/**
 * One base64 field: the text's UTF-8 bytes, with the line breaks `encode` inserts every 76 characters removed.
 *
 * @param column the column to encode
 * @returns the SQL expression
 */
function encodedColumn({ column }: { column: string }): string {
  return `translate(encode(convert_to(${column}, 'UTF8'), 'base64'), E'\\n', '')`;
}

/**
 * One decoded field, the inverse of {@link encodedColumn}.
 *
 * @param column the staged column holding the base64
 * @returns the SQL expression
 */
function decodedColumn({ column }: { column: string }): string {
  return `convert_from(decode(${column}, 'base64'), 'UTF8')`;
}

/** Every secret as one CSV line, oldest first so a restore re-creates them in the order they were made. */
export const VAULT_EXPORT_STATEMENT = [
  "copy (select",
  ["name", "description", "decrypted_secret"].map((column) => encodedColumn({ column })).join(", "),
  "from vault.decrypted_secrets order by created_at, id) to stdout with (format csv)",
].join(" ");

/**
 * The three `psql -c` commands an import runs in ONE session and one transaction: make sure the extension is
 * there, refuse a target that already holds secrets, stage the CSV from stdin, create each secret, and commit.
 * A failure anywhere stops psql (`ON_ERROR_STOP`) and the open transaction dies with the connection.
 *
 * @returns the commands, in order
 */
export function vaultImportCommands(): readonly string[] {
  const created = ["secret", "name", "description"].map((column) => decodedColumn({ column })).join(", ");
  return [
    [
      // Read committed whatever the target's default: under repeatable read the snapshot would predate the lock
      // below, and the emptiness check would miss a row committed while the lock was awaited.
      "begin isolation level read committed;",
      `create extension if not exists ${VAULT_EXTENSION} cascade;`,
      // Held to commit: an insert from another session between this emptiness check and the import would
      // otherwise merge its row with the backup's, the one outcome the guard exists to refuse.
      "lock table vault.secrets in share row exclusive mode;",
      "do $$ begin if exists (select 1 from vault.secrets) then",
      "raise exception 'vault.secrets already holds rows; nothing was imported'; end if; end $$;",
      "create temp table vault_import (name text, description text, secret text) on commit drop;",
    ].join(" "),
    "\\copy vault_import from pstdin with (format csv)",
    `select count(vault.create_secret(${created})) from vault_import; commit;`,
  ];
}

/**
 * How many rows an exported CSV holds: one per line, since a base64 field never carries a line break.
 *
 * @param bytes the CSV's bytes
 * @returns the row count
 */
export function countCsvRows({ bytes }: { bytes: Buffer }): number {
  let rows = 0;
  for (const byte of bytes) {
    if (byte === 0x0a) {
      rows += 1;
    }
  }
  return rows;
}

/**
 * Read a source Vault's row counts: how many rows there are, refusing when its own key cannot open any of them.
 *
 * @param out the rows query's output, `<undecryptable>,<rows>`
 * @returns the row count, or why the rows cannot be carried
 */
export function judgeVaultRows({ out }: { out: string }): Result<number, VaultError> {
  const match = /^(\d+),(\d+)$/.exec(out.trim());
  if (match === null) {
    return err(VaultErrors.stepFailed({ cause: `unreadable counts ${JSON.stringify(out)}`, step: "count secrets" }));
  }
  const undecryptable = Number(match[1]);
  if (undecryptable > 0) {
    return err(VaultErrors.undecryptable({ rows: undecryptable }));
  }
  return ok(Number(match[2]));
}

/**
 * Check the count an import printed, or a target holds, against the rows the backup recorded.
 *
 * @param out the bare count — `-qAt`, so only the value
 * @param expected the manifest's row count
 * @returns nothing when they agree, else the mismatch
 */
export function judgeVaultCount({ out, expected }: { out: string; expected: number }): Result<void, VaultError> {
  const found = out.trim();
  if (found !== String(expected)) {
    return err(VaultErrors.countMismatch({ expected, found }));
  }
  return ok(undefined);
}

/**
 * The fixed `docker exec … psql` argv, stopping at the first error and printing bare values only.
 *
 * @param container the Postgres container, always named — a rehearsal passes its throwaway
 * @param database which database
 * @param interactive whether the child reads stdin (`-i`)
 * @returns the argv up to the commands
 */
function psqlArgs({
  container,
  database,
  interactive,
}: {
  container: string;
  database: string;
  interactive: boolean;
}): string[] {
  const exec = interactive ? ["exec", "-i", container] : ["exec", container];
  return [...exec, "psql", "-U", "postgres", "-d", database, "-v", "ON_ERROR_STOP=1", "-qAt"];
}

/**
 * One query against a named container's database.
 *
 * @param container the Postgres container
 * @param database which database
 * @param query the statement
 * @param step how a failure names it
 * @returns the trimmed output
 */
function psqlQuery({
  container,
  database,
  query,
  step,
}: {
  container: string;
  database: string;
  query: string;
  step: string;
}): Result<string, VaultError> {
  return run({
    args: [...psqlArgs({ container, database, interactive: false }), "-c", query],
    command: "docker",
    label: `psql ${step}`,
    stdio: ["ignore", "pipe", "pipe"],
    timeoutMs: QUERY_STEP_TIMEOUT_MS,
  })
    .map((out) => out.trim())
    .mapErr((cause) => VaultErrors.stepFailed({ cause, step }));
}

/**
 * Whether the Vault extension is installed in one database.
 *
 * @param container the Postgres container
 * @param database which database
 * @returns whether it is, or why that could not be read
 */
function vaultInstalled({ container, database }: { container: string; database: string }): Result<boolean, VaultError> {
  return psqlQuery({ container, database, query: VAULT_INSTALLED_QUERY, step: "find the Vault extension" }).map(
    (out) => out !== "0",
  );
}

/**
 * How many secrets one database's Vault holds and can open — `0` when the extension is not installed.
 *
 * @param container the Postgres container, by name or id
 * @returns the row count, or why it could not be read or carried
 */
export function vaultRowCount({
  container,
  database,
}: {
  container: string;
  database: string;
}): Result<number, VaultError> {
  return vaultInstalled({ container, database }).andThen((installed) => {
    if (!installed) {
      return ok(0);
    }
    return psqlQuery({ container, database, query: VAULT_ROWS_QUERY, step: "count secrets" }).andThen((out) =>
      judgeVaultRows({ out }),
    );
  });
}

/**
 * Export every secret's plaintext row into a fresh 0600 file — the caller seals and removes it.
 *
 * @param container the Postgres container
 * @param database which database
 * @param path where the CSV lands; must not exist
 * @returns how many rows it holds, or why the export failed
 */
function exportVaultRows({
  container,
  database,
  path,
}: {
  container: string;
  database: string;
  path: string;
}): Result<number, VaultError> {
  const rows = vaultRowCount({ container, database });
  if (rows.isErr()) {
    return err(rows.error);
  }
  let out: number;
  try {
    out = openSync(path, "wx", 0o600);
  } catch (error: unknown) {
    return err(VaultErrors.stepFailed({ cause: errorMessage({ error }), step: "open the plaintext rows file" }));
  }
  try {
    if (rows.value > 0) {
      const exported = run({
        args: [...psqlArgs({ container, database, interactive: false }), "-c", VAULT_EXPORT_STATEMENT],
        command: "docker",
        label: "psql export the Vault",
        stdio: ["ignore", out, "pipe"],
        timeoutMs: PAYLOAD_STEP_TIMEOUT_MS,
      });
      if (exported.isErr()) {
        return err(VaultErrors.stepFailed({ cause: exported.error, step: "export the Vault" }));
      }
    }
  } finally {
    closeSync(out);
  }
  return ok(countCsvRows({ bytes: readFileSync(path) }));
}

/**
 * The backup half: export the Vault's rows, seal them under the backup key into `vault.enc` in the staging
 * directory, and remove the plaintext whatever happened.
 *
 * @param container the Postgres container
 * @param database the database being backed up
 * @param key the 32-byte backup key
 * @param directory the staging directory
 * @returns the artefact the manifest records, or why the leg failed
 */
export async function sealVault({
  container,
  database,
  key,
  directory,
}: {
  container: string;
  database: string;
  key: Buffer;
  directory: string;
}): Promise<Result<VaultArtefact, VaultError>> {
  const plaintext = join(directory, PLAINTEXT_NAME);
  const target = join(directory, BACKUP_FILES.vault);
  try {
    // A run killed mid-leg leaves its rows file behind; removing it inside the try puts a failure here under
    // the same finally as everything after it.
    rmSync(plaintext, { force: true });
    const rows = exportVaultRows({ container, database, path: plaintext });
    if (rows.isErr()) {
      return err(rows.error);
    }
    const sealed = await encryptObjectFile({ key, objectName: BACKUP_FILES.vault, source: plaintext, target });
    if (sealed.isErr()) {
      return err(VaultErrors.stepFailed({ cause: sealed.error, step: `seal ${BACKUP_FILES.vault}` }));
    }
    const digest = digestFile({ path: target });
    if (digest.isErr()) {
      return err(VaultErrors.stepFailed({ cause: digest.error, step: `digest ${BACKUP_FILES.vault}` }));
    }
    return ok({ ...digest.value, keyFingerprint: keyFingerprint({ key }), rows: rows.value });
  } finally {
    rmSync(plaintext, { force: true });
  }
}

/**
 * Refuse a target whose Vault already holds rows — the typed half of the guard the import's transaction repeats.
 *
 * @param container the Postgres container
 * @param database the restore target
 * @returns nothing when it holds none, else the refusal
 */
function requireEmptyVault({ container, database }: { container: string; database: string }): Result<void, VaultError> {
  return vaultInstalled({ container, database }).andThen((installed) => {
    if (!installed) {
      return ok(undefined);
    }
    return psqlQuery({ container, database, query: VAULT_STORED_QUERY, step: "count stored secrets" }).andThen(
      (out) => {
        if (out !== "0") {
          return err(VaultErrors.targetNotEmpty({ rows: Number(out) }));
        }
        return ok(undefined);
      },
    );
  });
}

/**
 * Import one opened CSV into the target in a single transaction, and check the count it printed.
 *
 * @param container the Postgres container
 * @param database the restore target
 * @param path the opened plaintext rows
 * @param expected the manifest's row count
 * @returns nothing when every row was created, else why not
 */
function importVaultRows({
  container,
  database,
  path,
  expected,
}: {
  container: string;
  database: string;
  path: string;
  expected: number;
}): Result<void, VaultError> {
  const commands = vaultImportCommands().flatMap((command) => ["-c", command]);
  const imported = withInput({
    path,
    use: (input) =>
      run({
        args: [...psqlArgs({ container, database, interactive: true }), ...commands],
        command: "docker",
        label: "psql import the Vault",
        stdio: [input, "pipe", "pipe"],
        timeoutMs: PAYLOAD_STEP_TIMEOUT_MS,
      }),
  });
  if (imported.isErr()) {
    return err(VaultErrors.stepFailed({ cause: imported.error, step: "import the Vault" }));
  }
  return judgeVaultCount({ expected, out: imported.value });
}

/**
 * The restore half: open `vault.enc` into the backup directory's fixed scratch, import its rows into an empty target Vault, check the
 * count, and remove the plaintext whatever happened. A backup that sealed no rows imports nothing.
 *
 * @param container the Postgres container
 * @param database the restore target
 * @param key the 32-byte backup key
 * @param directory the backup directory holding `vault.enc`, already verified against the manifest
 * @param artefact the manifest's record of it
 * @returns nothing when the target holds every secret, else why not
 */
export async function restoreVault({
  container,
  database,
  key,
  directory,
  artefact,
}: {
  container: string;
  database: string;
  key: Buffer;
  directory: string;
  artefact: VaultArtefact;
}): Promise<Result<void, VaultError>> {
  const scratch = join(directory, RESTORE_SCRATCH_NAME);
  try {
    // A restore killed mid-run leaves its rows, or a decrypt's partial, here; clearing it first — before any
    // early return — means the next restore over this backup removes them.
    rmSync(scratch, { force: true, recursive: true });
    if (artefact.rows === 0) {
      return ok(undefined);
    }
    const empty = requireEmptyVault({ container, database });
    if (empty.isErr()) {
      return err(empty.error);
    }
    mkdirSync(scratch, { mode: 0o700 });
    const plaintext = join(scratch, "vault.csv");
    const source = join(directory, BACKUP_FILES.vault);
    const opened = await decryptObjectFile({ key, objectName: BACKUP_FILES.vault, source, target: plaintext });
    if (opened.isErr()) {
      return err(VaultErrors.stepFailed({ cause: opened.error, step: `open ${BACKUP_FILES.vault}` }));
    }
    return importVaultRows({ container, database, expected: artefact.rows, path: plaintext });
  } finally {
    rmSync(scratch, { force: true, recursive: true });
  }
}
