/**
 * Writing the projected fleet rows — the effectful half of everything else in this directory.
 *
 * Every function takes an already-open {@link StoreClient} rather than opening one, matching
 * `../../knowledge/memoryStore.ts`: the CLI owns the connection's lifetime and closes it in a `finally`.
 * Nothing here reads the environment or builds SQL from a caller's string.
 *
 * ## Every write is an UPSERT on the row's own natural key, and that is the whole re-runnability story
 *
 * The import is meant to be run again — after a refresh, after a day of board churn, on a schedule — and a
 * second run must converge rather than duplicate. Each table says how:
 *
 * - `board_row` upserts on `slug`, because a document is re-projected WHOLE when its file changes. A row
 *   whose frontmatter moved is replaced; `doc_hash` is what shows a reader it did.
 * - `run` upserts on `slug` and its `run_event` children upsert on `(run_id, line_number)`, so a journal
 *   that has grown re-folds the parent and adds only the lines after the ones already held.
 * - `door_event`, `autonomy_event` and `grant_row` upsert on `import_key`, which is the hash of one
 *   physical LINE plus its position (`./importKey.ts`). In an append-only file that key is stable across
 *   every later append, so a grown ledger writes only what is new.
 * - `door_event` is a ledger itself too, and its one-time import is the one `DO UPDATE` on that list: it fills
 *   the `record` of a row an earlier mirror pass wrote without one, and nothing else ({@link importDoorRecords}).
 * - `autonomy_event` and `grant_row` are the ledgers THEMSELVES, so their import runs once: an untargeted
 *   `DO NOTHING`, then a read-back the leg compares line by line, and never a delete or an overwrite. The
 *   autonomy leg then writes `./autonomyStore.ts`'s `markAutonomyImported`, after which no ledger read touches the home's file:
 *   only a rerun of that leg opens it, to verify and report a divergence, never to write.
 *
 * `onConflictDoUpdate` rather than `onConflictDoNothing` on the first two and `DoNothing` on the last
 * three, and the asymmetry is the difference between the sources: a board document is MUTABLE and a
 * ledger line is not. A ledger line that somehow changed under its own key would be a rewritten history,
 * and silently overwriting the stored copy is the last thing this should do.
 *
 * ## Why the rows go in batches
 *
 * `door.jsonl` projects to 198,071 rows. One `insert().values([...])` of that size builds a single
 * statement with over two million bind parameters, which postgres refuses (its parameter limit is 65,535)
 * long before Node runs out of heap. {@link INSERT_BATCH} is the chunk size, chosen so the widest table
 * here stays under that limit with room to spare.
 */
import { and, asc, eq, gt, isNull, notLike, sql } from "drizzle-orm";

import { err, ok, type Result } from "../../lib/result.js";
import type { StoreClient, StoreWriter } from "../client.js";
import { type StoreError, StoreErrors } from "../errors.js";
import { boardRowTable, type NewBoardRowRecord } from "../schema/board.js";
import {
  DOOR_REGISTER_ID,
  doorEventTable,
  doorRegisterTable,
  grantRowTable,
  type NewDoorEventRecord,
  type NewGrantRowRecord,
} from "../schema/ledgers.js";
import { codexPassTable, type NewCodexPassRecord, runEventTable, runTable } from "../schema/runs.js";

import { DOOR_WRITTEN_KEY_PREFIX, type StoredDoorImportRow } from "./doorImport.js";
import type { StoredGrantImportRow } from "./grantRow.js";
import type { ProjectedRun } from "./runJournal.js";

/**
 * Rows per statement.
 *
 * `board_row` is the widest table here at 28 columns, so 500 rows is 14,000 bind parameters — comfortably
 * inside postgres's 65,535 limit and small enough that one failed batch is a readable amount of work to
 * re-run. Reproduce the limit with `select current_setting('max_parameters')` on any Postgres 17.
 */
const INSERT_BATCH = 500;

/**
 * The rows of one table, in batches this store can actually send. Shared with `./autonomyStore.ts`.
 *
 * @returns each slice of at most {@link INSERT_BATCH} rows, in source order
 */
export function* batched<T>({ rows }: { rows: readonly T[] }): Generator<readonly T[]> {
  for (let start = 0; start < rows.length; start += INSERT_BATCH) {
    yield rows.slice(start, start + INSERT_BATCH);
  }
}

