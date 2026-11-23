/**
 * Reading and writing the memories table — the effectful half of `./memoryRow.ts` and `./recall.ts`.
 *
 * Every function here takes an already-open {@link StoreClient} rather than opening one, so the CLI owns
 * the connection's lifetime and closes it in a `finally`. Nothing in this module reads the environment,
 * builds SQL from a caller's string, or falls back to a file.
 *
 * ## A database failure is never an empty result
 *
 * The caller is a session about to start work, and "nothing has been learned about Datadog" and "the store
 * is down" lead to opposite next actions. `./errors.ts`'s `DATABASE_FAILED` keeps them apart, and there is
 * deliberately no JSONL fallback: a silent fallback to a file that stopped being written is how a register
 * becomes confidently wrong, which is the failure `../store/schema/content.ts` already names for its own
 * generated search column.
 *
 * ## Latest-per-claim is selected BEFORE the text match, and that ordering is load-bearing
 *
 * A claim's rows are its history: an older `confirmed` recording and a newer `refuted` one can both match a
 * query. Ranking the rows and then picking the best would surface the old confirmation and HIDE the
 * correction — the exact failure a verdict field exists to prevent. So the window function picks each
 * claim's latest recording first, and the search runs over that.
 *
 * The ordering inside a claim is `recorded_at DESC, seq DESC` and nothing else. `seq` is a monotonic
 * integer, so unlike every timestamp it has no precision to lose on the way out to a backup and back —
 * `../store/schema/memories.ts` carries the three review rounds that established why that matters.
 *
 * A later recording is still not automatically the truer one; it is the one the register currently
 * believes, which is a different claim and the only one this ordering supports.
 *
 * The same ordering decides retirement across claims: a claim a later recording names in `supersedes` drops
 * out of every current-belief query here ({@link NOT_RETIRED}), and nothing is deleted. The two writers that
 * rewrite a stored recording in place live in `./memoryRewriteStore.ts`, and the two that append one recording
 * or one recall, `recordMemory` and `recordRecall`, live in `./memoryRecordStore.ts`.
 */
import { and, eq, type SQL, sql } from "drizzle-orm";

import { err, ok, type Result } from "#lib/result.js";

import type { StoreClient, StoreReader, StoreWriter } from "../store/client.js";
import { type MemoryRecordingRow, memoriesTable } from "../store/schema/memories.js";
import { type MemoryRecallRow, memoryRecallsTable } from "../store/schema/memoryRecalls.js";

import type { TermCount } from "./detect/plan.js";
import { type KnowledgeError, KnowledgeErrors } from "./errors.js";
import { lessonRowOf } from "./lessonRecording.js";
import type { MemoryRecording } from "./memory.js";
import type { RecallHit, RecallPage, RecallQuery } from "./recall.js";
import { type TraceRow, traceRowOf } from "./traceRow.js";
import type { LessonRow } from "./types.js";

/**
 * What the window query returns per claim, on top of the row's own columns.
 *
 * The index signature is Drizzle's requirement for a raw `execute`, and it is the reason every column in
 * that query is aliased by hand below: `select latest.*` returns Postgres's own `recorded_at` and
 * `behaviour_change`, not the camelCase names the table's inferred type uses, so an unaliased row would
 * typecheck against this interface and hold `undefined` in every multi-word field at runtime.
 */
interface RankedRow extends MemoryRecordingRow {
  /** `ts_rank` returns `real`, which the driver gives back as a number. */
  readonly rank: number;
  /**
   * `count(*)` is a Postgres `bigint`, and the driver returns a bigint as a STRING rather than a number —
   * a value outside `Number.MAX_SAFE_INTEGER` could not survive the conversion, so it refuses to guess.
   *
   * Typed as it actually ARRIVES rather than as what a reader wants, because the version that claimed
   * `number` shipped a real defect: `hit.recordings === 1` was comparing against `"1"` and never matched,
   * so every single-recording claim rendered `· recorded 1× across 1 run(s)` — a repeat badge on a claim
   * that had never been repeated. Converted once, below, where the row is mapped.
   */
  readonly recordings: string;
  /** A `bigint` too, for the reason {@link RankedRow.recordings} gives. */
  readonly runs: string;
  /** How many times this claim has been recalled and accounted for. A `bigint`, so a string. */
  readonly recalls: string;
  /** How many of those checks found it still true. A `bigint`, so a string. */
  readonly held: string;
  /** How many found it wrong. A `bigint`, so a string. */
  readonly broke: string;
  readonly [column: string]: unknown;
}

