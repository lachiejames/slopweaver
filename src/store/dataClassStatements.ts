/**
 * Every statement `store classify` sends to the store: the page reads, the write-back and the counts. The pass that
 * strings them together is `./resolveDataClasses.ts`'s; the decisions between them are `./dataClassResolution.ts`'s.
 *
 * The reads select exactly the facts intake sorts on (the container's NATIVE id through the join,
 * `author_native_id`, and the source, kind and visibility enum values unchanged) and the stored class. No body,
 * title or metadata is ever selected. Every hand-written statement names the `public` schema (`STORE_SCHEMA`).
 */
import { asc, eq, gt, type SQL, sql } from "drizzle-orm";

import { err, ok, type Result } from "#lib/result.js";

import type { StoreClient } from "./client.js";
import {
  contentDataClassFactsFromFields,
  ownerCaptureDataClassFacts,
  ownerTurnDataClassFacts,
} from "./dataClassIntake.js";
import {
  type DataClassCandidate,
  type DataClassCounts,
  type DataClassDecision,
  decodeRowCount,
  decodeStoredClassCounts,
} from "./dataClassResolution.js";
import type { DataClassRuleTable } from "./dataClassRules.js";
import { containerTable } from "./schema/container.js";
import { contentTable } from "./schema/content.js";
import { ownerCaptureTable } from "./schema/ownerCapture.js";
import { ownerTurnTable } from "./schema/ownerTurn.js";

/** How many rows one read takes and one write-back may carry; `./resolveBots.ts` measured the same sizing. */
export const CLASSIFY_BATCH_ROWS = 1000;

/** A census table with no class column, and how many rows it holds, all of which fail closed. */
export interface UnclassifiedTableCount {
  readonly table: string;
  /** Its rows, or null when the store holds no such table. */
  readonly rows: number | null;
}

/** One page read's arguments. */
interface PageArgs {
  readonly client: StoreClient;
  /** The previous page's last key, or null to start. */
  readonly after: string | null;
  readonly batch: number;
}

/**
 * Read one page of `content`: the facts intake sorts on, and the class stored. Nothing else is selected.
 *
 * @returns the page
 */
async function readContentPage({ client, after, batch }: PageArgs): Promise<readonly DataClassCandidate[]> {
  const rows = await client.db
    .select({
      author: contentTable.authorNativeId,
      container: containerTable.nativeId,
      dataClass: contentTable.dataClass,
      id: contentTable.id,
      kind: contentTable.kind,
      source: contentTable.source,
      visibility: contentTable.visibility,
    })
    .from(contentTable)
    .leftJoin(containerTable, eq(contentTable.containerId, containerTable.id))
    .where(after === null ? undefined : gt(contentTable.id, after))
    .orderBy(asc(contentTable.id))
    .limit(batch);
  const candidates = rows.map((row): DataClassCandidate => ({
    facts: contentDataClassFactsFromFields({
      author: row.author,
      container: row.container,
      kind: row.kind,
      source: row.source,
      visibility: row.visibility,
    }),
    ref: { id: row.id, table: "content" },
    stored: row.dataClass,
  }));
  return candidates;
}

/**
 * Read one page of `owner_capture`: the capturing app and the class stored. Never the body.
 *
 * @returns the page
 */
async function readOwnerCapturePage({ client, after, batch }: PageArgs): Promise<readonly DataClassCandidate[]> {
  const rows = await client.db
    .select({ dataClass: ownerCaptureTable.dataClass, id: ownerCaptureTable.id, source: ownerCaptureTable.source })
    .from(ownerCaptureTable)
    .where(after === null ? undefined : gt(ownerCaptureTable.id, after))
    .orderBy(asc(ownerCaptureTable.id))
    .limit(batch);
  const candidates = rows.map((row): DataClassCandidate => ({
    facts: ownerCaptureDataClassFacts({ source: row.source }),
    ref: { id: row.id, table: "owner_capture" },
    stored: row.dataClass,
  }));
  return candidates;
}

/**
 * Read one page of `owner_turn`: its key and the class stored. Never the body.
 *
 * @returns the page
 */
async function readOwnerTurnPage({ client, after, batch }: PageArgs): Promise<readonly DataClassCandidate[]> {
  const rows = await client.db
    .select({ dataClass: ownerTurnTable.dataClass, id: ownerTurnTable.bodySha256 })
    .from(ownerTurnTable)
    .where(after === null ? undefined : gt(ownerTurnTable.bodySha256, after))
    .orderBy(asc(ownerTurnTable.bodySha256))
    .limit(batch);
  const candidates = rows.map((row): DataClassCandidate => ({
    facts: ownerTurnDataClassFacts(),
    ref: { id: row.id, table: "owner_turn" },
    stored: row.dataClass,
  }));
  return candidates;
}