/**
 * Every column `board_row` re-writes when a re-import finds a document it already holds.
 *
 * Declared here rather than inline in {@link importBoardRows} so the set has a NAME a test can reach. It is
 * a hand-maintained mirror of the table, which is a shape that rots quietly: MEASURED, `body`
 * arrived with its column, was added to `values`, and was missed here — so a re-import of a document whose
 * prose had changed wrote the new `doc_hash` beside the OLD body, and the row then claimed to be current
 * while its content was not. A fresh database hides that entirely, because every row goes through INSERT
 * and this list only runs on CONFLICT.
 *
 * `unit/store/boardUpsert.test.ts` derives the expected keys from the table itself and fails when a column
 * is added without one, which is the half a reviewer cannot be relied on for.
 */
export const BOARD_ROW_UPSERT_SET = {
  anchor: sql`excluded.anchor`,
  askedAt: sql`excluded.asked_at`,
  baseBranch: sql`excluded.base_branch`,
  blockedBy: sql`excluded.blocked_by`,
  // MEASURED, and this omission was worse than a stale field: `body` arrived with
  // the column and was added to `values` but not here, so a re-import of a document
  // whose PROSE had changed updated `doc_hash` to match the new file and left the old body
  // beside it. The row then claimed to be current while its content was not, which is the exact
  // silent drift `doc_hash` exists to make visible. The first proof missed it because a fresh
  // database takes every row through INSERT, and this list only runs on CONFLICT. Reproduce:
  // import a document, edit its body, re-import, and compare `body` against the file.
  body: sql`excluded.body`,
  branch: sql`excluded.branch`,
  docHash: sql`excluded.doc_hash`,
  doneWhen: sql`excluded.done_when`,
  evidence: sql`excluded.evidence`,
  importedAt: sql`now()`,
  kind: sql`excluded.kind`,
  observedBy: sql`excluded.observed_by`,
  origin: sql`excluded.origin`,
  outputs: sql`excluded.outputs`,
  pausedOn: sql`excluded.paused_on`,
  pausedSince: sql`excluded.paused_since`,
  priority: sql`excluded.priority`,
  repo: sql`excluded.repo`,
  ruling: sql`excluded.ruling`,
  rulingAnchor: sql`excluded.ruling_anchor`,
  settlement: sql`excluded.settlement`,
  settlementReason: sql`excluded.settlement_reason`,
  settlementWitness: sql`excluded.settlement_witness`,
  sourcePath: sql`excluded.source_path`,
  status: sql`excluded.status`,
  summary: sql`excluded.summary`,
} as const;

/**
 * Replace every board row from a fresh projection of the board.
 *
 * @param client an open store connection
 * @param rows every projected document, in scan order
 * @returns how many rows the database reported affected — INSERTED OR REPLACED, since a board document is
 *   mutable and a re-import is meant to overwrite it. Deliberately not comparable to the append-only
 *   ledgers' count, which only ever reports rows that were new
 */
export async function importBoardRows({
  client,
  rows,
}: {
  client: StoreClient;
  rows: readonly NewBoardRowRecord[];
}): Promise<Result<number, StoreError>> {
  if (rows.length === 0) {
    return ok(0);
  }
  try {
    await client.db.transaction(async (writer: StoreWriter): Promise<void> => {
      for (const batch of batched({ rows })) {
        await writer
          .insert(boardRowTable)
          .values([...batch])
          .onConflictDoUpdate({
            set: BOARD_ROW_UPSERT_SET,
            target: boardRowTable.slug,
          });
      }
    });
    return ok(rows.length);
  } catch (cause) {
    return err(StoreErrors.queryFailed({ cause, what: `import ${String(rows.length)} board row(s)` }));
  }
}

/**
 * Every column `run` re-writes when a re-fold finds a run the store already holds. Named for the same
 * reason as {@link BOARD_ROW_UPSERT_SET}: a hand-maintained mirror of a table needs a name a guard can
 * reach. Complete when this was written, and now held that way by `unit/store/boardUpsert.test.ts`.
 */
export const RUN_UPSERT_SET = {
  branch: sql`excluded.branch`,
  derivedAt: sql`now()`,
  docHash: sql`excluded.doc_hash`,
  eventCount: sql`excluded.event_count`,
  firstEventAt: sql`excluded.first_event_at`,
  lastEventAt: sql`excluded.last_event_at`,
  phase: sql`excluded.phase`,
  sourcePath: sql`excluded.source_path`,
  writerSession: sql`excluded.writer_session`,
} as const;

/** Every column one journal LINE re-writes, keyed on `(run_id, line_number)`. See {@link RUN_UPSERT_SET}. */
export const RUN_EVENT_UPSERT_SET = {
  atIso: sql`excluded.at_iso`,
  kind: sql`excluded.kind`,
  payload: sql`excluded.payload`,
} as const;