/**
 * One row per claim that has ever been recalled: how often, how often it held, how often it broke.
 *
 * Aggregated BEFORE the join, never joined row by row — one claim has many recalls, and a plain join would
 * return the claim once per recall and count the same recording several times. Hoisted out of the statement
 * below so that statement stays readable inside the function-length cap.
 */
const ACCOUNTING_COUNTS: SQL = sql`
  select
    memory_id,
    count(*) as recalls,
    count(*) filter (where outcome = 'held') as held,
    count(*) filter (where outcome = 'broke') as broke
  from ${memoryRecallsTable}
  group by memory_id
`;

/**
 * The claim a `latest` row belongs to has NOT been retired: no recording names it in `supersedes` later, by
 * `(recorded_at, seq)`, than its own latest recording — `./supersession.ts` states the rule and applies it in
 * code for the readers that walk every row. One fragment, used by every current-belief query here, so recall
 * and the counts a recall wave is sized on cannot disagree about what is retired.
 */
export const NOT_RETIRED: SQL = sql`
  not exists (
    select 1 from ${memoriesTable} successor
    where successor.supersedes = latest.id
      and (successor.recorded_at, successor.seq) > (latest.recorded_at, latest.seq)
  )
`;

/**
 * Every column the recall page reads, aliased by hand for the reason {@link RankedRow} gives.
 *
 * Hoisted out of the statement below because it is a LIST rather than logic — the query's shape is the
 * CTEs, the join and the order, and 27 aliases in the middle of them is what pushed the function past the
 * length a reader can hold. The accounting counts are coalesced HERE, so a claim nobody has recalled reads
 * as three zeroes rather than three nulls.
 */
const SELECTED_COLUMNS: SQL = sql`
  latest.recording_id as "recordingId",
  latest.id as "id",
  latest.kind as "kind",
  latest.domain as "domain",
  latest.claim as "claim",
  latest.evidence as "evidence",
  latest.verdict as "verdict",
  latest.tier as "tier",
  latest.surface as "surface",
  latest.repro as "repro",
  latest.question as "question",
  latest.outcome as "outcome",
  latest.caveat as "caveat",
  latest.learner as "learner",
  latest.behaviour_change as "behaviourChange",
  latest.retrieval_cue as "retrievalCue",
  latest.run as "run",
  latest.recorded_at as "recordedAt",
  latest.import_key as "importKey",
  latest.supersedes as "supersedes",
  latest.searchable as "searchable",
  latest.created_at as "createdAt",
  latest.seq as "seq",
  stats.recordings as "recordings",
  stats.runs as "runs",
  coalesce(accounting.recalls, 0) as "recalls",
  coalesce(accounting.held, 0) as "held",
  coalesce(accounting.broke, 0) as "broke"
`;

/**
 * The recall query itself: latest recording per claim, then the text match over that.
 *
 * Every column is aliased by hand for the reason {@link RankedRow} gives, and the aggregate CTE is a
 * GROUP BY rather than a window because Postgres has no DISTINCT for window functions.
 *
 * @param query the validated query
 * @returns the statement, with every value bound rather than interpolated
 */
