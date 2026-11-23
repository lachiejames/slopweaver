/**
 * The store side of the denylist: what the detector needs to count, and what a purge deletes.
 *
 * ## Why the purge lives here and not in the policy module
 *
 * {@link ../corpus/syncExclusion} is pure and says what a record's verdict IS. Removing a million rows that
 * a previous version of that policy already let in is a different job with different risks, and it is the
 * one the owner asked for by name — the store held about a million `#monitor-feed` rows that entered six days
 * after the policy ruled they should not.
 *
 * ## Every count is computed IN Postgres
 *
 * None of these functions reads a body into JavaScript. A purge over half of a two-million-row store that
 * materialised its candidates in the heap would be the whole-file-string class this repo already has a gate
 * for. The candidate set is a subquery; the delete is one statement; the counts are three `count(*)`s.
 *
 * ## Rule D reaches the purge, and what it cost while it did not
 *
 * A purge that deleted a denied alert a human had replied under left the reply in the store with no parent,
 * which is the exact orphan {@link ../corpus/syncExclusion}'s rule D exists to prevent. It is not
 * hypothetical: an apply that deletes every existing such record
 * retroactively while rule D is deferred orphaned **nearly all of the over a thousand human
 * replies in `#monitor-feed`** — production incidents diagnosed over more than a year. Repro:
 *
 * ```sql
 * select count(*) from content_slack cs
 * where cs.channel_name = '#monitor-feed' and not cs.is_bot and cs.thread_ts is not null
 *   and not exists (select 1 from content_slack r
 *                   where r.channel_id = cs.channel_id and r.message_ts = cs.thread_ts);
 * ```
 *
 * So rule D is honoured here by default, and the delete-everything shape is the `--delete-human-threads` flag — kept
 * reachable because it is what actually ran against this install and an operator must be able to reproduce
 * it. Honouring it is cheap: measured over the fourteen pairs the detector proposes, **92** of
 * 59,274 candidate rows are rescued, and those 92 carry 85 threads holding 239 human messages.
 *
 * ## What makes the deletion reversible, stated rather than assumed
 *
 * Bronze is the durable capture and nothing here touches it, so re-ingesting a bronze file with the
 * corresponding denylist line removed restores what a purge deleted. That is the reason the refusal text
 * says so. What it does NOT restore by itself is anything derived from those rows, and a row whose bronze
 * file has since been compacted away is not recoverable at all — so the preview reports how many candidates
 * it could NOT match to an identity the store records, rather than claiming a blanket guarantee.
 *
 * ## The one identity a purge cannot act on
 *
 * A denylist entry may name a USER id. `content_slack` records `app_id`, `bot_id`, `channel_id` and
 * `channel_name`, and a user reaches the store only as a `person` row that identity reconciliation may have
 * MERGED with other handles. Deleting by membership in a merged person's identity set would delete rows a
 * different identity wrote, so this module does not do it: an entry naming only a user id is counted and
 * reported as unresolved. It still works at ingest, where the raw payload is present.
 */

import { sql } from "drizzle-orm";

import type { SyncExclusion } from "../corpus/syncExclusion.js";
import type { AppChannelCount } from "../corpus/syncExclusionDetector.js";
import { err, ok, type Result } from "../lib/result.js";

import type { StoreClient } from "./client.js";
import { type StoreError, StoreErrors } from "./errors.js";

/** What a purge would do, or did. */
export interface PurgeReport {
  /** Rows in `content` before anything was deleted. */
  readonly before: number;
  /** Rows the policy selects — what a `--apply` would delete. */
  readonly candidates: number;
  /**
   * Denied rows a human replied under.
   *
   * The same population either way, so the number a preview shows never depends on the mode: it is the
   * rule-D subset of the scope. {@link keptHumanThreads} is what says whether they were kept OUT of
   * {@link candidates} or counted into it.
   */
  readonly retainedByRuleD: number;
  /** Whether rule D was honoured — false is the delete-everything shape, which deletes those rows too. */
  readonly keptHumanThreads: boolean;
  /** Rows actually deleted; zero on a preview. */
  readonly deleted: number;
  /** Rows in `content` afterwards. Equal to {@link before} on a preview. */
  readonly after: number;
  /** Denylist ids that name no column this store records — user ids, which only ingest can act on. */
  readonly unresolvedIds: readonly string[];
  /** Whether this report describes a deletion or a preview of one. */
  readonly applied: boolean;
}

