/**
 * The effectful half of a restore rehearsal's verification: read the same facts off the live store and the
 * restored copy — the catalog, every table's count, and a sample of the newest rows — and hand them to the
 * pure verdicts in `./rehearsalCheck.ts`. The statement text itself is built, pure, in `./rehearsalSql.ts`.
 *
 * ## The live connection cannot write
 *
 * It opens with the startup parameter `default_transaction_read_only=on`, and before any other query it asks
 * the server `show default_transaction_read_only` and refuses to go on unless the answer is `on`. So an
 * INSERT, UPDATE, DELETE or DDL arriving on it is refused by Postgres itself ("cannot execute … in a read-only
 * transaction"), whatever this file one day grows. Every statement below is a SELECT regardless.
 *
 * ## Both sides render text the same way
 *
 * The byte-equal sample compares each row's own text form, `t::text`, and a `timestamptz` renders in the
 * SESSION's time zone. So both connections pin `TimeZone`, `DateStyle`, `IntervalStyle` and
 * `extra_float_digits` at startup; otherwise two identical rows could hash differently only because the two
 * servers' defaults differ.
 */
import { createHash } from "node:crypto";

import postgres, { type Sql } from "postgres";

import { err, ok, type Result } from "#lib/result.js";

import { DUMPED_SCHEMAS } from "./plan.js";
import { type CountReading, insertionColumn, type SampleReading } from "./rehearsalCheck.js";
import { type RehearsalError, RehearsalErrors } from "./rehearsalErrors.js";
import {
  countStatement,
  frontierStatements,
  sampleStatements,
  type TableShape,
  tableShapesOf,
} from "./rehearsalSql.js";

/** Session settings both sides share, so a row's text form means the same bytes on both. */
const RENDERING = {
  DateStyle: "ISO, MDY",
  IntervalStyle: "postgres",
  TimeZone: "UTC",
  extra_float_digits: 3,
} as const;

/**
 * Open the live store for reading only, and prove the server agrees before anything else runs.
 *
 * @param url the live store's connection string
 * @returns the connection, or why it could not be opened read-only
 */
async function openLiveReadOnly({ url }: { url: string }): Promise<Result<Sql, RehearsalError>> {
  const sql = postgres(url, {
    connection: { ...RENDERING, default_transaction_read_only: true },
    max: 1,
    onnotice: () => {},
  });
  try {
    const [row] = await sql<{ default_transaction_read_only: string }[]>`show default_transaction_read_only`;
    if (row?.default_transaction_read_only !== "on") {
      await sql.end({ timeout: 5 });
      return err(
        RehearsalErrors.stepFailed({
          reasons: [`the server reports default_transaction_read_only = ${String(row?.default_transaction_read_only)}`],
          step: "opening the live store read-only",
        }),
      );
    }
    return ok(sql);
  } catch (cause: unknown) {
    await sql.end({ timeout: 5 });
    return err(RehearsalErrors.stepFailed({ reasons: [String(cause)], step: "opening the live store read-only" }));
  }
}

/**
 * The catalog, as one normalised line per object, for the schemas the dump carries.
 *
 * Owners and grants are deliberately absent — the dump is `--no-owner --no-privileges`, so they are not what a
 * restore carries. Column ORDER is absent too: a live table that once dropped a column numbers the rest
 * differently from a freshly created one, and that is not a schema difference anyone can act on.
 *
 * @param sql either side's connection
 * @returns the sorted catalog lines
 */
async function catalogLines({ sql }: { sql: Sql }): Promise<readonly string[]> {
  const halves = await Promise.all([relationCatalogLines({ sql }), routineCatalogLines({ sql })]);
  return halves.flat().toSorted();
}

/**
 * The relation half of the catalog: tables, columns, constraints, indexes, views and sequences.
 *
 * @param sql either side's connection
 * @returns those objects' lines, unsorted
 */
