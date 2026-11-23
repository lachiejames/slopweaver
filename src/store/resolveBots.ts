/**
 * The pass that fills `content.author_is_bot` for rows ingested before the column existed.
 *
 * ## Why this is a pass and not part of the migration
 *
 * The migration that added the column is one `ADD COLUMN … DEFAULT false NOT NULL`, a catalog change that
 * finishes instantly on a table of any size. Writing the flag onto every Slack row an integration posted is
 * a data pass over the whole table, and `./resolveEdges.ts` already states why that never rides inside
 * `store push`: every future push on every checkout would pay for it, and a push that half-applied would
 * leave a database nobody could classify. New rows never need this — the projection writes the flag on
 * ingest — so this exists for the rows already stored, and for a rule change.
 *
 * ## The derivation is NOT repeated here
 *
 * Every flag comes from {@link ./botAuthor.authorIsBot}, the same pure function the projection calls. What
 * this module adds is only the read: the keys that rule looks at ({@link ./botAuthor.BOT_PAYLOAD_KEYS}),
 * picked back out of each side table's `raw` envelope, which holds the provider payload verbatim. So the
 * bag handed to the rule here is the projection's bag cut down to the fields it reads — never a second
 * expression of the rule in SQL.
 *
 * ## Idempotent in both directions
 *
 * It walks `content` in primary-key order and writes only the rows whose derived flag differs from the
 * stored one, `true` to `false` included: the flag is a function of stored evidence, so a rule that
 * narrows has to be able to clear what an older rule set. An interrupted run is finished by running it
 * again, and a second complete run writes nothing.
 */
import { type SQL, sql } from "drizzle-orm";

import { isRecord } from "../lib/parsers.js";
import { err, ok, type Result } from "../lib/result.js";

import { authorIsBot, BOT_PAYLOAD_KEYS } from "./botAuthor.js";
import type { StoreClient } from "./client.js";
import { type StoreError, StoreErrors } from "./errors.js";

/**
 * How many rows one read takes and one write-back may carry.
 *
 * The write-back binds two parameters per row, so 1,000 rows stays far inside Postgres's 65,535; the read
 * is a primary-key-ordered seek, so the number trades round trips against heap and nothing else — the same
 * sizing `./resolveEdges.ts` measured.
 */
const BOT_BATCH_ROWS = 1000;

/** What one bot pass did, and what the store holds after it. */
export interface BotReport {
  /** Rows read — the whole table, every run. */
  readonly rowsScanned: number;
  /** Rows this pass flipped to `true`. */
  readonly flagged: number;
  /** Rows this pass flipped back to `false`, because the rule no longer calls their author a bot. */
  readonly cleared: number;
  /** Rows flagged at the end of the pass, per source, largest first. */
  readonly bySource: readonly { readonly source: string; readonly rows: number }[];
}

/** One row as the pass reads it: what {@link authorIsBot} needs, and the flag already stored. */
export interface BotCandidate {
  readonly id: string;
  readonly source: string;
  readonly authorNativeId: string | null;
  readonly payload: Readonly<Record<string, unknown>> | undefined;
  readonly stored: boolean;
}

/**
 * The `jsonb_build_object` picking one source's rule keys back out of its side table's `raw` envelope.
 *
 * @param raw the side table's `raw` column, already qualified by its join alias
 * @param keys the payload keys {@link BOT_PAYLOAD_KEYS} names for that source
 * @returns the expression; every value is `null` when the row has no side row of that source
 */
function payloadSubset({ raw, keys }: { raw: SQL; keys: readonly string[] }): SQL {
  const pairs = keys.map((key) => sql`${key}::text, ${raw} -> ${key}::text`);
  return sql`jsonb_build_object(${sql.join(pairs, sql`, `)})`;
}

/**
 * The payload subset for whichever source this row belongs to.
 *
 * @param source the row's source
 * @param row the database row, carrying one subset column per source with a side table
 * @returns the bag to hand the rule, or nothing for a source the rule reads no payload for
 */
function payloadFor({
  source,
  row,
}: {
  source: string;
  row: Readonly<Record<string, unknown>>;
}): Readonly<Record<string, unknown>> | undefined {
  const value = row[source];
  return isRecord(value) ? value : undefined;
}

/**
 * Read one primary-key-ordered page of rows to derive flags for.
 *
 * @param client the open store
 * @param after the last id of the previous page, or `null` to start at the beginning
 * @param batch how many rows to read
 * @returns the page, in id order
 */