/**
 * Count every `(app, channel)` pair the store holds, with the channel's own total beside it.
 *
 * The denominator is EVERY row in the channel — human, bot and app alike — because the detector's question
 * is "is this channel just one robot talking", and excluding the humans from the denominator would answer
 * a different and much more flattering question.
 *
 * @param client the open store
 * @returns one row per pair, unfiltered; {@link ../corpus/syncExclusionDetector.proposeSyncExclusions}
 *   decides which of them qualify
 */
export async function readAppChannelCounts({
  client,
}: {
  client: StoreClient;
}): Promise<Result<readonly AppChannelCount[], StoreError>> {
  try {
    const rows = await client.db.execute(sql`
      with channel_total as (
        select channel_id, count(*) as rows from content_slack group by channel_id
      )
      select s.app_id as app_id,
             s.channel_id as channel_id,
             max(s.channel_name) as channel_name,
             count(*) as app_rows,
             max(t.rows) as channel_rows
      from content_slack s
      join channel_total t on t.channel_id = s.channel_id
      where s.app_id is not null and s.is_bot
      group by s.app_id, s.channel_id
    `);
    return ok(rows.map((row) => appChannelCountFrom({ row })));
  } catch (error: unknown) {
    return err(StoreErrors.queryFailed({ cause: error, what: "store app/channel census" }));
  }
}

/**
 * Rule D as ONE sql fragment, over a `content_slack` row aliased `c`.
 *
 * A single exported-within-module constant rather than the same `exists` written at the count and again at
 * the delete, because those two are only trustworthy while they name the identical population, and two
 * copies of a predicate is how they stop doing so. Everything else in this module is arranged around that
 * invariant; this is the line that actually holds it.
 *
 * The thread key is `coalesce(thread_ts, message_ts)` so a denied alert that STARTED the thread is rescued
 * by the replies beneath it even in the moment before Slack has stamped its own `ts` into `thread_ts`.
 */
const RULE_D_RESCUED = sql`exists (
  select 1 from content_slack h
  where h.channel_id = c.channel_id
    and h.thread_ts is not null
    and h.thread_ts = coalesce(c.thread_ts, c.message_ts)
    and not h.is_bot
)`;

/**
 * How many rows a delete would take, and how many of the scope a human replied under.
 *
 * Both numbers come out of ONE statement over the same subquery, so the total a preview reports and the
 * rule-D figure beside it can never describe two different populations. Which of them the candidate count
 * INCLUDES is the only thing the mode changes.
 *
 * @param client the open store
 * @param selection the `where` fragment naming every row the denylist covers
 * @param keepHumanThreads whether rule D is honoured, which decides if its rows are candidates at all
 * @returns the rows a delete would take, and the rule-D subset of the scope
 */
async function countCandidates({
  client,
  selection,
  keepHumanThreads,
}: {
  client: StoreClient;
  selection: ReturnType<typeof sql>;
  keepHumanThreads: boolean;
}): Promise<{ candidates: number; retained: number }> {
  const counted = await client.db.execute(sql`
    select count(*) filter (where not rescued) as plain,
           count(*) filter (where rescued) as retained
    from (
      select ${RULE_D_RESCUED} as rescued
      from content_slack c
      where ${selection}
    ) judged
  `);
  const retained = numberFrom({ value: counted[0]?.["retained"] });
  const plain = numberFrom({ value: counted[0]?.["plain"] });
  // The candidate count is what the DELETE will take, and nothing else. With rule D honoured that is the
  // scope MINUS its rescued rows; with the delete-everything flag it is the whole scope. Reporting one number and then
  // deleting a different one is exactly the shape where an operator approves a figure that was never what
  // would happen, which is why the mode is a parameter here rather than a subtraction at the call site.
  if (keepHumanThreads) {
    return { candidates: plain, retained };
  }
  return { candidates: plain + retained, retained };
}

