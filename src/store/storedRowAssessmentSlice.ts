/**
 * The day's slice of stored rows due for a verdict, read from the store: each classified table walked newest first
 * until it has yielded one row past the day's remaining capacity, or run out. The pure half is
 * `./storedRowAssessment.ts`; the digest expression and the reads of a row's words are `./storedRowAssessmentRead.ts`.
 *
 * A candidate page selects a row's key, its facts, its instant and the digest — never its title or body — so walking
 * past every row already assessed reads no word of any of them. Every statement names the `public` schema's tables
 * through drizzle's table objects, and every function it calls is `pg_catalog`'s.
 */
import { desc, eq, type SQL, sql } from "drizzle-orm";

import { err, ok, type Result } from "#lib/result.js";

import type { StoreClient } from "./client.js";
import {
  contentDataClassFactsFromFields,
  ownerCaptureDataClassFacts,
  ownerTurnDataClassFacts,
} from "./dataClassIntake.js";
import { DATA_CLASS_RULE_TABLES, type DataClassRule, type DataClassRuleTable } from "./dataClassRules.js";
import { type StoreError, StoreErrors } from "./errors.js";
import { type RecordedDataClassAssessment, storedRowAssessmentIndex } from "./recordedDataClassAssessment.js";
import { containerTable } from "./schema/container.js";
import { contentTable } from "./schema/content.js";
import { ownerCaptureTable } from "./schema/ownerCapture.js";
import { ownerTurnTable } from "./schema/ownerTurn.js";
import {
  type DueStoredRow,
  dueStoredRows,
  type StoredRowAssessmentCandidate,
  type StoredRowAssessmentSlice,
  storedRowAssessmentSlice,
  storedRowsAssessedToday,
} from "./storedRowAssessment.js";
import { contentAssessmentDigest } from "./storedRowAssessmentRead.js";

/**
 * Rows one newest-first page reads. A table's walk stops as soon as it has yielded one row past the day's slice, so it
 * reads past the rows already assessed and no further.
 */
const CANDIDATE_PAGE_ROWS = 500;

/** A position in a newest-first walk: the last row's instant and key. */
interface StoredRowCursor {
  readonly orderAtIso: string;
  readonly rowId: string;
}

/** One newest-first page's arguments. */
interface CandidatePageArgs {
  readonly client: StoreClient;
  readonly after: StoredRowCursor | null;
  readonly batch: number;
}

/**
 * An instant column as ISO text with every fractional digit the store keeps, so a cursor built from it re-reads the
 * exact boundary rather than one rounded to milliseconds.
 *
 * @param column the timestamp column
 * @returns the expression
 */
function isoText({ column }: { column: SQL }): SQL<string> {
  return sql<string>`(pg_catalog.to_json(${column}) #>> '{}')`;
}

/**
 * The keyset predicate for a newest-first walk past a cursor: every row strictly older than it, ties on the instant
 * broken by the key, so a page boundary between two rows of one instant drops neither.
 *
 * @param after the cursor, or null at the start of the walk
 * @param orderAt the instant column
 * @param key the key column
 * @param cast the key's type, for the bound value
 * @returns the predicate, or `undefined` at the start
 * @internal — exported so a test reads the rendered predicate.
 */
export function newestFirstAfter({
  after,
  orderAt,
  key,
  cast,
}: {
  after: StoredRowCursor | null;
  orderAt: SQL;
  key: SQL;
  cast: SQL;
}): SQL | undefined {
  if (after === null) {
    return undefined;
  }
  return sql`(${orderAt}, ${key}) < (${after.orderAtIso}::pg_catalog.timestamptz, ${after.rowId}::${cast})`;
}

/**
 * One newest-first page of `content`: key, facts, instant and digest. Never the title or body.
 *
 * @returns the page
 */
async function contentCandidatePage({
  client,
  after,
  batch,
}: CandidatePageArgs): Promise<readonly StoredRowAssessmentCandidate[]> {
  const rows = await client.db
    .select({
      author: contentTable.authorNativeId,
      container: containerTable.nativeId,
      digest: contentAssessmentDigest,
      id: contentTable.id,
      kind: contentTable.kind,
      orderAtIso: isoText({ column: sql`${contentTable.occurredAt}` }),
      source: contentTable.source,
      visibility: contentTable.visibility,
    })
    .from(contentTable)
    .leftJoin(containerTable, eq(contentTable.containerId, containerTable.id))
    .where(
      newestFirstAfter({
        after,
        cast: sql`pg_catalog.uuid`,
        key: sql`${contentTable.id}`,
        orderAt: sql`${contentTable.occurredAt}`,
      }),
    )
    .orderBy(desc(contentTable.occurredAt), desc(contentTable.id))
    .limit(batch);
  return rows.map((row) => ({
    facts: contentDataClassFactsFromFields({
      author: row.author,
      container: row.container,
      kind: row.kind,
      source: row.source,
      visibility: row.visibility,
    }),
    orderAtIso: row.orderAtIso,
    requestSha256: row.digest,
    rowId: row.id,
    table: "content",
  }));
}

/**
 * One newest-first page of `owner_capture`, by when the owner said it: key, source, instant and digest. Never the body.
 *
 * @returns the page
 */
