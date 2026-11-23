/**
 * The database half of the stack edge — every `psql`, `createdb`, `dropdb` and `pg_restore` a restore makes
 * inside a Postgres container. Each step has a live-stack form and an `…In` form naming its container, so a
 * restore rehearsal can address its own throwaway by ID and never fall back to the live one.
 *
 * Every spawn goes through `stack.ts`'s `run`, so the payload rule stated there holds here unchanged.
 */
import { err, type Result } from "#lib/result.js";

import type { BackupError } from "./errors.js";
import { type BackupExtension, DUMPED_SCHEMAS, supabaseContainer } from "./plan.js";
import { filterRestoreToc, type RestoreMode } from "./restorePlan.js";
import { PAYLOAD_STEP_TIMEOUT_MS, QUERY_STEP_TIMEOUT_MS, run, type Step, withInput } from "./stack.js";

/**
 * Whether a database of this name exists in the stack.
 *
 * @param database the name to look for
 * @returns true when `pg_database` lists it
 */
export function databaseExists({ database }: { database: string }): Result<boolean, BackupError> {
  return databaseExistsIn({ container: supabaseContainer({ service: "db" }), database });
}

/**
 * Whether a database of this name exists in one named Postgres container — the live stack's, or a restore
 * rehearsal's throwaway.
 *
 * @param container the container whose server is asked
 * @param database the name to look for
 * @returns true when `pg_database` lists it
 */
export function databaseExistsIn({
  container,
  database,
}: {
  container: string;
  database: string;
}): Result<boolean, BackupError> {
  return run({
    args: [
      "exec",
      container,
      "psql",
      "-U",
      "postgres",
      "-Atc",
      "select 1 from pg_database where datname = $$" + database + "$$",
    ],
    command: "docker",
    label: "psql pg_database",
    stdio: ["ignore", "pipe", "pipe"],
    timeoutMs: QUERY_STEP_TIMEOUT_MS,
  }).map((out) => out.trim() === "1");
}

/**
 * Create an empty database to restore into.
 *
 * @param database its name, already validated by `validateDatabaseName`
 * @returns nothing on success, else `createdb`'s stderr
 */
export function createDatabase({ database }: { database: string }): Result<void, BackupError> {
  return createDatabaseIn({ container: supabaseContainer({ service: "db" }), database });
}

/**
 * Create an empty database in one named Postgres container.
 *
 * @param container the container whose server gets the database
 * @param database its name, already validated by `validateDatabaseName`
 * @returns nothing on success, else `createdb`'s stderr
 */
export function createDatabaseIn({
  container,
  database,
}: {
  container: string;
  database: string;
}): Result<void, BackupError> {
  return run({
    args: ["exec", container, "createdb", "-U", "postgres", database],
    command: "docker",
    label: `createdb ${database}`,
    stdio: ["ignore", "pipe", "pipe"],
    timeoutMs: QUERY_STEP_TIMEOUT_MS,
  }).map(() => undefined);
}

/**
 * Drop a database a restore proof created.
 *
 * @param database its name
 * @returns nothing on success, else `dropdb`'s stderr
 */
export function dropDatabase({ database }: { database: string }): Result<void, BackupError> {
  return run({
    args: ["exec", supabaseContainer({ service: "db" }), "dropdb", "-U", "postgres", "--if-exists", database],
    command: "docker",
    label: `dropdb ${database}`,
    stdio: ["ignore", "pipe", "pipe"],
    timeoutMs: QUERY_STEP_TIMEOUT_MS,
  }).map(() => undefined);
}

/**
 * Run one `psql -Atc` query against a database in one container and return its trimmed stdout.
 *
 * @param container the Postgres container, always named — a default here would be the live stack's, and a
 *   rehearsal that forgot to pass its throwaway would reach it silently
 * @param database which database
 * @param query the SQL, one statement
 * @param label how a refusal names the step
 * @returns the trimmed output
 */
function psqlValue({
  container,
  database,
  query,
  label,
}: {
  container: string;
  database: string;
  query: string;
  label: string;
}): Step<string> {
  return run({
    args: ["exec", container, "psql", "-U", "postgres", "-d", database, "-Atc", query],
    command: "docker",
    label,
    stdio: ["ignore", "pipe", "pipe"],
    timeoutMs: QUERY_STEP_TIMEOUT_MS,
  }).map((out) => out.trim());
}

