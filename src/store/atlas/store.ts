/**
 * Writing one atlas generation into the store — the effectful half of `./project.ts` and `./read.ts`.
 *
 * ## A generation is a TRANSACTION, and that is what this leg buys
 *
 * `src/atlas/kit/generationSwap.ts`'s own header names the residue the filesystem cannot close: _"what it
 * cannot do is survive a process KILL mid-commit … closing that needs the whole generation to hang off one
 * renameable pointer, which is a layout change across every atlas"_. In Postgres a transaction IS that
 * pointer. {@link replaceKindSlice} deletes one `(platform, kind)` slice and writes the new one inside a
 * single transaction, so a killed import leaves the previous generation intact rather than half-replaced —
 * strictly safer than the two-phase rename on disk, with no layout change at all.
 *
 * DELETE-then-INSERT rather than upsert-then-sweep, because a generation REPLACES its kind: an entity the
 * new generation dropped must not survive as a row nothing will ever update again. The channel rows go
 * with it through `fk_atlas_entity_channel_entity`'s cascade, so the replacement is one statement that
 * cannot be interrupted between the two tables.
 *
 * ## The transaction STREAMS, which is why it takes a reader rather than rows
 *
 * {@link replaceKindSlice} is handed `nextSlice` — `./read.ts`'s bounded reader, curried — instead of an
 * array of entities. Taking an array would mean the caller had already projected the whole kind file into
 * the heap, which is the buffering the bounded reader exists to prevent, moved one layer up. So the
 * transaction opens, deletes, and then pulls one bounded slice at a time until the file is exhausted,
 * holding at most one slice and one 8 MiB chunk at any instant whatever the file's size.
 *
 * ## The unit of resumption is the KIND, not a byte offset
 *
 * `store ingest` resumes by byte offset into a bronze file. This deliberately does not, and the reason is
 * not effort: a generation can be swapped underneath a reader between two runs, so an offset into the file
 * it started on addresses different bytes than it did. The kind is the honest unit — re-running an import
 * re-reads and re-replaces whole slices, and a slice whose digest already matches is skipped outright.
 */
import { and, count, eq, sql } from "drizzle-orm";

import { err, ok, type Result } from "../../lib/result.js";
import type { StoreClient, StoreWriter } from "../client.js";
import { type StoreError, StoreErrors } from "../errors.js";
import {
  atlasCoverageTable,
  atlasEntityChannelTable,
  atlasEntityTable,
  atlasGapTable,
  atlasKindStatusTable,
  type NewAtlasCoverageRow,
  type NewAtlasGapRow,
  type NewAtlasKindStatusRow,
} from "../schema.js";

import type { AtlasImportError } from "./errors.js";
import type { AtlasEntitySlice } from "./read.js";

/**
 * Rows per statement.
 *
 * `atlas_entity_channel` is the widest table here at 14 columns, so 500 rows is 7,000 bind parameters —
 * well inside postgres's 65,535 limit, and the same 500 `../fleet/store.ts` and `../ingest.ts` already
 * use. A second constant would be a second thing to tune.
 */
const INSERT_BATCH = 500;

/**
 * Entity rows one slice takes before it is written.
 *
 * Not a heap bound on its own — the reader stops at an 8 MiB CHUNK boundary, so a slice's real transient
 * is one chunk's worth of parsed lines whatever this says. What it bounds is the SQL: 5,000 entity rows
 * is ten statements of 500, and a slice that failed is a readable amount of work to re-run.
 */
export const SLICE_ROWS = 5000;

/** The rows of one table, in batches this store can actually send. */
function* batched<T>({ rows }: { rows: readonly T[] }): Generator<readonly T[]> {
  for (let start = 0; start < rows.length; start += INSERT_BATCH) {
    yield rows.slice(start, start + INSERT_BATCH);
  }
}