async function relationCatalogLines({ sql }: { sql: Sql }): Promise<readonly string[]> {
  const schemas = sql([...DUMPED_SCHEMAS]);
  const queries = [
    sql<{ line: string }[]>`
      select format('relation %I.%I kind=%s rls=%s forced=%s', n.nspname, c.relname, c.relkind,
        c.relrowsecurity, c.relforcerowsecurity) as line
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname in ${schemas} and c.relkind in ('r','p','v','m','S','f')`,
    // The type prints as a quoted literal (%L), never bare: format_type carries a custom type's typmodout text
    // verbatim, and flattenAndChains reads SQL quoting, so only quoted could AND-shaped typmod text stay data.
    sql<{ line: string }[]>`
      select format('column %I.%I.%I %L notnull=%s default=%s identity=%s generated=%s', n.nspname, c.relname,
        a.attname, format_type(a.atttypid, a.atttypmod), a.attnotnull, pg_get_expr(d.adbin, d.adrelid),
        a.attidentity, a.attgenerated) as line
      from pg_attribute a join pg_class c on c.oid = a.attrelid join pg_namespace n on n.oid = c.relnamespace
      left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
      where n.nspname in ${schemas} and c.relkind in ('r','p','v','m','f') and a.attnum > 0 and not a.attisdropped`,
    sql<{ line: string }[]>`
      select format('constraint %I.%I.%I %s', n.nspname, c.relname, k.conname, pg_get_constraintdef(k.oid)) as line
      from pg_constraint k join pg_class c on c.oid = k.conrelid join pg_namespace n on n.oid = c.relnamespace
      where n.nspname in ${schemas}`,
    sql<{ line: string }[]>`
      select format('index %I.%I %s', schemaname, indexname, indexdef) as line
      from pg_indexes where schemaname in ${schemas}`,
    sql<{ line: string }[]>`
      select format('view %I.%I %s', n.nspname, c.relname, md5(pg_get_viewdef(c.oid))) as line
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname in ${schemas} and c.relkind in ('v','m')`,
    sql<{ line: string }[]>`
      select format('sequence %I.%I %s start=%s increment=%s min=%s max=%s cycle=%s', schemaname, sequencename,
        data_type, start_value, increment_by, min_value, max_value, cycle) as line
      from pg_sequences where schemaname in ${schemas}`,
  ];
  const results = await Promise.all(queries);
  return results.flatMap((rows) => rows.map((row) => row.line));
}

/**
 * The routine half of the catalog: functions, triggers, policies, enum and domain types, and extensions.
 *
 * @param sql either side's connection
 * @returns those objects' lines, unsorted
 */
async function routineCatalogLines({ sql }: { sql: Sql }): Promise<readonly string[]> {
  const schemas = sql([...DUMPED_SCHEMAS]);
  const queries = [
    sql<{ line: string }[]>`
      select format('function %I.%I(%s) returns %s kind=%s body=%s', n.nspname, p.proname,
        pg_get_function_identity_arguments(p.oid), pg_get_function_result(p.oid), p.prokind,
        md5(pg_get_functiondef(p.oid))) as line
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname in ${schemas} and p.prokind in ('f','p')`,
    sql<{ line: string }[]>`
      select format('trigger %I.%I.%I %s', n.nspname, c.relname, t.tgname, pg_get_triggerdef(t.oid)) as line
      from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
      where n.nspname in ${schemas} and not t.tgisinternal`,
    sql<{ line: string }[]>`
      select format('policy %I.%I.%I %s %s roles=%s using=%s check=%s', schemaname, tablename, policyname,
        permissive, cmd,
        -- quote_ident, never roles::text: array text escapes a quote with a backslash, and flattenAndChains
        -- reads SQL quoting, so a role name holding one could expose its parentheses to the AND splice.
        (select string_agg(quote_ident(r), ',' order by o) from unnest(roles) with ordinality as u(r, o)),
        qual, with_check) as line
      from pg_policies where schemaname in ${schemas}`,
    sql<{ line: string }[]>`
      select format('type %I.%I enum=%s', n.nspname, t.typname,
        (select string_agg(e.enumlabel, ',' order by e.enumsortorder) from pg_enum e where e.enumtypid = t.oid)) as line
      from pg_type t join pg_namespace n on n.oid = t.typnamespace
      where n.nspname in ${schemas} and t.typtype = 'e'`,
    sql<{ line: string }[]>`
      select format('domain %I.%I %s notnull=%s', n.nspname, t.typname, format_type(t.typbasetype, t.typtypmod),
        t.typnotnull) as line
      from pg_type t join pg_namespace n on n.oid = t.typnamespace
      where n.nspname in ${schemas} and t.typtype = 'd'`,
    sql<{ line: string }[]>`
      select format('extension %I in %I version %s', e.extname, n.nspname, e.extversion) as line
      from pg_extension e join pg_namespace n on n.oid = e.extnamespace where n.nspname in ${schemas}`,
  ];
  const results = await Promise.all(queries);
  return results.flatMap((rows) => rows.map((row) => row.line));
}

/**
 * Every base table in the dumped schemas, with its columns and primary key.
 *
 * @param sql either side's connection
 * @returns the tables, sorted by qualified name
 */