/**
 * The extensions installed into one of the dumped schemas — what a scoped dump leaves out.
 *
 * @param database the database being dumped
 * @returns each extension with the schema it lives in
 */
export function listExtensions({ database }: { database: string }): Result<readonly BackupExtension[], BackupError> {
  const schemas = DUMPED_SCHEMAS.map((schema) => `$$${schema}$$`).join(", ");
  return psqlValue({
    container: supabaseContainer({ service: "db" }),
    database,
    label: "psql pg_extension",
    query:
      "select e.extname || '\t' || n.nspname from pg_extension e join pg_namespace n on n.oid = e.extnamespace " +
      `where n.nspname in (${schemas}) order by e.extname`,
  }).map((out) => parseExtensions({ out }));
}

/**
 * Read `psql -At`'s `name<TAB>schema` lines into extensions.
 *
 * @internal
 * @param out the trimmed output, one extension per line
 * @returns each extension with the schema it lives in
 */
export function parseExtensions({ out }: { out: string }): readonly BackupExtension[] {
  return out
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => {
      const [name = "", schema = ""] = line.split("\t");
      return { name, schema };
    });
}

/**
 * The statement creating one extension in the schema the backup had it in, both names quoted.
 *
 * @internal
 * @param extension the extension and its schema
 * @returns one `create extension if not exists` statement
 */