/**
 * Preview or perform the purge of everything the denylist covers.
 *
 * `apply` is a parameter rather than two functions because the candidate selection MUST be the same
 * expression in both: a preview computed one way and a delete computed another is how an operator ends up
 * approving a number that was never what would happen.
 *
 * The delete is against `content`, never `content_slack`. Every source row and every vector cascades from
 * that parent, and deleting the side row alone would leave a `content` row the store's own invariant says
 * cannot exist.
 *
 * @param client the open store
 * @param exclusion the resolved denylist
 * @param apply false to count only, true to delete
 * @param keepHumanThreads false to take the rule-D rows as well, which is the delete-everything shape
 * @returns what the policy selects and, when applied, what went
 */
export async function purgeExcludedContent({
  client,
  exclusion,
  apply,
  keepHumanThreads,
}: {
  client: StoreClient;
  exclusion: SyncExclusion;
  apply: boolean;
  keepHumanThreads: boolean;
}): Promise<Result<PurgeReport, StoreError>> {
  const selection = candidateSelection({ exclusion });
  try {
    // Counted BEFORE the empty-list branch, because an install whose denylist names nothing this store
    // records is still owed the size of the store it is asking about. Reporting `before: 0` there made the
    // verb print "store holds 0 row(s)" over a million of them — a line an operator would read as an empty
    // database rather than as an empty list.
    const before = await countContentRows({ client });
    const shared = { before, exclusion, keepHumanThreads };
    if (selection === null) {
      return ok(reportOf({ ...shared, after: before, applied: apply, candidates: 0, retained: 0 }));
    }
    const { candidates, retained } = await countCandidates({ client, keepHumanThreads, selection });
    if (!apply) {
      return ok(reportOf({ ...shared, after: before, applied: false, candidates, retained }));
    }
    await client.db.execute(sql`
      delete from content where id in (
        select c.content_id from content_slack c where ${deleteSelection({ keepHumanThreads, selection })}
      )
    `);
    const after = await countContentRows({ client });
    return ok(reportOf({ ...shared, after, applied: true, candidates, retained }));
  } catch (error: unknown) {
    return err(StoreErrors.queryFailed({ cause: error, what: "store exclusion purge" }));
  }
}

/**
 * Assemble one report from the numbers the three exits each hold.
 *
 * `deleted` is derived from `before - after` rather than taken, because those are the two counts the
 * operator is shown and a third number computed some other way could disagree with the subtraction they
 * can do themselves.
 *
 * @param retained the rule-D subset of the scope, whichever side of the delete it fell
 * @param keepHumanThreads whether rule D was honoured, which is what makes `retained` readable
 * @returns the report the verb renders
 */
function reportOf({
  before,
  after,
  applied,
  candidates,
  retained,
  exclusion,
  keepHumanThreads,
}: {
  before: number;
  after: number;
  applied: boolean;
  candidates: number;
  retained: number;
  exclusion: SyncExclusion;
  keepHumanThreads: boolean;
}): PurgeReport {
  return {
    after,
    applied,
    before,
    candidates,
    deleted: before - after,
    keptHumanThreads: keepHumanThreads,
    retainedByRuleD: retained,
    unresolvedIds: unresolvedIdsIn({ exclusion }),
  };
}

/**
 * The rows the DELETE takes — the scope, less what rule D keeps.
 *
 * The subtraction is spelled here and nowhere else, and it is the same {@link RULE_D_RESCUED} fragment
 * {@link countCandidates} filtered on, so the preview's number and the delete's reach are one expression
 * evaluated twice rather than two expressions that agree today.
 *
 * With rule D off this is the scope itself: every existing such record is deleted retroactively. That is
 * what ran against this install, so it stays reachable rather than becoming a shape nobody can reproduce.
 *
 * @param selection the `where` fragment naming every row the denylist covers
 * @param keepHumanThreads whether rule D is honoured
 * @returns the fragment the delete selects on
 */