/** What replacing one kind's slice wrote, and what it refused on the way. */
export interface KindSliceReport {
  /**
   * Entity rows the database HOLDS for this slice once the transaction closed — counted, not assumed.
   *
   * MEASURED on the first full rehearsal: reporting `slice.entities.length` instead reported
   * one more row written than the table actually held, because `onConflictDoNothing` swallowed the
   * one duplicate `(platform, kind, entity_id)` the estate carries (`cloudflare/api-gateway.jsonl`) and the
   * projected count knew nothing about it. That also made {@link KindSliceReport.entitiesCollapsed} a
   * statistic that could never fire — the exact silent fold `../schema/atlas.ts` says not to allow.
   */
  readonly entities: number;
  /** Entity lines that projected cleanly and did not become a row: a duplicate key already on disk. */
  readonly entitiesCollapsed: number;
  /** Channel rows the database HOLDS for this slice, counted the same way and for the same reason. */
  readonly channels: number;
  readonly coverage: number;
  readonly gaps: number;
  readonly linesRead: number;
  readonly refusalCount: number;
  readonly refusals: readonly AtlasImportError[];
  /** U+0000 characters removed on the way into a jsonb column. See `./project.ts`'s `stripNuls`. */
  readonly nulsStripped: number;
}

/** Everything one kind file's ENVELOPE projected, which is bounded and so may be passed whole. */
export interface AtlasKindEnvelopeRows {
  readonly coverage: readonly NewAtlasCoverageRow[];
  readonly gaps: readonly NewAtlasGapRow[];
  readonly status: NewAtlasKindStatusRow;
}

/**
 * Every column `atlas_kind_status` re-writes when a re-import finds a `(platform, kind)` it already holds.
 *
 * Declared here rather than inline so the set has a NAME a test can reach — the same reason
 * `../fleet/store.ts`'s `BOARD_ROW_UPSERT_SET` is named, and for the same measured failure: a column added
 * to `values` and missed here updates nothing on CONFLICT, which a fresh database cannot catch because
 * every row there goes through INSERT. `unit/store/atlas/upsert.test.ts` derives the expectation from the
 * table itself.
 */
export const ATLAS_KIND_STATUS_UPSERT_SET = {
  digest: sql`excluded.digest`,
  entityCount: sql`excluded.entity_count`,
  generationAt: sql`excluded.generation_at`,
  lastAttemptAt: sql`excluded.last_attempt_at`,
  lastAttemptOutcome: sql`excluded.last_attempt_outcome`,
  lastAttemptReasons: sql`excluded.last_attempt_reasons`,
  lastSuccessAt: sql`excluded.last_success_at`,
  loadedAt: sql`now()`,
  permissionBlocked: sql`excluded.permission_blocked`,
  readEpoch: sql`excluded.read_epoch`,
  schemaVersion: sql`excluded.schema_version`,
} as const;

/**
 * Replace one `(platform, kind)` slice of the atlas, in one transaction, streaming its entities in.
 *
 * @param client an open store connection
 * @param platform the platform directory
 * @param kind the envelope's kind
 * @param envelopeRows the coverage, gap and status rows line 1 projected
 * @param from the byte offset the first entity line starts at
 * @param nextSlice the bounded reader, which this calls until it stops advancing
 * @returns what was written and what was refused, or the database failure
 */