export function createExtensionStatement({ extension }: { extension: BackupExtension }): string {
  const name = extension.name.replace(/"/g, '""');
  const schema = extension.schema.replace(/"/g, '""');
  return `create extension if not exists "${name}" with schema "${schema}"`;
}

/**
 * Read `targetShapeIn`'s one `tables<TAB>storage` line.
 *
 * @internal
 * @param out the trimmed output
 * @returns how many tables `public` holds, and whether a `storage` schema exists
 */
export function parseTargetShape({ out }: { out: string }): { publicTables: number; hasStorageSchema: boolean } {
  const [tables = "0", storage = "0"] = out.split("\t");
  return { hasStorageSchema: storage === "1", publicTables: Number(tables) };
}

/**
 * Create one extension in the target, in the schema the backup had it in, before the tables that need it.
 *
 * @param database the target
 * @returns nothing on success, else `psql`'s stderr
 */
export function createExtension({
  database,
  extension,
}: {
  database: string;
  extension: BackupExtension;
}): Result<void, BackupError> {
  return createExtensionIn({ container: supabaseContainer({ service: "db" }), database, extension });
}

/**
 * Create one extension in a target inside one named Postgres container.
 *
 * @param container the container whose server holds the target
 * @param database the target
 * @param extension the extension and the schema the backup had it in
 * @returns nothing on success, else `psql`'s stderr
 */
export function createExtensionIn({
  container,
  database,
  extension,
}: {
  container: string;
  database: string;
  extension: BackupExtension;
}): Result<void, BackupError> {
  return psqlValue({
    container,
    database,
    label: `create extension ${extension.name}`,
    query: createExtensionStatement({ extension }),
  }).map(() => undefined);
}

/**
 * Run one statement against a database inside one named Postgres container.
 *
 * @param container the container whose server holds the database
 * @param database which database the session opens
 * @param statement the SQL, one statement
 * @param label how a refusal names the step
 * @returns nothing on success, else `psql`'s stderr
 */
export function runStatementIn({
  container,
  database,
  statement,
  label,
}: {
  container: string;
  database: string;
  statement: string;
  label: string;
}): Result<void, BackupError> {
  return psqlValue({ container, database, label, query: statement }).map(() => undefined);
}

/**
 * What already stands in a restore target: how many tables `public` holds, and whether `storage` exists.
 *
 * @param database the target
 * @returns the two facts `restoreModeFor` decides on
 */
export function targetShape({
  database,
}: {
  database: string;
}): Result<{ publicTables: number; hasStorageSchema: boolean }, BackupError> {
  return targetShapeIn({ container: supabaseContainer({ service: "db" }), database });
}

/**
 * What already stands in a restore target inside one named Postgres container.
 *
 * @param container the container whose server holds the target
 * @param database the target
 * @returns the two facts `restoreModeFor` decides on
 */
export function targetShapeIn({
  container,
  database,
}: {
  container: string;
  database: string;
}): Result<{ publicTables: number; hasStorageSchema: boolean }, BackupError> {
  return psqlValue({
    container,
    database,
    label: "psql information_schema",
    query:
      "select (select count(*) from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE')::text " +
      "|| '\t' || (select count(*) from pg_namespace where nspname = 'storage')::text",
  }).map((out) => parseTargetShape({ out }));
}

/**
 * Restore a custom-format dump into a database, replaying the table of contents minus what the target
 * already has.
 *
 * Two passes over the same host file, both on stdin: `pg_restore -l` for the listing, then `pg_restore -L`
 * with the filtered list copied into the container (the one place a list file can be read from beside a
 * dump on stdin). `--no-owner --no-privileges` mirror the dump; `--exit-on-error` so a restore that cannot
 * rebuild one object stops there rather than reporting a partial database as a success. The `stack` mode
 * adds `--clean --if-exists`, dropping the Storage API's own tables before re-creating them from the dump.
 *
 * @param database the target
 * @param path the dump on the host
 * @param mode what the target already holds, from `restoreModeFor`
 * @returns nothing on success, else the failing step's stderr
 */
export function restoreDatabase({
  database,
  path,
  mode,
}: {
  database: string;
  path: string;
  mode: RestoreMode;
}): Result<void, BackupError> {
  return restoreDatabaseIn({ container: supabaseContainer({ service: "db" }), database, mode, path });
}

/**
 * The `docker exec … pg_restore` argv that replays a filtered list into one database: ownership and grants
 * dropped, stopping at the first error, and cleaning first only when the target is an already-migrated stack.
 *
 * @param container the container whose server holds the target
 * @param listPath the filtered restore list, already written inside the container
 * @param mode what the target already holds, from `restoreModeFor`
 * @returns the argv after `docker`
 * @internal
 */
export function restoreArgs({
  container,
  database,
  listPath,
  mode,
}: {
  container: string;
  database: string;
  listPath: string;
  mode: RestoreMode;
}): readonly string[] {
  return [
    "exec",
    "-i",
    container,
    "pg_restore",
    "-U",
    "postgres",
    "--no-owner",
    "--no-privileges",
    "--exit-on-error",
    ...(mode === "stack" ? ["--clean", "--if-exists"] : []),
    "-L",
    listPath,
    "-d",
    database,
  ];
}

/**
 * Restore a custom-format dump into a database inside one named Postgres container — `restoreDatabase`'s
 * whole procedure with the container named rather than assumed.
 *
 * @param container the container whose server holds the target
 * @param database the target
 * @param path the dump on the host
 * @param mode what the target already holds, from `restoreModeFor`
 * @returns nothing on success, else the failing step's stderr
 */
export function restoreDatabaseIn({
  container,
  database,
  path,
  mode,
}: {
  container: string;
  database: string;
  path: string;
  mode: RestoreMode;
}): Result<void, BackupError> {
  const listing = withInput({
    path,
    use: (input) =>
      run({
        args: ["exec", "-i", container, "pg_restore", "-l"],
        command: "docker",
        label: "pg_restore -l",
        stdio: [input, "pipe", "pipe"],
        // `-l` streams the whole dump in on stdin to read its table of contents.
        timeoutMs: PAYLOAD_STEP_TIMEOUT_MS,
      }),
  });
  if (listing.isErr()) {
    return err(listing.error);
  }
  const listPath = `/tmp/slopweaver-restore-${database}.list`;
  const written = run({
    args: ["exec", "-i", container, "sh", "-c", `cat > ${listPath}`],
    command: "docker",
    label: "writing the restore list into the container",
    input: `${filterRestoreToc({ toc: listing.value }).join("\n")}\n`,
    stdio: ["pipe", "pipe", "pipe"],
    timeoutMs: QUERY_STEP_TIMEOUT_MS,
  });
  if (written.isErr()) {
    return err(written.error);
  }
  return withInput({
    path,
    use: (input) =>
      run({
        args: restoreArgs({ container, database, listPath, mode }),
        command: "docker",
        label: `pg_restore into ${database}`,
        stdio: [input, "pipe", "pipe"],
        timeoutMs: PAYLOAD_STEP_TIMEOUT_MS,
      }),
  }).map(() => undefined);
}