/** Each classified table's page reader. */
export const PAGE_READERS: Readonly<
  Record<DataClassRuleTable, (args: PageArgs) => Promise<readonly DataClassCandidate[]>>
> = {
  content: readContentPage,
  owner_capture: readOwnerCapturePage,
  owner_turn: readOwnerTurnPage,
};

/** Each classified table's key column and how its key is cast in a write-back. */
const WRITE_KEYS: Readonly<Record<DataClassRuleTable, { readonly column: string; readonly cast: SQL }>> = {
  content: { cast: sql`pg_catalog.uuid`, column: "id" },
  owner_capture: { cast: sql`pg_catalog.uuid`, column: "id" },
  owner_turn: { cast: sql`pg_catalog.text`, column: "body_sha256" },
};

/**
 * The schema every declared table lives in, named on every hand-written statement here.
 *
 * Qualified rather than left to `search_path`, so a lookalike table earlier on the path cannot stand in for the
 * real one at the read-back that decides whether the pass left a row with no class: a shadowed walk then leaves
 * the real rows NULL, the qualified read-back counts them, and the verb exits 1.
 */
const STORE_SCHEMA = "public";

/**
 * One declared table, schema-qualified.
 *
 * @param table a table name the repository declares
 * @returns the qualified identifier
 */
function storeTable({ table }: { table: string }): SQL {
  return sql`${sql.identifier(STORE_SCHEMA)}.${sql.identifier(table)}`;
}

/**
 * Write one page's derived classes back in a single statement, touching only rows whose stored class still differs.
 *
 * @param client the open store
 * @param table the classified table
 * @param decisions the page's decisions that should be written
 * @returns how many rows the statement changed
 */
export async function writeClasses({
  client,
  table,
  decisions,
}: {
  client: StoreClient;
  table: DataClassRuleTable;
  decisions: readonly DataClassDecision[];
}): Promise<number> {
  const key = WRITE_KEYS[table];
  const tuples = decisions.map(
    (decision) =>
      sql`(${decision.ref.id}::${key.cast}, ${decision.derived}::${sql.identifier(STORE_SCHEMA)}.data_class)`,
  );
  const column = sql.identifier(key.column);
  const rows = await client.db.execute(sql`
    update ${storeTable({ table })} as t set data_class = v.class
    from (values ${sql.join(tuples, sql`, `)}) as v(key, class)
    where t.${column} = v.key and t.data_class is distinct from v.class
    returning t.${column}
  `);
  return [...rows].length;
}

/**
 * Count one table's rows strictly.
 *
 * @param client the open store
 * @param table a table name the repository declares
 * @returns the count, or why it is not one
 */
export async function countRows({ client, table }: { client: StoreClient; table: string }): Promise<Result<number>> {
  const rows = await client.db.execute(sql`select count(*)::text as rows from ${storeTable({ table })}`);
  const first = [...rows][0];
  return decodeRowCount({ value: first === undefined ? undefined : first["rows"], what: table });
}

/**
 * Read a classified table's stored classes back, strictly.
 *
 * @param client the open store
 * @param table the classified table
 * @returns the stored counts and the rows still holding none
 */
export async function storedCounts({
  client,
  table,
}: {
  client: StoreClient;
  table: DataClassRuleTable;
}): Promise<Result<{ classes: DataClassCounts; nulls: number }>> {
  const rows = await client.db.execute(sql`
    select data_class::text as "dataClass", count(*)::text as rows
    from ${storeTable({ table })} group by 1
  `);
  return decodeStoredClassCounts({
    rows: [...rows].map((row) => ({ dataClass: row["dataClass"], rows: row["rows"] })),
  });
}

/**
 * Count every census table with no class column, naming the ones the store does not hold.
 *
 * @param client the open store
 * @param tables the census's unclassified table names
 * @returns one count per table, null for a table the store lacks
 */
export async function countUnclassifiedTables({
  client,
  tables,
}: {
  client: StoreClient;
  tables: readonly string[];
}): Promise<Result<readonly UnclassifiedTableCount[]>> {
  const present = new Set(
    [...(await client.db.execute(sql`select tablename from pg_tables where schemaname = ${STORE_SCHEMA}`))].map((row) =>
      String(row["tablename"]),
    ),
  );
  const counts: UnclassifiedTableCount[] = [];
  for (const table of tables) {
    if (!present.has(table)) {
      counts.push({ rows: null, table });
      continue;
    }
    const counted = await countRows({ client, table });
    if (counted.isErr()) {
      return err(counted.error);
    }
    counts.push({ rows: counted.value, table });
  }
  return ok(counts);
}