async function tableShapes({ sql }: { sql: Sql }): Promise<readonly TableShape[]> {
  const rows = await sql<{ schema: string; table: string; column: string; type: string; pk: number | null }[]>`
    select n.nspname as schema, c.relname as table, a.attname as column,
      format_type(a.atttypid, a.atttypmod) as type,
      array_position(i.indkey::int2[], a.attnum) as pk
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
    left join pg_index i on i.indrelid = c.oid and i.indisprimary
    where n.nspname in ${sql([...DUMPED_SCHEMAS])} and c.relkind in ('r','p')
    order by n.nspname, c.relname, a.attnum`;
  return tableShapesOf({ rows });
}

/**
 * Every table's count on both sides, and — where the table has an insertion-time column — live's count up to
 * the copy's own newest value of it.
 *
 * @param live the read-only live connection
 * @param copy the copy's connection
 * @returns one reading per table either side has
 */
async function countReadings({ live, copy }: { live: Sql; copy: Sql }): Promise<readonly CountReading[]> {
  const liveTables = await tableShapes({ sql: live });
  const copyTables = await tableShapes({ sql: copy });
  const names = [
    ...new Set([...liveTables, ...copyTables].map((shape) => `${shape.schema}.${shape.table}`)),
  ].toSorted();
  const readings: CountReading[] = [];
  for (const name of names) {
    const liveShape = liveTables.find((shape) => `${shape.schema}.${shape.table}` === name);
    const copyShape = copyTables.find((shape) => `${shape.schema}.${shape.table}` === name);
    if (copyShape === undefined) {
      // The name came from one side or the other, so a table the copy lacks is one live has.
      const counted = await countRows({ shape: liveShape!, sql: live });
      readings.push({ copy: null, frontier: null, live: counted, table: name });
    } else if (liveShape === undefined) {
      const counted = await countRows({ shape: copyShape, sql: copy });
      readings.push({ copy: counted, frontier: null, live: null, table: name });
    } else {
      readings.push(await pairedReading({ copy, copyShape, live, liveShape, name }));
    }
  }
  return readings;
}

/**
 * One table both sides have: its two counts and, when they differ and the table has an insertion-time column,
 * live's count up to the copy's newest value of it.
 *
 * @param live the read-only live connection
 * @param copy the copy's connection
 * @param liveShape the table as live has it
 * @param copyShape the table as the copy has it, whose columns choose the insertion column
 * @param name the qualified table name the reading carries
 * @returns the reading
 */
async function pairedReading({
  live,
  copy,
  liveShape,
  copyShape,
  name,
}: {
  live: Sql;
  copy: Sql;
  liveShape: TableShape;
  copyShape: TableShape;
  name: string;
}): Promise<CountReading> {
  const liveCount = await countRows({ shape: liveShape, sql: live });
  const copyCount = await countRows({ shape: copyShape, sql: copy });
  const column = insertionColumn({ columns: copyShape.columns.map((entry) => entry.name) });
  const frontier =
    column === null || liveCount === copyCount ? null : await frontierReading({ column, copy, live, shape: copyShape });
  return { copy: copyCount, frontier, live: liveCount, table: name };
}

/**
 * Count one table's rows.
 *
 * @param sql the side to count on
 * @param shape the table
 * @returns its exact row count
 */
async function countRows({ sql, shape }: { sql: Sql; shape: TableShape }): Promise<number> {
  const [row] = await sql.unsafe<{ rows: string }[]>(countStatement({ shape }));
  return Number(row!.rows);
}

/**
 * The copy's newest value of a table's insertion column, and how many live rows sit at or before it.
 *
 * @param live the read-only live connection
 * @param copy the copy's connection
 * @param shape the table
 * @param column its insertion-time column
 * @returns the frontier, or `null` when the copy's column is empty throughout
 */
async function frontierReading({
  live,
  copy,
  shape,
  column,
}: {
  live: Sql;
  copy: Sql;
  shape: TableShape;
  column: string;
}): Promise<CountReading["frontier"]> {
  const statements = frontierStatements({ column, shape });
  const [max] = await copy.unsafe<{ max: string | null }[]>(statements.copyMax);
  const copyMax = max?.max;
  if (copyMax == null) {
    return null;
  }
  const [upTo] = await live.unsafe<{ rows: string }[]>(statements.liveUpTo, [copyMax]);
  return { column, copyMax, liveUpTo: Number(upTo!.rows) };
}

/**
 * SHA-256 of one row's text form, over its UTF-8 bytes.
 *
 * @param text the row as `t::text` rendered it
 * @returns the hex digest
 */
