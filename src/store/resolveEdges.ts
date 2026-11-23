/**
 * The pass that turns `content.parent_source_id` into `content.parent_id` — the edge into the relation.
 *
 * ## Why this is a pass and not part of the insert
 *
 * `content.parent_id` is a self-referential foreign key, and {@link ./ingest} writes 500 rows per
 * statement in bronze CAPTURE order, which is not thread order. A reply and the message it answers land
 * in the same statement in either order routinely, so a key checked at insert time would reject whole
 * batches for a reason that has nothing to do with the data being wrong. Deferring the resolution is the
 * only arrangement under which both rows can be written at all.
 *
 * It is also what makes a dangling edge a QUESTION rather than a loss. MEASURED against the
 * live store, 36,121 of 796,261 edges name a parent this store does not hold — a Slack file whose message
 * fell outside an ingested window, a GitHub comment on a pull request from before the backfill's reach.
 * With only a uuid stored, those rows would be indistinguishable from rows that genuinely start a thread.
 * With the natural key beside it, the NEXT ingest of that parent is followed by this pass and they
 * resolve for free.
 *
 * ## Both halves are idempotent and resumable, and neither is resumable by accident
 *
 * {@link backfillParentKeys} walks `content` in primary-key order and writes only the rows whose derived
 * key differs from the stored one, so an interrupted run costs a re-read rather than a wrong answer.
 * {@link resolveParentIds} updates a bounded batch of rows that have an edge and no relation, which is a
 * set that strictly shrinks: the loop cannot fail to terminate and a half-finished run leaves a prefix
 * done. The one value either half ever clears is a `parent_id` whose key just CHANGED under it, which
 * {@link writeParentKeys} explains and the resolution half re-points in the same run.
 *
 * ## The derivation is NOT repeated here
 *
 * Every parent key comes from {@link ./parentSourceId.parentSourceId}, the same pure function the projection
 * calls. Writing the rules a second time in SQL for the backfill's sake is the exact drift `project.ts`'s
 * header warns about — it would put the backfill's behaviour in a language that module's unit tests
 * cannot reach, and the two copies would agree right up until somebody changed one.
 *
 * What that costs is stated where it is paid: {@link readCandidates} re-reads
 * `metadata->'attrs'->>'parentComment'`, so that attribute has to SURVIVE projection rather than being
 * claimed by the column derived from it. `project.ts`'s `parentSourceId` header carries the bug that
 * proves it. Any future input to these rules is under the same obligation.
 */
import { type SQL, sql } from "drizzle-orm";

import { err, ok, type Result } from "../lib/result.js";

import type { StoreClient } from "./client.js";
import { type StoreError, StoreErrors } from "./errors.js";
import { parentSourceId } from "./parentSourceId.js";

/**
 * How many rows one backfill read takes, and one resolution statement updates.
 *
 * Sized so a write batch's bound parameters stay far inside Postgres's 65,535 per statement — the
 * write-back binds two per row, so 1,000 rows is 2,000 parameters. The read half is an index-ordered
 * primary-key seek, so the number trades round trips against heap and nothing else.
 */
const EDGE_BATCH_ROWS = 1000;

/** What one edge pass did, and what it left outstanding. */
export interface EdgeReport {
  /** Rows read while deriving keys — the whole table, unless the caller bounded the pass. */
  readonly rowsScanned: number;
  /** Rows whose `parent_source_id` this pass wrote or corrected. */
  readonly keysWritten: number;
  /** Rows whose `parent_id` this pass resolved. */
  readonly edgesResolved: number;
  /** Rows carrying an edge at the end of the pass, resolved or not. */
  readonly totalEdges: number;
  /** Rows whose parent is named and not in this store — re-resolvable when it lands. */
  readonly dangling: number;
}

/**
 * Run one statement against the store and hand back its rows — every read and write an edge pass makes.
 *
 * The store client's own `db.execute` in {@link resolveEdges}; a scripted answer in a unit test.
 */
export type ResolveEdgesExecute = (args: { statement: SQL }) => Promise<Iterable<Record<string, unknown>>>;

/** One row as the backfill reads it: everything {@link parentSourceId} needs, and nothing else. */
interface EdgeCandidate {
  readonly id: string;
  readonly source: string;
  readonly sourceId: string;
  readonly parentComment: string | null;
  readonly stored: string | null;
}

/**
 * Read one primary-key-ordered page of rows to derive keys for.
 *
 * @param runStatement what runs the read against the open store
 * @param after the last id of the previous page, or `null` to start at the beginning
 * @param batch how many rows to read
 * @returns the page, in id order
 */