function deleteSelection({
  selection,
  keepHumanThreads,
}: {
  selection: ReturnType<typeof sql>;
  keepHumanThreads: boolean;
}): ReturnType<typeof sql> {
  if (!keepHumanThreads) {
    return selection;
  }
  return sql`(${selection}) and not ${RULE_D_RESCUED}`;
}

/**
 * The `where` fragment selecting every row the denylist covers, or null when it covers nothing here.
 *
 * Null rather than a fragment that matches nothing, because `where false` and "this list is empty" read the
 * same in a report and mean very different things to the person reading it.
 *
 * @param exclusion the resolved denylist
 * @returns the fragment, or null when no entry names a column this store records
 */
function candidateSelection({ exclusion }: { exclusion: SyncExclusion }): ReturnType<typeof sql> | null {
  const terms: ReturnType<typeof sql>[] = [];
  const globals = [...exclusion.ids];
  if (globals.length > 0) {
    terms.push(sql`(lower(c.app_id) in ${globals} or lower(c.bot_id) in ${globals})`);
  }
  exclusion.scoped.forEach((rule) => {
    const channel =
      rule.scope.kind === "channel-name"
        ? sql`lower(c.channel_name) = ${rule.scope.value}`
        : sql`lower(c.channel_id) = ${rule.scope.value}`;
    terms.push(sql`((lower(c.app_id) = ${rule.id} or lower(c.bot_id) = ${rule.id}) and ${channel})`);
  });
  if (terms.length === 0) {
    return null;
  }
  return sql.join(terms, sql` or `);
}

/**
 * Which denylist ids name nothing this store can act on.
 *
 * An id is resolvable here when `content_slack` could carry it as an `app_id` or a `bot_id`. Slack stamps
 * an app id `A…` and a bot id `B…`; a `U…` is a user, which reaches the store only through a person row
 * that may have been merged with other handles. Reporting those rather than guessing at them is the point.
 *
 * @param exclusion the resolved denylist
 * @returns every id a purge cannot act on, in the order the list wrote them
 */
function unresolvedIdsIn({ exclusion }: { exclusion: SyncExclusion }): readonly string[] {
  const named = [...exclusion.ids, ...exclusion.scoped.map((rule) => rule.id)];
  return named.filter((id) => !id.startsWith("a") && !id.startsWith("b"));
}

/**
 * How many rows `content` holds right now.
 *
 * @param client the open store
 * @returns the row count
 */
async function countContentRows({ client }: { client: StoreClient }): Promise<number> {
  const rows = await client.db.execute(sql`select count(*) as rows from content`);
  return numberFrom({ value: rows[0]?.["rows"] });
}

/**
 * Read one aggregate cell as a number.
 *
 * Postgres returns `count(*)` as a bigint, which the driver hands back as a string once it passes
 * 2^31 — and this store is already past two million rows, so the string case is the normal one rather than
 * an edge.
 *
 * @param value the cell, as the driver returned it
 * @returns the count, or zero when the cell is absent
 */
function numberFrom({ value }: { value: unknown }): number {
  if (typeof value === "number") {
    return value;
  }
  if (typeof value === "string") {
    return Number.parseInt(value, 10);
  }
  return 0;
}

/**
 * Read one census row into the detector's own shape.
 *
 * @param row the row as the driver returned it
 * @returns the typed pair count
 */
function appChannelCountFrom({ row }: { row: Record<string, unknown> }): AppChannelCount {
  const channelName = row["channel_name"];
  return {
    appId: textFrom({ value: row["app_id"] }),
    appRows: numberFrom({ value: row["app_rows"] }),
    channelId: textFrom({ value: row["channel_id"] }),
    channelName: typeof channelName === "string" ? channelName : null,
    channelRows: numberFrom({ value: row["channel_rows"] }),
  };
}

/**
 * Read one cell as a string, treating anything that is not one as absent.
 *
 * The driver hands a column back as `unknown`, so coercing with `String()` would render an unexpected
 * object as `[object Object]` and put that in a denylist line an operator is being asked to paste.
 *
 * @param value the cell, as the driver returned it
 * @returns the text, or an empty string when the cell is not text
 */
function textFrom({ value }: { value: unknown }): string {
  return typeof value === "string" ? value : "";
}