function recallStatement({ query }: { query: RecallQuery }): SQL {
  // The three optional facets are bound as NULLABLE PARAMETERS rather than assembled into an array of SQL
  // fragments, and that is not a style choice. Drizzle declares `SQLChunk = StringChunk | SQLChunk[] | …`,
  // a union containing an array of ITSELF, and the `named-object-params` gate's `typeIsCallable` walks
  // unions and array elements with no cycle guard — so one `sql.join` over an `SQL[]` in this tree ends the
  // whole gate with `RangeError: Maximum call stack size exceeded`. Measured; reproduce by
  // restoring the array form and running `yarn tsx src/cli/index.ts dev lint --only named-object-params`.
  // A null parameter reads as "no filter", which is what an absent facet means, so the SQL is honest too.
  const domain = query.domain ?? null;
  const kind = query.kind ?? null;
  const learner = query.learner ?? null;
  return sql`
      with stats as (
        -- Aggregated with GROUP BY rather than as a window: Postgres has no DISTINCT for window
        -- functions (SQLSTATE 0A000), and the runs column must count DISTINCT runs because one run recording
        -- twice is a session writing twice while two runs is two sessions learning the same thing.
        select id, count(*) as recordings, count(distinct run) as runs from ${memoriesTable} group by id
      ),
      accounting as (${ACCOUNTING_COUNTS}),
      ranked as (
        select
          m.*,
          row_number() over (partition by m.id order by m.recorded_at desc, m.seq desc) as recency
        from ${memoriesTable} m
      ),
      latest as (select * from ranked where recency = 1)
      select
        ${SELECTED_COLUMNS},
        ts_rank(latest.searchable, websearch_to_tsquery('english', ${query.query})) as rank
      from latest
        join stats on stats.id = latest.id
        left join accounting on accounting.memory_id = latest.id
      where latest.searchable @@ websearch_to_tsquery('english', ${query.query})
        and ${NOT_RETIRED}
        and (${domain}::text is null or latest.domain = ${domain})
        and (${kind}::text is null or latest.kind::text = ${kind})
        and (${learner}::text is null or latest.learner = ${learner})
      -- Retention earned by USE: a claim a session recalled and found still true outranks one nobody has
      -- ever pulled. It is an ORDERING and the WHERE above is untouched, which is the rule in one
      -- line — a memory reorders the work, it never narrows it.
      order by coalesce(accounting.held, 0) desc, rank desc, latest.recorded_at desc, latest.seq desc
      limit ${query.limit + 1} offset ${query.offset}
  `;
}

/**
 * How many claims each term reaches, and how many of those are traces — what a recall wave is sized on.
 *
 * Counted over each claim's LATEST recording, the same population recall itself returns, so a wave is never
 * sized on superseded rows. One statement per term rather than one grouped query: a term is a bound input
 * the caller typed, the list is short by construction, and the shape stays a count nobody has to unpick.
 *
 * @param client an open connection
 * @param terms the words the task names, in the caller's order
 * @returns one count per term, in that order, or the typed failure
 */
export async function countTermMatches({
  client,
  terms,
}: {
  client: StoreClient;
  terms: readonly string[];
}): Promise<Result<readonly TermCount[], KnowledgeError>> {
  const counts: TermCount[] = [];
  for (const term of terms) {
    try {
      const rows = await client.db.execute<{ total: string; traces: string }>(sql`
        with ranked as (
          select m.*, row_number() over (partition by m.id order by m.recorded_at desc, m.seq desc) as recency
          from ${memoriesTable} m
        ),
        latest as (select * from ranked where recency = 1)
        select
          count(*) as total,
          count(*) filter (where latest.kind::text = 'trace') as traces
        from latest
        where latest.searchable @@ websearch_to_tsquery('english', ${term})
          and ${NOT_RETIRED}
      `);
      const row = [...rows][0];
      if (row === undefined) {
        return err(
          KnowledgeErrors.databaseFailed({ cause: "count returned no row", doing: `count matches for ${term}` }),
        );
      }
      counts.push({ term, total: Number(row.total), traces: Number(row.traces) });
    } catch (cause) {
      return err(KnowledgeErrors.databaseFailed({ cause, doing: `count matches for ${term}` }));
    }
  }
  return ok(counts);
}

/**
 * Recall the claims whose text matches a query, most relevant first.
 *
 * One extra row past the limit is fetched and then dropped, so `hasMore` is an observation rather than a
 * guess — a count query would be a second round trip that can disagree with the first.
 *
 * @param client an open connection
 * @param query the validated query
 * @returns one page, or the typed failure
 */