/**
 * Write one run and its journal lines, re-folding a run the store already holds.
 *
 * One transaction per RUN rather than one for the whole import: a journal's children need their parent's
 * id, and a single transaction over well over a thousand runs would hold every row of every one of them before committing
 * anything. Per-run, a failure leaves the runs before it imported and names the one that broke.
 *
 * @param client an open store connection
 * @param projected one run's parent row, its children and its unreadable line numbers
 * @returns how many EVENT rows were written, or the typed database failure
 */
export async function importRun({
  client,
  projected,
}: {
  client: StoreClient;
  projected: ProjectedRun;
}): Promise<Result<number, StoreError>> {
  try {
    const written = await client.db.transaction(async (writer: StoreWriter): Promise<number> => {
      const [parent] = await writer
        .insert(runTable)
        .values([projected.run])
        .onConflictDoUpdate({ set: RUN_UPSERT_SET, target: runTable.slug })
        .returning({ id: runTable.id });
      // `!` rather than a guard: an upsert with a `DO UPDATE` action always returns its row, so an empty
      // result here would be a driver fault rather than a state this code can meaningfully handle.
      const runId = parent!.id;
      for (const batch of batched({ rows: projected.events })) {
        await writer
          .insert(runEventTable)
          .values(batch.map((event) => ({ ...event, runId })))
          .onConflictDoUpdate({
            set: RUN_EVENT_UPSERT_SET,
            target: [runEventTable.runId, runEventTable.lineNumber],
          });
      }
      return projected.events.length;
    });
    return ok(written);
  } catch (cause) {
    return err(StoreErrors.queryFailed({ cause, what: `import run ${projected.run.slug}` }));
  }
}

/**
 * Write Codex passes, keyed on the artifact id a pass already has.
 *
 * `DoNothing`: a pass's record is written once when the pass ends and never edited, so a conflict means
 * the store already holds it.
 *
 * @param client an open store connection
 * @param rows every projected pass
 * @returns how many rows were written, or the typed database failure
 */
export async function importCodexPasses({
  client,
  rows,
}: {
  client: StoreClient;
  rows: readonly NewCodexPassRecord[];
}): Promise<Result<number, StoreError>> {
  if (rows.length === 0) {
    return ok(0);
  }
  try {
    let written = 0;
    for (const batch of batched({ rows })) {
      const inserted = await client.db
        .insert(codexPassTable)
        .values([...batch])
        .onConflictDoNothing({ target: codexPassTable.id })
        .returning({ id: codexPassTable.id });
      written += inserted.length;
    }
    return ok(written);
  } catch (cause) {
    return err(StoreErrors.queryFailed({ cause, what: `import ${String(rows.length)} Codex pass(es)` }));
  }
}

/**
 * Write door ledger lines, keyed on the import key of the physical line each came from, and FILL the verbatim
 * `record` of a row an earlier mirror import wrote without one.
 *
 * The one `DO UPDATE` among the ledgers, and it is narrower than it reads: it sets `record` alone, and only where
 * the stored `record` IS NULL. An import key is the hash of one line's bytes plus its position, so a mirror row
 * under the same key was projected from the same bytes, and the record filled into it is the line it already
 * summarised. A row that already carries a record is never touched — the read-back reports a difference instead.
 *
 * @param client an open store connection
 * @param rows a batch of projected lines, in source order
 * @returns how many rows were newly written or filled — a rerun over a fully imported ledger answers zero
 */
export async function importDoorRecords({
  client,
  rows,
}: {
  client: StoreClient;
  rows: readonly NewDoorEventRecord[];
}): Promise<Result<number, StoreError>> {
  if (rows.length === 0) {
    return ok(0);
  }
  try {
    let written = 0;
    for (const batch of batched({ rows })) {
      const landed = await client.db
        .insert(doorEventTable)
        .values([...batch])
        .onConflictDoUpdate({
          set: { record: sql`excluded.record` },
          setWhere: isNull(doorEventTable.record),
          target: doorEventTable.importKey,
        })
        .returning({ id: doorEventTable.id });
      written += landed.length;
    }
    return ok(written);
  } catch (cause) {
    return err(StoreErrors.queryFailed({ cause, what: `import ${String(rows.length)} door event(s)` }));
  }
}

/**
 * One page of the rows a door import compares: every row NOT written live (a live key starts `written:`), in `seq`
 * order after `afterSeq`. Paged rather than read whole, because the ledger is two hundred thousand rows.
 *
 * @param client an open store connection
 * @param afterSeq the last `seq` the previous page ended on, `undefined` for the first — no lower bound, since
 *   nothing keeps a hand-written `seq` positive
 * @param limit how many rows one page holds
 * @returns the page, each row's key, seq and record (`null` for an unfilled mirror row), or the database failure
 */