export async function replaceKindSlice({
  client,
  platform,
  kind,
  envelopeRows,
  from,
  nextSlice,
}: {
  client: StoreClient;
  platform: string;
  kind: string;
  envelopeRows: AtlasKindEnvelopeRows;
  from: number;
  nextSlice: (args: { from: number; linesBefore: number }) => AtlasEntitySlice;
}): Promise<Result<KindSliceReport, StoreError>> {
  const report: MutableSliceReport = {
    channels: 0,
    coverage: envelopeRows.coverage.length,
    entities: 0,
    entitiesCollapsed: 0,
    projected: 0,
    gaps: envelopeRows.gaps.length,
    linesRead: 0,
    nulsStripped: 0,
    refusalCount: 0,
    refusals: [] as AtlasImportError[],
  };
  try {
    await client.db.transaction(async (writer: StoreWriter): Promise<void> => {
      await clearSlice({ kind, platform, writer });
      await streamEntities({ from, nextSlice, report, writer });
      await writeEnvelopeRows({ envelopeRows, writer });
      report.entities = await countStored({ kind, platform, table: atlasEntityTable, writer });
      report.entitiesCollapsed = Math.max(0, report.projected - report.entities);
      // The duplicate that collapsed took its channel row with it, so a projected channel count would be
      // one out too — the same class, one table over.
      report.channels = await countStored({ kind, platform, table: atlasEntityChannelTable, writer });
    });
    return ok(report);
  } catch (cause) {
    return err(StoreErrors.queryFailed({ cause, what: `replace the ${platform}/${kind} atlas slice` }));
  }
}

/**
 * Delete one `(platform, kind)` slice from all three tables that hold rows for it.
 *
 * The channel rows go with the entities through `fk_atlas_entity_channel_entity`'s cascade, so this is
 * three statements rather than four and none of them can be interrupted between the two entity tables.
 *
 * @param writer the open transaction
 * @param platform the platform
 * @param kind the envelope's kind
 */
async function clearSlice({
  writer,
  platform,
  kind,
}: {
  writer: StoreWriter;
  platform: string;
  kind: string;
}): Promise<void> {
  await writer
    .delete(atlasEntityTable)
    .where(and(eq(atlasEntityTable.platform, platform), eq(atlasEntityTable.kind, kind)));
  await writer
    .delete(atlasCoverageTable)
    .where(and(eq(atlasCoverageTable.platform, platform), eq(atlasCoverageTable.kind, kind)));
  await writer.delete(atlasGapTable).where(and(eq(atlasGapTable.platform, platform), eq(atlasGapTable.kind, kind)));
}

/**
 * Pull bounded slices off the reader and insert each one, until the file is exhausted.
 *
 * `onConflictDoNothing` rather than `onConflictDoUpdate`: the estate holds one byte-identical duplicate
 * entity today (`cloudflare/api-gateway.jsonl`), and the collapse is COUNTED against the table afterwards
 * rather than absorbed — see `../schema/atlas.ts`'s § on the gap duplicates for the same class.
 *
 * @param writer the open transaction
 * @param from the byte offset the first entity line starts at
 * @param nextSlice the bounded reader
 * @param report the run's accumulator, extended in place
 */
async function streamEntities({
  writer,
  from,
  nextSlice,
  report,
}: {
  writer: StoreWriter;
  from: number;
  nextSlice: (args: { from: number; linesBefore: number }) => AtlasEntitySlice;
  report: MutableSliceReport;
}): Promise<void> {
  let at = from;
  for (;;) {
    const slice = nextSlice({ from: at, linesBefore: report.linesRead });
    report.linesRead += slice.linesRead;
    report.nulsStripped += slice.nulsStripped;
    report.refusalCount += slice.refusalCount;
    for (const refusal of slice.refusals) {
      if (report.refusals.length < MAX_REPORTED_REFUSALS) {
        report.refusals.push(refusal);
      }
    }
    for (const batch of batched({ rows: slice.entities })) {
      await writer
        .insert(atlasEntityTable)
        .values([...batch])
        .onConflictDoNothing();
    }
    for (const batch of batched({ rows: slice.channels })) {
      await writer
        .insert(atlasEntityChannelTable)
        .values([...batch])
        .onConflictDoNothing();
    }
    report.projected += slice.entities.length;
    // The CURSOR is the whole termination condition: at end of file the reader delivers nothing and
    // the offset does not move. An earlier draft also stopped on `linesRead === 0`, which would have
    // truncated a file whose slice happened to hold only blank lines — a condition the reader can
    // legitimately produce and which says nothing about the end of the file.
    if (slice.resumeByteOffset <= at) {
      return;
    }
    at = slice.resumeByteOffset;
  }
}