export async function recallMemories({
  client,
  query,
}: {
  client: StoreClient;
  query: RecallQuery;
}): Promise<Result<RecallPage, KnowledgeError>> {
  try {
    const rows = await client.db.execute<RankedRow>(recallStatement({ query }));
    const all = [...rows];
    const hasMore = all.length > query.limit;
    const hits: readonly RecallHit[] = all.slice(0, query.limit).map((row) => ({
      broke: Number(row.broke),
      held: Number(row.held),
      rank: row.rank,
      recalls: Number(row.recalls),
      recordings: Number(row.recordings),
      // A raw `execute` bypasses Drizzle's `mode: "date"` column mapping, so the two timestamps arrive as
      // whatever the driver produced rather than as `Date`. Coerced here rather than at each reader,
      // because the interface above promises `MemoryRecordingRow` and a reader calling `.toISOString()`
      // on a string is a runtime failure the types cannot see.
      row: { ...row, createdAt: new Date(row.createdAt), recordedAt: new Date(row.recordedAt) },
      runs: Number(row.runs),
    }));
    return ok({ hasMore, hits, query });
  } catch (cause) {
    return err(KnowledgeErrors.databaseFailed({ cause, doing: "recall from the memories table" }));
  }
}

/**
 * Every accounting row the ledger holds, oldest first — the export path for the recall ledger.
 *
 * Its own reader rather than a join onto the memories export, because a backup that carried the register
 * and dropped the accounting would delete by recovery the one column ranking depends on.
 *
 * @param client an open connection
 * @returns every recall, or the typed failure
 */
export async function readAllRecalls({
  client,
}: {
  client: StoreReader;
}): Promise<Result<readonly MemoryRecallRow[], KnowledgeError>> {
  try {
    const rows = await client.db.select().from(memoryRecallsTable).orderBy(memoryRecallsTable.seq);
    return ok(rows);
  } catch (cause) {
    return err(KnowledgeErrors.databaseFailed({ cause, doing: "export every recall" }));
  }
}

/**
 * Insert many recordings in ONE transaction — the `import-lessons` path. A restore has its own writer,
 * `./memoryRestoreStore.ts`, because it owns both tables in one transaction.
 *
 * All or nothing: a partial import leaves a register nobody can reason about, and the `import_key` unique
 * index means a retry after a partial write would silently skip whatever had landed.
 *
 * @param client an open connection
 * @param rows every recording to write, each carrying its `importKey`
 * @returns how many rows were written, or the typed failure
 */
export async function importMemories({
  client,
  rows,
}: {
  client: StoreClient;
  rows: readonly MemoryRecording[];
}): Promise<Result<number, KnowledgeError>> {
  if (rows.length === 0) {
    return ok(0);
  }
  try {
    const written = await client.db.transaction(async (writer): Promise<number> => {
      const inserted = await writer
        .insert(memoriesTable)
        .values([...rows])
        .returning({ id: memoriesTable.recordingId });
      await advanceSeq({ tx: writer });
      return inserted.length;
    });
    return ok(written);
  } catch (cause) {
    return err(KnowledgeErrors.databaseFailed({ cause, doing: `import ${String(rows.length)} recording(s)` }));
  }
}

/**
 * Advance the `seq` sequence past the highest value a restore just wrote.
 *
 * A restore inserts explicit `seq` values, which does NOT move the sequence — so without this the next
 * ordinary write would collide with a restored row on `uq_memories_seq`. Run inside the restore's own
 * transaction, though Postgres never rolls a `setval` back: a failure after it leaves no row written and the
 * sequence advanced, which costs a gap in `seq` and never a collision.
 *
 * @param tx the open transaction
 * @returns nothing
 */
async function advanceSeq({ tx }: { tx: StoreWriter }): Promise<void> {
  await tx.execute(sql`select setval(pg_get_serial_sequence('memories', 'seq'), coalesce(max(seq), 1)) from memories`);
}

/**
 * Every recording the table holds, oldest first — the export path, and the recovery leg.
 *
 * Streaming is deliberately NOT used here: an export is a whole-table read by definition, and the caller
 * writes it a row at a time through `writeFileAtomicStream` rather than assembling one string.
 *
 * @param client an open connection
 * @returns every recording, or the typed failure
 */
export async function readAllMemories({
  client,
}: {
  client: StoreReader;
}): Promise<Result<readonly MemoryRecordingRow[], KnowledgeError>> {
  try {
    const rows = await client.db
      .select()
      .from(memoriesTable)
      .orderBy(memoriesTable.recordedAt, memoriesTable.recordingId);
    return ok(rows);
  } catch (cause) {
    return err(KnowledgeErrors.databaseFailed({ cause, doing: "export every recording" }));
  }
}