async function readCandidates({
  runStatement,
  after,
  batch,
}: {
  runStatement: ResolveEdgesExecute;
  after: string | null;
  batch: number;
}): Promise<readonly EdgeCandidate[]> {
  const cursor = after === null ? sql`true` : sql`id > ${after}::uuid`;
  const rows = await runStatement({
    statement: sql`
    select id::text as id,
           source::text as source,
           source_id as "sourceId",
           metadata->'attrs'->>'parentComment' as "parentComment",
           parent_source_id as stored
    from content
    where ${cursor}
    order by id
    limit ${batch}
  `,
  });
  return [...rows].map((row): EdgeCandidate => {
    const bag = row;
    return {
      id: String(bag["id"]),
      parentComment: typeof bag["parentComment"] === "string" ? bag["parentComment"] : null,
      source: String(bag["source"]),
      sourceId: String(bag["sourceId"]),
      stored: typeof bag["stored"] === "string" ? bag["stored"] : null,
    };
  });
}

/**
 * Write one page's derived keys back, in a single statement.
 *
 * **`parent_id` is cleared in the same statement, and that is not a contradiction of "neither half ever
 * clears a value it has already written".** A row only reaches here when its derived key DIFFERS from the
 * stored one, so any relation resolved from the old key now points at a row the new key does not name —
 * stale, and invisible, because {@link resolveParentIds} only ever looks at rows whose `parent_id` is
 * null. Clearing it is what puts the row back in that pass's candidate set, and the pass runs immediately
 * after this one in {@link resolveEdges}, so the relation is re-pointed within the same run. The path that
 * gets here is a RULE CHANGE rather than ordinary ingest: an id-derived key is a function of the unique
 * key itself and cannot move.
 *
 * @param runStatement what runs the write against the open store
 * @param writes the id and derived key of every row whose stored value was wrong or absent
 * @returns nothing; the caller counts what it asked for
 */
async function writeParentKeys({
  runStatement,
  writes,
}: {
  runStatement: ResolveEdgesExecute;
  writes: readonly { readonly id: string; readonly key: string }[];
}): Promise<void> {
  const tuples = writes.map((write) => sql`(${write.id}::uuid, ${write.key}::text)`);
  await runStatement({
    statement: sql`
    update content set parent_source_id = v.key, parent_id = null
    from (values ${sql.join(tuples, sql`, `)}) as v(id, key)
    where content.id = v.id
  `,
  });
}

/**
 * The rows of one page whose derived key is not the key already stored.
 *
 * A row whose rule answers `null` is left alone rather than cleared. That asymmetry is deliberate: a
 * stored key this pass cannot re-derive is far more likely to be a rule that has not been taught a shape
 * yet than a row that genuinely stopped having a parent, and clearing it would take the row out of its own
 * thread on the strength of a guess.
 *
 * @param page one primary-key-ordered read
 * @returns the id and derived key of every row that needs writing, in page order
 */
function pageWrites({ page }: { page: readonly EdgeCandidate[] }): readonly { id: string; key: string }[] {
  const writes: { id: string; key: string }[] = [];
  for (const row of page) {
    const derived = parentSourceId({
      parentComment: row.parentComment,
      source: row.source,
      sourceId: row.sourceId,
    });
    if (derived !== null && derived !== row.stored) {
      writes.push({ id: row.id, key: derived });
    }
  }
  return writes;
}

/**
 * Derive `parent_source_id` for every row in the store, writing only what is wrong or missing.
 *
 * Deliberately UNFILTERED: it walks the whole table in primary-key order rather than trying to
 * pre-select the rows that look like children. A filter would be a second expression of the rules in
 * {@link ./parentSourceId.parentSourceId} — written in SQL, untested, and wrong the moment a source's id shape
 * changes — bought for a saving that is a read of an index-ordered table this store already fits in
 * memory. Completeness is worth more than the scan here.
 *
 * @param runStatement what runs each read and write against the open store
 * @param batch how many rows per page
 * @returns how many rows were read and how many keys were written, or the store's own typed failure
 */
async function backfillParentKeys({
  runStatement,
  batch = EDGE_BATCH_ROWS,
}: {
  runStatement: ResolveEdgesExecute;
  batch?: number;
}): Promise<Result<{ readonly rowsScanned: number; readonly keysWritten: number }, StoreError>> {
  let after: string | null = null;
  let rowsScanned = 0;
  let keysWritten = 0;
  try {
    for (;;) {
      const page: readonly EdgeCandidate[] = await readCandidates({ after, batch, runStatement });
      if (page.length === 0) {
        return ok({ keysWritten, rowsScanned });
      }
      rowsScanned += page.length;
      const writes = pageWrites({ page });
      if (writes.length > 0) {
        await writeParentKeys({ runStatement, writes });
        keysWritten += writes.length;
      }
      const last = page[page.length - 1];
      if (last === undefined) {
        return ok({ keysWritten, rowsScanned });
      }
      after = last.id;
    }
  } catch (error: unknown) {
    return err(StoreErrors.queryFailed({ cause: error, what: "store edges (backfill keys)" }));
  }
}

