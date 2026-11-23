/**
 * The newest current claims a full-text query matches, with the EXACT number that match — what the console voice's
 * `talk recall` reads from the knowledge register beside the owner's own words.
 *
 * `./memoryStore.ts`'s `recallMemories` answers a different question: the most RELEVANT page, ordered by use and
 * rank, with `hasMore` observed from one extra row. A recall answer leads with each source's count and then its
 * newest hits, so this is its own statement rather than a reading of that page: the population is the same — each
 * claim's latest recording, retired claims out ({@link NOT_RETIRED}) — and `count(*) over ()` is computed over it
 * before the limit applies, so the count is exact in the same round trip that returns the page.
 */
import { sql } from "drizzle-orm";

import { err, ok, type Result } from "../lib/result.js";
import type { StoreClient } from "../store/client.js";
import { memoriesTable } from "../store/schema/memories.js";

import { type KnowledgeError, KnowledgeErrors } from "./errors.js";
import { NOT_RETIRED } from "./memoryStore.js";

/**
 * One matching claim, as the recall answer carries it.
 *
 * @internal
 */
export interface NewestMemory {
  readonly id: string;
  readonly claim: string;
  readonly domain: string;
  readonly verdict: string;
  readonly recordedAtIso: string;
}

/** The newest page and how many matched in all. */
export interface NewestMemories {
  readonly total: number;
  readonly memories: readonly NewestMemory[];
}

/**
 * The raw row. Every column is aliased by hand, and `count(*)` is a Postgres `bigint` the driver returns as a
 * string — both for the reasons `./memoryStore.ts`'s `RankedRow` gives.
 */
interface NewestRow {
  readonly id: string;
  readonly claim: string;
  readonly domain: string;
  readonly verdict: string;
  readonly recordedAt: string | Date;
  readonly total: string;
  readonly [column: string]: unknown;
}

/**
 * The newest current claims matching a query, and how many match in all.
 *
 * @param client an open connection
 * @param query the words, read by `websearch_to_tsquery` — every word required
 * @param sinceIso the floor on a claim's latest recording, or `null` for all time
 * @param limit the most claims to return
 * @returns the page and the exact total, or the typed failure
 */
export async function newestMemoriesMatching({
  client,
  query,
  sinceIso,
  limit,
}: {
  client: StoreClient;
  query: string;
  sinceIso: string | null;
  limit: number;
}): Promise<Result<NewestMemories, KnowledgeError>> {
  try {
    const rows = await client.db.execute<NewestRow>(sql`
      with ranked as (
        select m.*, row_number() over (partition by m.id order by m.recorded_at desc, m.seq desc) as recency
        from ${memoriesTable} m
      ),
      latest as (select * from ranked where recency = 1)
      select
        latest.id as "id",
        latest.claim as "claim",
        latest.domain as "domain",
        latest.verdict as "verdict",
        latest.recorded_at as "recordedAt",
        count(*) over () as "total"
      from latest
      where latest.searchable @@ websearch_to_tsquery('english', ${query})
        and ${NOT_RETIRED}
        and (${sinceIso}::timestamptz is null or latest.recorded_at >= ${sinceIso}::timestamptz)
      order by latest.recorded_at desc, latest.seq desc
      limit ${limit}
    `);
    const all = [...rows];
    const first = all[0];
    return ok({
      memories: all.map((row) => ({
        claim: row.claim,
        domain: row.domain,
        id: row.id,
        // A raw `execute` bypasses Drizzle's date mapping, so the timestamp arrives as the driver produced it.
        recordedAtIso: new Date(row.recordedAt).toISOString(),
        verdict: row.verdict,
      })),
      total: first === undefined ? 0 : Number(first.total),
    });
  } catch (cause) {
    return err(KnowledgeErrors.databaseFailed({ cause, doing: "read the newest matching claims" }));
  }
}
