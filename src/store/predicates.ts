/**
 * The pure half of the typed query layer: a validated query in, Drizzle `SQL` out, no connection anywhere.
 *
 * {@link ./client} opens the store and runs the statements; this builds the WHERE and the GROUP BY they carry.
 * Nothing here interpolates what a caller typed, and every filter maps onto an index the migration creates.
 */
import { and, eq, gte, inArray, lte, type SQL, sql } from "drizzle-orm";

import type { PersonMatch } from "./personMatch.js";
import { escapeLike } from "./probe/shapes.js";
import { FILTER_SOURCES, isSourceFacet, SOURCE_FACETS, type StoreFacet, type StoreQuery } from "./query.js";
import { containerTable } from "./schema/container.js";
import { contentTable } from "./schema/content.js";
import { personTable } from "./schema/person.js";
import {
  contentGithubTable,
  contentLinearTable,
  contentSlackTable,
  SOURCE_ROW_TABLES,
  type SourceWithRowTable,
} from "./schema/sourceRows.js";

/**
 * What a query's name-shaped filters resolved to before any SQL was built.
 *
 * Exactly one thing lives in here today and the shape is still a record rather than a bare array,
 * because the whole point is that a resolution happens ONCE per read and is then just data: a second
 * name-shaped filter joins this instead of adding another round trip inside a predicate builder.
 *
 * @internal
 */
export interface StoreScope {
  /** The people `--person` reached, empty when the query named none. */
  readonly people: readonly PersonMatch[];
}

/**
 * Every filter in a query, as one `AND`ed predicate, or `undefined` when the query filters nothing.
 *
 * `websearch_to_tsquery` rather than `to_tsquery` for the search leg: it takes what a person actually
 * types, quoted phrases and `-exclusions` included, and it never throws on punctuation. `to_tsquery`
 * raises a syntax error on a bare `a b`, which would turn an ordinary two-word search into a stack trace.
 *
 * @param query the validated query
 * @param scope what a name-shaped filter already resolved to, so the predicate never re-decides identity
 * @returns the combined predicate, or `undefined` for an unfiltered read
 */
export function predicateFor({ query, scope }: { query: StoreQuery; scope: StoreScope }): SQL | undefined {
  const clauses: SQL[] = [];
  if (scope.people.length > 0) {
    // Over the RESOLVED person ids rather than over a name column, which is what makes this filter span
    // platforms: one person's Slack member id, Linear UUID and GitHub login all point at this one row.
    clauses.push(
      inArray(
        contentTable.authorId,
        scope.people.map((match) => match.person.id),
      ),
    );
  }
  if (query.source !== undefined) {
    clauses.push(eq(contentTable.source, query.source));
  }
  if (query.kind !== undefined) {
    clauses.push(eq(contentTable.kind, query.kind));
  }
  if (query.visibility !== undefined) {
    clauses.push(eq(contentTable.visibility, query.visibility));
  }
  if (query.container !== undefined) {
    clauses.push(eq(containerTable.nativeId, query.container));
  }
  if (query.author !== undefined) {
    // `--author` names what the row SHOWS: the person's name, or the platform's own author id when no person
    // resolved — so a bot id filters exactly as a human name does.
    clauses.push(sql`coalesce(${personTable.displayName}, ${contentTable.authorNativeId}) = ${query.author}`);
  }
  if (query.since !== undefined) {
    clauses.push(gte(contentTable.occurredAt, new Date(query.since)));
  }
  if (query.until !== undefined) {
    clauses.push(lte(contentTable.occurredAt, new Date(query.until)));
  }
  if (query.search !== undefined) {
    clauses.push(sql`${contentTable.searchable} @@ websearch_to_tsquery('english', ${query.search})`);
  }
  if (query.contains !== undefined) {
    clauses.push(ilikeBothColumns({ pattern: `%${escapeLike({ term: query.contains })}%` }));
  }
  if (query.like !== undefined) {
    clauses.push(ilikeBothColumns({ pattern: query.like }));
  }
  clauses.push(...threadClauses({ query }));
  clauses.push(...sourcePredicates({ query }));
  return clauses.length === 0 ? undefined : and(...clauses);
}

/**
 * The thread clause, when the query carries the pair that makes an anchor unique.
 *
 * A list rather than an optional value, so the caller spreads it exactly as it spreads the per-source
 * clauses. `parseStoreQuery` accepts `--thread` alone and `threadAnchorConflict` refuses that before any
 * query runs, so arriving here without a source means a caller skipped the check. No clause is the honest
 * answer there, rather than a guess at which source was meant.
 *
 * @param query the validated query
 * @returns the one clause, or nothing
 */