/**
 * Point every resolvable `parent_source_id` at the row it names.
 *
 * The statement's candidate set is "has an edge, has no relation, and the parent is in the store", which
 * is exactly what `idx_content_parent_unresolved` indexes. Each batch removes its own rows from that set,
 * so the loop terminates on the data rather than on a ceiling, and running it twice is free.
 *
 * @param runStatement what runs each resolution against the open store
 * @param batch how many rows one statement resolves
 * @returns how many edges were resolved, or the store's own typed failure
 */
async function resolveParentIds({
  runStatement,
  batch = EDGE_BATCH_ROWS,
}: {
  runStatement: ResolveEdgesExecute;
  batch?: number;
}): Promise<Result<number, StoreError>> {
  let resolved = 0;
  try {
    for (;;) {
      const rows = await runStatement({
        statement: sql`
        with candidate as (
          select c.id as child, p.id as parent
          from content c
          join content p on p.source = c.source and p.source_id = c.parent_source_id
          where c.parent_id is null and c.parent_source_id is not null
          limit ${batch}
        ), applied as (
          update content set parent_id = candidate.parent
          from candidate where content.id = candidate.child
          returning content.id
        )
        select count(*)::int as n from applied
      `,
      });
      const first = [...rows][0];
      const n = typeof first?.["n"] === "number" ? first["n"] : 0;
      if (n === 0) {
        return ok(resolved);
      }
      resolved += n;
    }
  } catch (error: unknown) {
    return err(StoreErrors.queryFailed({ cause: error, what: "store edges (resolve)" }));
  }
}

/**
 * Count what the store holds once a pass has run.
 *
 * @param runStatement what runs the count against the open store
 * @returns the edge and dangling totals, or the store's own typed failure
 */
async function countEdges({
  runStatement,
}: {
  runStatement: ResolveEdgesExecute;
}): Promise<Result<{ readonly totalEdges: number; readonly dangling: number }, StoreError>> {
  try {
    const rows = await runStatement({
      statement: sql`
      select count(*) filter (where parent_source_id is not null)::int as edges,
             count(*) filter (where parent_source_id is not null and parent_id is null)::int as dangling
      from content
    `,
    });
    const first = [...rows][0];
    return ok({
      dangling: typeof first?.["dangling"] === "number" ? first["dangling"] : 0,
      totalEdges: typeof first?.["edges"] === "number" ? first["edges"] : 0,
    });
  } catch (error: unknown) {
    return err(StoreErrors.queryFailed({ cause: error, what: "store edges (count)" }));
  }
}

/**
 * Run both halves, in the one order that works: keys first, then the relation they name.
 *
 * @param client the open store
 * @param batch how many rows per page and per statement
 * @param keysOnly derive keys and stop — for checking what a rule change writes, which leaves every key
 *   it changed with a null relation until a full pass runs
 * @returns what the pass did and what it left outstanding, or the store's own typed failure
 */
export async function resolveEdges({
  client,
  batch = EDGE_BATCH_ROWS,
  keysOnly = false,
}: {
  client: StoreClient;
  batch?: number;
  keysOnly?: boolean;
}): Promise<Result<EdgeReport, StoreError>> {
  const runStatement: ResolveEdgesExecute = async ({ statement }) => client.db.execute(statement);
  return resolveEdgesVia({ batch, keysOnly, runStatement });
}

/**
 * {@link resolveEdges} over any statement runner: keys first, then the relation they name, then the count.
 *
 * @param runStatement what runs every statement of the pass, in order
 * @param batch how many rows per page and per statement
 * @param keysOnly derive keys and skip the resolution half, still counting at the end
 * @returns what the pass did and what it left outstanding, or the store's own typed failure
 */
export async function resolveEdgesVia({
  runStatement,
  batch = EDGE_BATCH_ROWS,
  keysOnly = false,
}: {
  runStatement: ResolveEdgesExecute;
  batch?: number;
  keysOnly?: boolean;
}): Promise<Result<EdgeReport, StoreError>> {
  const keys = await backfillParentKeys({ batch, runStatement });
  if (keys.isErr()) {
    return err(keys.error);
  }
  let edgesResolved = 0;
  if (!keysOnly) {
    const resolved = await resolveParentIds({ batch, runStatement });
    if (resolved.isErr()) {
      return err(resolved.error);
    }
    edgesResolved = resolved.value;
  }
  const counts = await countEdges({ runStatement });
  if (counts.isErr()) {
    return err(counts.error);
  }
  return ok({
    dangling: counts.value.dangling,
    edgesResolved,
    keysWritten: keys.value.keysWritten,
    rowsScanned: keys.value.rowsScanned,
    totalEdges: counts.value.totalEdges,
  });
}