async function ownerCaptureCandidatePage({
  client,
  after,
  batch,
}: CandidatePageArgs): Promise<readonly StoredRowAssessmentCandidate[]> {
  const rows = await client.db
    .select({
      digest: ownerCaptureTable.bodySha256,
      id: ownerCaptureTable.id,
      orderAtIso: isoText({ column: sql`${ownerCaptureTable.saidAt}` }),
      source: ownerCaptureTable.source,
    })
    .from(ownerCaptureTable)
    .where(
      newestFirstAfter({
        after,
        cast: sql`pg_catalog.uuid`,
        key: sql`${ownerCaptureTable.id}`,
        orderAt: sql`${ownerCaptureTable.saidAt}`,
      }),
    )
    .orderBy(desc(ownerCaptureTable.saidAt), desc(ownerCaptureTable.id))
    .limit(batch);
  return rows.map((row) => ({
    facts: ownerCaptureDataClassFacts({ source: row.source }),
    orderAtIso: row.orderAtIso,
    requestSha256: row.digest,
    rowId: row.id,
    table: "owner_capture",
  }));
}

/**
 * One newest-first page of `owner_turn`, by when the store first held the body (the table keeps no spoken-at instant).
 * Its key IS its digest. Never the body.
 *
 * @returns the page
 */
async function ownerTurnCandidatePage({
  client,
  after,
  batch,
}: CandidatePageArgs): Promise<readonly StoredRowAssessmentCandidate[]> {
  const rows = await client.db
    .select({
      id: ownerTurnTable.bodySha256,
      orderAtIso: isoText({ column: sql`${ownerTurnTable.firstImportedAt}` }),
    })
    .from(ownerTurnTable)
    .where(
      newestFirstAfter({
        after,
        cast: sql`pg_catalog.text`,
        key: sql`${ownerTurnTable.bodySha256}`,
        orderAt: sql`${ownerTurnTable.firstImportedAt}`,
      }),
    )
    .orderBy(desc(ownerTurnTable.firstImportedAt), desc(ownerTurnTable.bodySha256))
    .limit(batch);
  return rows.map((row) => ({
    facts: ownerTurnDataClassFacts(),
    orderAtIso: row.orderAtIso,
    requestSha256: row.id,
    rowId: row.id,
    table: "owner_turn",
  }));
}

/** Each classified table's newest-first candidate reader. */
const CANDIDATE_PAGE_READERS: Readonly<
  Record<DataClassRuleTable, (args: CandidatePageArgs) => Promise<readonly StoredRowAssessmentCandidate[]>>
> = {
  content: contentCandidatePage,
  owner_capture: ownerCaptureCandidatePage,
  owner_turn: ownerTurnCandidatePage,
};

/**
 * One table's newest due rows: walked newest first until it has yielded `want` of them or run out.
 *
 * @param want how many due rows to stop at
 * @param assessed the register's stored-row verdicts by key
 * @returns the table's newest due rows, at most `want`
 */
async function newestDueOf({
  client,
  table,
  rules,
  assessed,
  want,
}: {
  client: StoreClient;
  table: DataClassRuleTable;
  rules: readonly DataClassRule[];
  assessed: ReturnType<typeof storedRowAssessmentIndex>;
  want: number;
}): Promise<readonly DueStoredRow[]> {
  const collected: DueStoredRow[] = [];
  let after: StoredRowCursor | null = null;
  for (;;) {
    const page: readonly StoredRowAssessmentCandidate[] = await CANDIDATE_PAGE_READERS[table]({
      after,
      batch: CANDIDATE_PAGE_ROWS,
      client,
    });
    collected.push(...dueStoredRows({ assessed, page, rules }));
    const last = page.at(-1);
    if (collected.length >= want || last === undefined || page.length < CANDIDATE_PAGE_ROWS) {
      return collected.slice(0, want);
    }
    after = { orderAtIso: last.orderAtIso, rowId: last.rowId };
  }
}

/**
 * The day's slice over every classified table: the newest due rows the day still has room for, and whether more are
 * due beyond them. Reads no row's words.
 *
 * @param records the register's assessments, read once by the caller
 * @param nowMs the instant the local day is judged at
 * @param limit the day's capacity
 * @returns the slice, or the store's typed failure
 */
export async function readStoredRowAssessmentSlice({
  client,
  rules,
  records,
  nowMs,
  limit,
}: {
  client: StoreClient;
  rules: readonly DataClassRule[];
  records: readonly RecordedDataClassAssessment[];
  nowMs: number;
  limit: number;
}): Promise<Result<StoredRowAssessmentSlice, StoreError>> {
  const assessed = storedRowAssessmentIndex({ records });
  const assessedToday = storedRowsAssessedToday({ nowMs, records });
  const want = Math.max(0, limit - assessedToday) + 1;
  try {
    const perTable: (readonly DueStoredRow[])[] = [];
    for (const table of DATA_CLASS_RULE_TABLES) {
      perTable.push(await newestDueOf({ assessed, client, rules, table, want }));
    }
    return ok(storedRowAssessmentSlice({ assessedToday, limit, perTable }));
  } catch (cause) {
    return err(StoreErrors.queryFailed({ cause, what: "store assessment-due" }));
  }
}