function threadClauses({ query }: { query: StoreQuery }): readonly SQL[] {
  if (query.thread === undefined || query.source === undefined) {
    return [];
  }
  return [threadPredicate({ anchor: query.thread, source: query.source })];
}

/**
 * Every row in the anchor's thread: its own root, and everything hanging off that root.
 *
 * Two recursive walks rather than one, because a thread is not "the rows under this one" — a detective
 * lands on a REPLY far more often than on the message that started it, and a downward-only walk from
 * that reply returns the tail of the conversation and calls it the conversation. So the first walk
 * climbs `parent_id` to the row that has none, and the second descends from there.
 *
 * Both walks seek an index and nothing else: upward is the primary key, downward is
 * `idx_content_parent`. Neither ever reads `content_slack`, which is what makes this the one thread read
 * that works for GitHub, Linear and Notion as well — the per-source string join it replaces
 * (`probe/aroundSlack.ts`'s `threadWindow`) could only ever answer for Slack.
 *
 * **Both walks carry a `CYCLE` clause, and the final `union` with `ancestry` is the same defence.** No
 * derivation rule in `../project.ts` can mint a cycle — every id rule names a strictly shorter prefix and
 * `:chunk:0` names itself nothing — but Linear's nesting comes from a provider ATTRIBUTE rather than from
 * the id, so two comments naming each other is data this store cannot rule out. Without the clause that is
 * not a wrong answer, it is a query that never returns; with it, the climb stops at the repeat, and the
 * `union` means a thread whose root is unreachable still answers with the chain that was walked rather
 * than with nothing. `ancestry` is a subset of `descent` in every healthy case, so it costs a hash.
 *
 * Row-level security is not bypassed by the recursion, and that is in our favour rather than a caveat:
 * `content`'s bot policy is `visibility = 'public'`, so a walk run as `slopweaver_bot` stops at a private
 * ancestor by the database's decision rather than by a filter a caller has to remember.
 *
 * @param anchor the stored `source_id` of any row in the thread
 * @param source which source that id belongs to — an id is unique only within one
 * @returns the predicate selecting the whole thread
 */
function threadPredicate({ anchor, source }: { anchor: string; source: string }): SQL {
  return sql`${contentTable.id} in (
    with recursive ancestry as (
      select id, parent_id from content where source = ${source}::content_source and source_id = ${anchor}
      union all
      select up.id, up.parent_id from content up join ancestry on up.id = ancestry.parent_id
    ) cycle id set climbed using climb, descent as (
      select id from ancestry where parent_id is null
      union all
      select down.id from content down join descent on down.parent_id = descent.id
    ) cycle id set descended using fall
    select id from descent
    union
    select id from ancestry
  )`;
}

/**
 * The predicate the two substring filters share: the pattern against the body, or against the title.
 *
 * Written as `body ilike …` OR `coalesce(title,'') ilike …` rather than against the CONCATENATION of the
 * two, and that is the whole reason this helper exists rather than being inlined twice. The two trigram
 * indexes (`src/store/schema/content.ts`) are declared on exactly those two expressions, and a predicate
 * naming `coalesce(title,'') || ' ' || body` matches neither — it plans as a sequential scan over every
 * row while looking like it worked. MEASURED by the probe ladder it shares this shape with:
 * `body ilike '%nz%'` takes several seconds with no usable index against about 100 ms through the tsvector.
 *
 * The pattern is always a BOUND parameter, so what a caller typed is data on both paths. `--contains`
 * escapes its term first ({@link escapeLike}) so a literal `%` searches for itself; `--like` does not,
 * because handing the caller their own wildcards is the entire point of that flag.
 *
 * @param pattern the complete `ILIKE` pattern, already escaped or deliberately not
 * @returns the predicate
 */
function ilikeBothColumns({ pattern }: { pattern: string }): SQL {
  return sql`(${contentTable.body} ilike ${pattern} or coalesce(${contentTable.title}, '') ilike ${pattern})`;
}

/**
 * The per-source filters, each as an `EXISTS` against that source's own table.
 *
 * `EXISTS` rather than a join, and the difference is not stylistic: a join would multiply the row set if
 * a side table ever gained a second row per content row, and it would also change what a facet counts.
 * A semi-join cannot, and its lookup is the side table's primary key, so it is one index seek per row it
 * is asked about. The value is always a bound parameter — nothing here interpolates what a caller typed.
 *
 * @param query the validated query
 * @returns one predicate per per-source filter the query names, empty when it names none
 */