/**
 * Write the bounded rows line 1 projected — the coverage cells, the gaps, and the kind's status.
 *
 * @param writer the open transaction
 * @param envelopeRows what the envelope projected
 */
async function writeEnvelopeRows({
  writer,
  envelopeRows,
}: {
  writer: StoreWriter;
  envelopeRows: AtlasKindEnvelopeRows;
}): Promise<void> {
  for (const batch of batched({ rows: envelopeRows.coverage })) {
    await writer
      .insert(atlasCoverageTable)
      .values([...batch])
      .onConflictDoNothing();
  }
  for (const batch of batched({ rows: envelopeRows.gaps })) {
    await writer
      .insert(atlasGapTable)
      .values([...batch])
      .onConflictDoNothing();
  }
  await writer
    .insert(atlasKindStatusTable)
    .values(envelopeRows.status)
    .onConflictDoUpdate({
      set: ATLAS_KIND_STATUS_UPSERT_SET,
      target: [atlasKindStatusTable.platform, atlasKindStatusTable.kind],
    });
}

/**
 * How many entity rows this transaction will commit for one slice.
 *
 * Counted against the TABLE rather than derived from what was projected, and counted INSIDE the
 * transaction so what is reported is what will commit rather than what a later reader might see.
 * MEASURED on the first full rehearsal: the projected count reported one more row written than
 * were actually stored, because `onConflictDoNothing` swallowed the estate's one duplicate key.
 *
 * @param writer the open transaction
 * @param platform the platform
 * @param kind the envelope's kind
 * @param table which of the two entity tables to count
 * @returns the row count
 */
async function countStored({
  writer,
  platform,
  kind,
  table,
}: {
  writer: StoreWriter;
  platform: string;
  kind: string;
  table: typeof atlasEntityTable | typeof atlasEntityChannelTable;
}): Promise<number> {
  const stored = await writer
    .select({ rows: count() })
    .from(table)
    .where(and(eq(table.platform, platform), eq(table.kind, kind)));
  const counted = stored[0];
  // A `count()` over one predicate always returns exactly one row; an empty result would mean the driver
  // returned something this code does not understand, which must not read as "no entities".
  if (counted === undefined) {
    throw new Error(`counting the ${platform}/${kind} slice returned no row`);
  }
  return counted.rows;
}

/** The accumulator {@link replaceKindSlice} fills as it streams. Mutable by construction. */
interface MutableSliceReport {
  channels: number;
  coverage: number;
  entities: number;
  entitiesCollapsed: number;
  gaps: number;
  linesRead: number;
  nulsStripped: number;
  projected: number;
  refusalCount: number;
  readonly refusals: AtlasImportError[];
}

/** How many refusals one KIND reports, however many it counts. The count stays exact. */
const MAX_REPORTED_REFUSALS = 20;

/**
 * Every `(platform, kind)` the store already holds, with the digest it was loaded from.
 *
 * Read once at the start of an import so the whole skip decision is one query rather than one per kind.
 *
 * @param client an open store connection
 * @returns a `platform\0kind` → digest map, with `null` for a slice whose manifest carried no digest
 */
export async function storedKindDigests({
  client,
}: {
  client: StoreClient;
}): Promise<Result<ReadonlyMap<string, string | null>, StoreError>> {
  try {
    const rows = await client.db
      .select({
        digest: atlasKindStatusTable.digest,
        kind: atlasKindStatusTable.kind,
        platform: atlasKindStatusTable.platform,
      })
      .from(atlasKindStatusTable);
    return ok(new Map(rows.map((row) => [`${row.platform}\u0000${row.kind}`, row.digest])));
  } catch (cause) {
    return err(StoreErrors.queryFailed({ cause, what: "read the stored atlas kind digests" }));
  }
}