async function readCandidates({
  client,
  after,
  batch,
}: {
  client: StoreClient;
  after: string | null;
  batch: number;
}): Promise<readonly BotCandidate[]> {
  const cursor = after === null ? sql`true` : sql`c.id > ${after}::uuid`;
  const rows = await client.db.execute(sql`
    select c.id::text as id,
           c.source::text as source,
           c.author_native_id as "authorNativeId",
           c.author_is_bot as stored,
           ${payloadSubset({ keys: BOT_PAYLOAD_KEYS.slack, raw: sql`s.raw` })} as slack,
           ${payloadSubset({ keys: BOT_PAYLOAD_KEYS.github, raw: sql`g.raw` })} as github,
           ${payloadSubset({ keys: BOT_PAYLOAD_KEYS.linear, raw: sql`l.raw` })} as linear
    from content c
    left join content_slack s on s.content_id = c.id
    left join content_github g on g.content_id = c.id
    left join content_linear l on l.content_id = c.id
    where ${cursor}
    order by c.id
    limit ${batch}
  `);
  return [...rows].map((row): BotCandidate => {
    const source = String(row["source"]);
    return {
      authorNativeId: typeof row["authorNativeId"] === "string" ? row["authorNativeId"] : null,
      id: String(row["id"]),
      payload: payloadFor({ row, source }),
      source,
      stored: row["stored"] === true,
    };
  });
}

/**
 * The rows of one page whose derived flag is not the flag already stored.
 *
 * Pure and exported so the one decision this pass makes beyond the rule itself — write only what differs,
 * in both directions — is checkable without a database.
 *
 * @param page one primary-key-ordered read
 * @returns the id and derived flag of every row that needs writing, in page order
 */
export function botPageWrites({
  page,
}: {
  page: readonly BotCandidate[];
}): readonly { readonly id: string; readonly flag: boolean }[] {
  const writes: { id: string; flag: boolean }[] = [];
  for (const row of page) {
    const derived = authorIsBot({ authorNativeId: row.authorNativeId, raw: row.payload, source: row.source });
    if (derived !== row.stored) {
      writes.push({ flag: derived, id: row.id });
    }
  }
  return writes;
}

/**
 * Write one page's derived flags back, in a single statement.
 *
 * @param client the open store
 * @param writes the id and derived flag of every row whose stored flag was wrong
 */
async function writeFlags({
  client,
  writes,
}: {
  client: StoreClient;
  writes: readonly { readonly id: string; readonly flag: boolean }[];
}): Promise<void> {
  const tuples = writes.map((write) => sql`(${write.id}::uuid, ${write.flag}::boolean)`);
  await client.db.execute(sql`
    update content set author_is_bot = v.flag
    from (values ${sql.join(tuples, sql`, `)}) as v(id, flag)
    where content.id = v.id
  `);
}

/**
 * Count the flagged rows per source once the pass has run.
 *
 * @param client the open store
 * @returns the per-source totals, largest first
 */
async function countFlagged({
  client,
}: {
  client: StoreClient;
}): Promise<readonly { readonly source: string; readonly rows: number }[]> {
  const rows = await client.db.execute(sql`
    select source::text as source, count(*)::int as rows
    from content where author_is_bot
    group by source order by 2 desc
  `);
  return [...rows].map((row) => ({ rows: Number(row["rows"]), source: String(row["source"]) }));
}

/**
 * Derive `content.author_is_bot` for every row in the store, writing only what is wrong.
 *
 * @param client the open store
 * @param batch how many rows per page
 * @returns what the pass did and what the store now holds, or the store's own typed failure
 */
export async function resolveBots({
  client,
  batch = BOT_BATCH_ROWS,
}: {
  client: StoreClient;
  batch?: number;
}): Promise<Result<BotReport, StoreError>> {
  let after: string | null = null;
  let rowsScanned = 0;
  let flagged = 0;
  let cleared = 0;
  try {
    for (;;) {
      const page: readonly BotCandidate[] = await readCandidates({ after, batch, client });
      const last = page.at(-1);
      if (last === undefined) {
        break;
      }
      rowsScanned += page.length;
      const writes = botPageWrites({ page });
      if (writes.length > 0) {
        await writeFlags({ client, writes });
        flagged += writes.filter((write) => write.flag).length;
        cleared += writes.filter((write) => !write.flag).length;
      }
      after = last.id;
    }
    return ok({ bySource: await countFlagged({ client }), cleared, flagged, rowsScanned });
  } catch (error: unknown) {
    return err(StoreErrors.queryFailed({ cause: error, what: "store bots" }));
  }
}