export async function readStoredDoorPage({
  client,
  afterSeq,
  limit,
}: {
  client: StoreClient;
  afterSeq: number | undefined;
  limit: number;
}): Promise<Result<readonly StoredDoorImportRow[], StoreError>> {
  const notLive = notLike(doorEventTable.importKey, `${DOOR_WRITTEN_KEY_PREFIX}%`);
  try {
    const rows = await client.db
      .select({ importKey: doorEventTable.importKey, record: doorEventTable.record, seq: doorEventTable.seq })
      .from(doorEventTable)
      .where(afterSeq === undefined ? notLive : and(gt(doorEventTable.seq, afterSeq), notLive))
      .orderBy(asc(doorEventTable.seq))
      .limit(limit);
    return ok(rows);
  } catch (cause) {
    return err(StoreErrors.queryFailed({ cause, what: "read the door rows back" }));
  }
}

/**
 * Whether the one-time import of the home's door ledger has completed.
 *
 * @param client an open store connection
 * @returns whether the singleton `door_register` row exists
 */
export async function readDoorImported({ client }: { client: StoreClient }): Promise<Result<boolean, StoreError>> {
  try {
    const rows = await client.db
      .select({ id: doorRegisterTable.id })
      .from(doorRegisterTable)
      .where(eq(doorRegisterTable.id, DOOR_REGISTER_ID));
    return ok(rows.length > 0);
  } catch (cause) {
    return err(StoreErrors.queryFailed({ cause, what: "read whether the door ledger was imported" }));
  }
}

/**
 * Record that the one-time door import completed. Written LAST, after a clean read-back: from this row on the store
 * answers for the door ledger, and the home's file is opened only by a verify-only rerun of the import.
 *
 * @param client an open store connection
 * @returns nothing on success, or the typed database failure
 */
export async function markDoorImported({ client }: { client: StoreClient }): Promise<Result<void, StoreError>> {
  try {
    await client.db.insert(doorRegisterTable).values({ id: DOOR_REGISTER_ID }).onConflictDoNothing();
    return ok(undefined);
  } catch (cause) {
    return err(StoreErrors.queryFailed({ cause, what: "mark the door ledger imported" }));
  }
}

/**
 * Write legacy grant journal lines, each keyed on the import key of the physical line it came from.
 *
 * The conflict is UNTARGETED: a line loses to an equal import key, and equally to the one-grant and
 * one-performance indexes, so a legacy duplicate of a row the store already holds is skipped rather than
 * failing the batch. Whether what was skipped AGREES with the stored row is the read-back's question
 * (`../../cli/commands/store/importGrantLeg.ts`), never this insert's.
 *
 * All the batches are ONE transaction. A failed batch leaves nothing committed, so a skipped line from an earlier
 * batch is never left in the store unchecked when the read-back does not run.
 *
 * @param client an open store connection
 * @param rows every projected line, in source order
 * @returns how many rows were NEWLY written
 */
export async function importGrantRows({
  client,
  rows,
}: {
  client: StoreClient;
  rows: readonly NewGrantRowRecord[];
}): Promise<Result<number, StoreError>> {
  if (rows.length === 0) {
    return ok(0);
  }
  try {
    const written = await client.db.transaction(async (writer: StoreWriter): Promise<number> => {
      let count = 0;
      for (const batch of batched({ rows })) {
        const inserted = await writer
          .insert(grantRowTable)
          .values([...batch])
          .onConflictDoNothing()
          .returning({ id: grantRowTable.id });
        count += inserted.length;
      }
      return count;
    });
    return ok(written);
  } catch (cause) {
    return err(StoreErrors.queryFailed({ cause, what: `import ${String(rows.length)} grant row(s)` }));
  }
}

/**
 * Every stored grant row, in the order the journal wrote them.
 *
 * @param client an open store connection
 * @returns the rows in `seq` order, or the typed database failure
 */
export async function readStoredGrantRows({
  client,
}: {
  client: StoreClient;
}): Promise<Result<readonly StoredGrantImportRow[], StoreError>> {
  try {
    const rows = await client.db
      .select({
        entry: grantRowTable.entry,
        entryKind: grantRowTable.entryKind,
        grantId: grantRowTable.grantId,
        importKey: grantRowTable.importKey,
      })
      .from(grantRowTable)
      .orderBy(grantRowTable.seq);
    return ok(rows);
  } catch (cause) {
    return err(StoreErrors.queryFailed({ cause, what: "read the grant rows back" }));
  }
}