/**
 * Which of a set of import keys the table already holds.
 *
 * Asked BEFORE an import so a re-run reports "already applied" rather than failing on a unique-index
 * violation halfway through — the difference between an idempotent retry and an aborted one.
 *
 * @param client an open connection
 * @param keys the import keys about to be written
 * @returns the subset already present, or the typed failure
 */
export async function existingImportKeys({
  client,
  keys,
}: {
  client: StoreClient;
  keys: readonly string[];
}): Promise<Result<ReadonlySet<string>, KnowledgeError>> {
  if (keys.length === 0) {
    return ok(new Set());
  }
  try {
    const rows = await client.db.execute<{ import_key: string }>(
      sql`select import_key from ${memoriesTable} where import_key = any(${sql.param([...keys])})`,
    );
    return ok(new Set([...rows].map((row) => row.import_key)));
  } catch (cause) {
    return err(KnowledgeErrors.databaseFailed({ cause, doing: "check which import keys are already present" }));
  }
}

/**
 * Every `lesson` recording, as the {@link LessonRow} the pure readers were written against — oldest first.
 *
 * This is the read behind the settle gate, `knowledge list` and the quiz, now that the register lives
 * in the table. `kind = 'lesson'` is applied HERE, in the query, so a preference can never
 * be counted as a measured lesson by any caller — the brief's one hard line on the read side. `run` narrows
 * the read to one board row for the gate, which asks only about itself; `list` and the quiz read the whole
 * register, as they read the whole file.
 *
 * A database failure is the typed refusal, never an empty list, for the reason the file overview gives —
 * and for the gate it is the reason the brief states outright: a store outage fails a settle loudly.
 *
 * @param client an open connection
 * @param run keep only rows recorded on this board row, when given
 * @returns every matching lesson in recorded order, or the typed failure
 */
export async function readLessonRows({
  client,
  run,
}: {
  client: StoreClient;
  run?: string | undefined;
}): Promise<Result<readonly LessonRow[], KnowledgeError>> {
  const kindIsLesson = eq(memoriesTable.kind, "lesson");
  const where = run === undefined ? kindIsLesson : and(kindIsLesson, eq(memoriesTable.run, run));
  let recordings: readonly MemoryRecordingRow[];
  try {
    recordings = await client.db
      .select()
      .from(memoriesTable)
      .where(where)
      .orderBy(memoriesTable.recordedAt, memoriesTable.seq);
  } catch (cause) {
    return err(KnowledgeErrors.databaseFailed({ cause, doing: "read the lessons in the memories table" }));
  }
  const rows: LessonRow[] = [];
  for (const recording of recordings) {
    const row = lessonRowOf({ recording });
    if (row.isErr()) {
      return err(row.error);
    }
    rows.push(row.value);
  }
  return ok(rows);
}

/**
 * Every `trace` recording, as the {@link TraceRow} the pure readers were written against — oldest first.
 *
 * `kind = 'trace'` is applied HERE, in the query, for the reason {@link readLessonRows} applies its own
 * filter there: a caller cannot then count a lesson as a trace, whatever it does with the rows. The quiz is
 * the reader this exists for — it is pointed at traces.
 *
 * @param client an open connection
 * @returns every trace in recorded order, or the typed failure
 */
export async function readTraceRows({
  client,
}: {
  client: StoreClient;
}): Promise<Result<readonly TraceRow[], KnowledgeError>> {
  let recordings: readonly MemoryRecordingRow[];
  try {
    recordings = await client.db
      .select()
      .from(memoriesTable)
      .where(eq(memoriesTable.kind, "trace"))
      .orderBy(memoriesTable.recordedAt, memoriesTable.seq);
  } catch (cause) {
    return err(KnowledgeErrors.databaseFailed({ cause, doing: "read the traces in the memories table" }));
  }
  const rows: TraceRow[] = [];
  for (const recording of recordings) {
    const row = traceRowOf({ recording });
    if (row.isErr()) {
      return err(row.error);
    }
    rows.push(row.value);
  }
  return ok(rows);
}