function sourcePredicates({ query }: { query: StoreQuery }): readonly SQL[] {
  const clauses: SQL[] = [];
  if (query.channel !== undefined) {
    clauses.push(
      semiJoin({
        match: sql`${contentSlackTable.channelId} = ${query.channel} or ${contentSlackTable.channelName} = ${query.channel}`,
        source: "slack",
      }),
    );
  }
  if (query.repo !== undefined) {
    clauses.push(semiJoin({ match: sql`${contentGithubTable.repo} = ${query.repo}`, source: "github" }));
  }
  if (query.team !== undefined) {
    clauses.push(semiJoin({ match: sql`${contentLinearTable.team} = ${query.team}`, source: "linear" }));
  }
  if (query.assignee !== undefined) {
    clauses.push(semiJoin({ match: sql`${contentLinearTable.assignee} = ${query.assignee}`, source: "linear" }));
  }
  const state = query.state;
  const stateOn = state === undefined ? null : stateSource({ query });
  if (state !== undefined && stateOn === "github") {
    clauses.push(semiJoin({ match: sql`${contentGithubTable.state} = ${state}`, source: "github" }));
  }
  if (state !== undefined && stateOn === "linear") {
    clauses.push(semiJoin({ match: sql`${contentLinearTable.state} = ${state}`, source: "linear" }));
  }
  return clauses;
}

/**
 * One per-source filter, as an `EXISTS` correlated on the side table's primary key.
 *
 * @param source which per-source table to test
 * @param match the predicate over that table's own columns
 * @returns the semi-join predicate
 */
function semiJoin({ source, match }: { source: SourceWithRowTable; match: SQL }): SQL {
  const table = SOURCE_ROW_TABLES[source];
  return sql`exists (select 1 from ${table} where ${table.contentId} = ${contentTable.id} and (${match}))`;
}

/**
 * Which source's `state` column a `--state` filter means.
 *
 * Both GitHub and Linear have one and they are different vocabularies, so the source has to come from
 * elsewhere in the query. `query.ts`'s `sourceForQuery` refuses a `--state` with nothing to pin it
 * BEFORE a connection opens; this is the same rule reading the settled answer.
 *
 * @param query the validated query
 * @returns the source whose state column to test, or `null` when nothing in the query settles it
 */
function stateSource({ query }: { query: StoreQuery }): SourceWithRowTable | null {
  if (query.source === "github" || query.source === "linear") {
    return query.source;
  }
  for (const { field, source } of FILTER_SOURCES) {
    if (query[field] !== undefined && (source === "github" || source === "linear")) {
      return source;
    }
  }
  return null;
}

/**
 * The SQL expression each facet groups by, so a facet name never reaches a query as a column name.
 *
 * Typed `SQL<string>` rather than a bare `SQL`, so the value comes back as a string the report can print
 * instead of an `unknown` a caller has to stringify blind.
 *
 * @returns the grouping expression
 */
export function facetColumn({ facet }: { facet: StoreFacet }): SQL<string> {
  if (facet === "container") {
    return sql<string>`coalesce(${containerTable.nativeId}, '(none)')`;
  }
  if (facet === "author") {
    return sql<string>`coalesce(${personTable.displayName}, ${contentTable.authorNativeId}, '(none)')`;
  }
  if (facet === "day") {
    return sql<string>`to_char(${contentTable.occurredAt}, 'YYYY-MM-DD')`;
  }
  if (isSourceFacet(facet)) {
    const entry = SOURCE_FACETS[facet];
    const table = SOURCE_ROW_TABLES[entry.source];
    const column = entry.column;
    // A correlated lookup on the side table's PRIMARY KEY rather than a join, for the reason
    // `sourcePredicates` gives: a join can change what the outer query counts and a scalar subquery
    // cannot. `(none)` is a real answer — a Slack row with no subtype is a plain message.
    return sql<string>`coalesce((select ${column}::text from ${table} where ${table.contentId} = ${contentTable.id}), '(none)')`;
  }
  if (facet === "kind") {
    return sql<string>`${contentTable.kind}::text`;
  }
  if (facet === "visibility") {
    return sql<string>`${contentTable.visibility}::text`;
  }
  return sql<string>`${contentTable.source}::text`;
}