function rowDigest({ text }: { text: string }): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/** What sampling found: every sampled row, and the tables that could not be sampled and why. */
export interface SampleResult {
  readonly rows: readonly SampleReading[];
  readonly unsampled: readonly { readonly table: string; readonly why: string }[];
}

/**
 * The newest `size` rows of every copy table with a primary key, each compared with the live row of the same
 * key.
 *
 * @param live the read-only live connection
 * @param copy the copy's connection
 * @param size how many rows per table
 * @param dumpStartedIso when the dump began — a live row with a timestamp later than this was touched since
 * @returns every sampled row, and every table left unsampled with its reason
 */
async function sampleReadings({
  live,
  copy,
  size,
  dumpStartedIso,
}: {
  live: Sql;
  copy: Sql;
  size: number;
  dumpStartedIso: string;
}): Promise<SampleResult> {
  const shapes = await tableShapes({ sql: copy });
  const rows: SampleReading[] = [];
  const unsampled: { table: string; why: string }[] = [];
  for (const shape of shapes) {
    const table = `${shape.schema}.${shape.table}`;
    if (shape.primaryKey.length === 0) {
      unsampled.push({ table, why: "no primary key to find the same row on live by" });
      continue;
    }
    const sampled = await sampleTable({ copy, dumpStartedIso, live, shape, size });
    if (sampled.length === 0) {
      unsampled.push({ table, why: "the copy holds no rows" });
      continue;
    }
    rows.push(...sampled);
  }
  return { rows, unsampled };
}

/**
 * Sample one table.
 *
 * @param live the read-only live connection
 * @param copy the copy's connection
 * @param shape the table, with its primary key
 * @param size how many rows
 * @param dumpStartedIso the dump's start instant
 * @returns one reading per sampled row
 */
async function sampleTable({
  live,
  copy,
  shape,
  size,
  dumpStartedIso,
}: {
  live: Sql;
  copy: Sql;
  shape: TableShape;
  size: number;
  dumpStartedIso: string;
}): Promise<readonly SampleReading[]> {
  const statements = sampleStatements({ shape, size });
  const picked = await copy.unsafe<{ key: string[]; body: string }[]>(statements.pick);
  const readings: SampleReading[] = [];
  for (const row of picked) {
    const [found] = await live.unsafe<{ body: string; touched: boolean }[]>(
      statements.lookup,
      statements.takesDumpInstant ? [...row.key, dumpStartedIso] : row.key,
    );
    readings.push({
      copySha256: rowDigest({ text: row.body }),
      key: row.key.join(","),
      liveSha256: found === undefined ? null : rowDigest({ text: found.body }),
      liveTouchedAfterDump: found === undefined ? false : found.touched,
      table: `${shape.schema}.${shape.table}`,
      tableRecordsChanges: statements.tableRecordsChanges,
    });
  }
  return readings;
}

/** The facts a verification reads, from both sides. */
export interface VerificationFacts {
  readonly liveCatalog: readonly string[];
  readonly copyCatalog: readonly string[];
  readonly counts: readonly CountReading[];
  readonly sample: SampleResult;
}

/**
 * Read every fact the verdicts need off live (read-only) and the copy, and close both connections.
 *
 * @param liveUrl the live store's connection string, opened read-only
 * @param copyUrl the throwaway's connection string
 * @param sampleSize rows per table in the byte-equal sample
 * @param dumpStartedIso when the dump began
 * @returns the facts, or why they could not be read
 */
export async function verifyAgainstLive({
  liveUrl,
  copyUrl,
  sampleSize,
  dumpStartedIso,
}: {
  liveUrl: string;
  copyUrl: string;
  sampleSize: number;
  dumpStartedIso: string;
}): Promise<Result<VerificationFacts, RehearsalError>> {
  const live = await openLiveReadOnly({ url: liveUrl });
  if (live.isErr()) {
    return err(live.error);
  }
  const copy = postgres(copyUrl, { connection: { ...RENDERING }, max: 1, onnotice: () => {} });
  try {
    const liveCatalog = await catalogLines({ sql: live.value });
    const copyCatalog = await catalogLines({ sql: copy });
    const counts = await countReadings({ copy, live: live.value });
    const sample = await sampleReadings({ copy, dumpStartedIso, live: live.value, size: sampleSize });
    return ok({ copyCatalog, counts, liveCatalog, sample });
  } catch (cause: unknown) {
    const why = cause instanceof Error ? cause.message : String(cause);
    return err(RehearsalErrors.stepFailed({ reasons: [why], step: "reading live and the copy" }));
  } finally {
    await live.value.end({ timeout: 5 });
    await copy.end({ timeout: 5 });
  }
}
