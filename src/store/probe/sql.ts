/**
 * The statements the probe runs, and the one decision that makes seven shapes cost about as much as one.
 *
 * Pure: every function here BUILDS a statement and none of them runs one. {@link ./run} is the effectful
 * half.
 *
 * ## The narrowing CTE, and what it is worth
 *
 * Six of the seven shapes are substring matches, and every one of them is a SUBSET of `wild-both` —
 * containment is what they all require and each adds a boundary on top. So the ladder is one
 * trigram-indexed containment probe that materialises the hit set, then `count(*) FILTER` over exactly
 * those rows. The narrow shapes cost a regex over a few thousand rows instead of a regex over millions.
 *
 * MEASURED against the live store, keyword `barten` (a synthetic stand-in for the measured name):
 *
 * | how                                                    | elapsed           |
 * | ------------------------------------------------------ | ----------------- |
 * | the `alnum` shape alone, as its own statement           | several seconds   |
 * | all five substring shapes, through this CTE             | under one second  |
 *
 * Reproduce with `slopweaver store probe barten`. The worst case measured the same day is a keyword whose
 * containment set is a million rows (`datadog`): over ten seconds for the whole ladder, still one
 * statement per keyword, most of it the containment scan itself.
 *
 * ## The trap inside that CTE, which cost the first version its index
 *
 * The trigram indexes are on `body` and on `coalesce(title, '')` — two separate expressions. Narrowing on
 * the CONCATENATION of them (`coalesce(title,'') || ' ' || body ilike …`) matches no index expression at
 * all and the planner falls back to a sequential scan. Same statement, same result set, about ten times
 * slower. So the WHERE clause names the two indexed expressions separately, and the CTE projects them
 * separately too.
 *
 * ## Why the CTE projects two columns rather than one concatenated haystack
 *
 * The first version projected `coalesce(title,'') || ' ' || body as hay` and counted each shape against
 * THAT, while `shapeIdsStatement` selected rows with `body ~* p or title ~* p`. Two different expressions
 * for one shape, and the divergence is reachable: concatenation inserts a space that exists in neither
 * field, so a multi-word keyword — which `probeCore` deliberately supports, see its "keeps a quoted phrase
 * as ONE keyword" case — can match across the seam, or acquire a `\M` word boundary from the seam that the
 * body alone does not give it. Title `foo`, body `bar foo barx`, keyword `foo bar`: the `wild-left` cell
 * counted 1 and its id list came back EMPTY, because `foo bar` is followed by a boundary only in the
 * concatenation. A count no `store hits` can reproduce is the one failure this whole ladder cannot afford,
 * since every rung after the first is chosen off these numbers. Both now go through `shapePredicate`, so
 * there is one expression per shape and no seam to match across.
 */
import { type SQL, sql } from "drizzle-orm";

import { escapeLike, type ProbeShape, shapeRegex } from "./shapes.js";

// No `ESCAPE` clause anywhere here, and that is a Postgres constraint rather than an omission: `ESCAPE`
// takes a LITERAL, so binding it as a parameter fails at parse time with `syntax error at or near "$2"`.
// Backslash is already LIKE's default escape character, which is exactly what `escapeLike` writes, so the
// clause would have restated the default even if it had been bindable.

/**
 * One subject a probe counts: a keyword fanned across the derived shapes, or the caller's own regex.
 *
 * A regex is its own subject rather than a seventh column beside a keyword, because nothing derives it
 * from a term — the owner writes it — so pairing it with one keyword would be inventing an association
 * the caller never stated.
 */
export type ProbeSubject =
  { readonly kind: "term"; readonly term: string } | { readonly kind: "regex"; readonly pattern: string };

/** The shapes a keyword subject is fanned across, in the order they are reported. */
export const TERM_SHAPES: readonly ProbeShape[] = ["exact", "wild-left", "slash", "alnum", "wild-right", "wild-both"];

/**
 * The predicate restricting a probe to one source, when the caller named one.
 *
 * Returns `sql.empty()` rather than `null` for the unrestricted case, and the difference is not stylistic:
 * drizzle interpolates a `null` into a template as a BOUND PARAMETER, so an unrestricted probe rendered
 * `… where searchable @@ plainto_tsquery('english', $1) $2 group by source` and every invocation failed
 * with `syntax error at or near "$2"`. An empty fragment contributes nothing to the statement at all.
 *
 * @param source the source slug, or nothing for the whole store
 * @returns the predicate, or an empty fragment
 */
function sourceFilter({ source }: { source: string | undefined }): SQL {
  return source === undefined ? sql.empty() : sql`and source = ${source}`;
}

/**
 * The predicate keeping a search human-only, or nothing when the caller widened it to bots.
 *
 * The detective verbs start human-only and widen, the way Slack search excludes
 * automations by default. An `and` fragment rather than a bare predicate so it composes after any WHERE
 * clause here, and `sql.empty()` rather than `null` for the widened case, for the reason {@link sourceFilter}
 * gives. It filters AFTER the trigram or tsvector narrowing has picked the rows, which is why
 * `content.author_is_bot` needs no index of its own.
 *
 * @param includeBots whether the caller widened the search to bot-authored rows
 * @param qualified prefix the column with `content.`, for a statement that joins
 * @returns the predicate, or an empty fragment
 */
export function botFilter({ includeBots, qualified = false }: { includeBots: boolean; qualified?: boolean }): SQL {
  if (includeBots) {
    return sql.empty();
  }
  return qualified ? sql`and not content.author_is_bot` : sql`and not author_is_bot`;
}

/**
 * One shape's count: every row matching `predicate`, less the bot-authored ones unless bots are included.
 *
 * The counting statements below filter INSIDE the aggregate rather than in their WHERE clause, because the
 * same scan also counts the bot rows it is leaving out — that is the `bots` column, and it costs one more
 * `count(*) filter` over rows the statement already holds rather than a second scan. Widened, the aggregate
 * is exactly the one these statements had before the column existed.
 *
 * @param includeBots whether the caller widened the search to bot-authored rows
 * @param predicate the shape's own condition, or nothing for the whole containment set
 * @returns the aggregate
 */
function keptCount({ includeBots, predicate }: { includeBots: boolean; predicate: SQL | null }): SQL {
  if (predicate === null) {
    return includeBots ? sql`count(*)` : sql`count(*) filter (where not author_is_bot)`;
  }
  return includeBots
    ? sql`count(*) filter (where ${predicate})`
    : sql`count(*) filter (where not author_is_bot and ${predicate})`;
}

/**
 * The statement counting the `exact` shape for one keyword, grouped by source.
 *
 * Separate from the ladder because it reaches a different index and a different column: the generated
 * `searchable` tsvector, through its gin index, which answers at any term length — including the terms
 * shorter than {@link ./shapes.TRIGRAM_FLOOR} where the ladder has no index at all.
 *
 * @param term the keyword
 * @param source restrict to one source, or the whole store
 * @param includeBots count bot-authored rows too, rather than the human-only default
 * @returns the statement
 */
export function exactCountsStatement({
  term,
  source,
  includeBots,
}: {
  term: string;
  source: string | undefined;
  includeBots: boolean;
}): SQL {
  return sql`
    select source::text as source, count(*)::bigint as rows
    from content
    where searchable @@ plainto_tsquery('english', ${term})
    ${sourceFilter({ source })}
    ${botFilter({ includeBots })}
    group by source
  `;
}

/**
 * The one statement counting every substring shape for one keyword, grouped by source.
 *
 * Read this module's header before changing the WHERE clause — naming the concatenation there rather than
 * the two indexed expressions is what silently turns this into a sequential scan. The bot filter is NOT in
 * that clause: it sits inside each aggregate, so the containment set is scanned once and its bot rows are
 * counted into `bots` rather than discarded unseen.
 *
 * @param term the keyword
 * @param source restrict to one source, or the whole store
 * @param includeBots count bot-authored rows too, rather than the human-only default
 * @returns the statement
 */
export function ladderCountsStatement({
  term,
  source,
  includeBots,
}: {
  term: string;
  source: string | undefined;
  includeBots: boolean;
}): SQL {
  const like = `%${escapeLike({ term })}%`;
  const count = ({ shape }: { shape: ProbeShape | null }): SQL =>
    keptCount({ includeBots, predicate: shape === null ? null : shapePredicate({ shape, term }) });
  return sql`
    with hits as (
      select source, coalesce(title, '') as title, body, author_is_bot
      from content
      where (body ilike ${like} or coalesce(title, '') ilike ${like})
      ${sourceFilter({ source })}
    )
    select source::text as source,
      ${count({ shape: null })}::bigint as "wild-both",
      ${count({ shape: "wild-left" })}::bigint as "wild-left",
      ${count({ shape: "wild-right" })}::bigint as "wild-right",
      ${count({ shape: "alnum" })}::bigint as "alnum",
      ${count({ shape: "slash" })}::bigint as "slash",
      count(*) filter (where author_is_bot)::bigint as "bots"
    from hits
    group by source
  `;
}

/**
 * The statement counting the caller's own regex, grouped by source.
 *
 * @param pattern the caller's regex, matched case-insensitively
 * @param source restrict to one source, or the whole store
 * @param includeBots count bot-authored rows too, rather than the human-only default
 * @returns the statement, whose `bots` column counts the bot-authored matches either way
 */
export function regexCountsStatement({
  pattern,
  source,
  includeBots,
}: {
  pattern: string;
  source: string | undefined;
  includeBots: boolean;
}): SQL {
  return sql`
    select source::text as source,
      ${keptCount({ includeBots, predicate: null })}::bigint as rows,
      count(*) filter (where author_is_bot)::bigint as "bots"
    from content
    where (coalesce(title, '') ~* ${pattern} or body ~* ${pattern})
    ${sourceFilter({ source })}
    group by source
  `;
}

/**
 * The predicate one shape selects a keyword's rows with — the same expression its count came from.
 *
 * Shared by the id fetch and by {@link ./run}'s breakdown, so a record id can never come back from a
 * predicate that differs from the one that produced the count beside it.
 *
 * **The title operand comes first, and the order is load-bearing rather than stylistic.** `or`
 * short-circuits, `title` is a line and `body` can be thousands of characters, so testing the short field
 * first skips the long one on every row that matches — which on this store is the common case, because the
 * million-row alert channel carries the keyword in its `#channel message` title. MEASURED on
 * a live store of a couple of million rows, one shape over a million-row `datadog` containment set:
 * title-first took a bit over half the time body-first did, same count both ways. Reproduce by swapping the two operands in
 * the statement `slopweaver store probe datadog` runs.
 *
 * `qualified` exists because a breakdown JOINS `container` and `person`, both of which carry column names
 * that collide with `content`'s — an unqualified `title` or `source` there is an ambiguity Postgres
 * refuses outright. It is a BOOLEAN rather than a caller-supplied prefix string: the only prefix this
 * store has a reason to write is `content.`, and a string parameter reaching `sql.raw` would be an
 * interpolation hole in the one module whose whole job is to bind everything else as a parameter.
 *
 * @param shape which rung of the ladder
 * @param term the keyword, or for `regex` the caller's own pattern
 * @param qualified prefix every column with `content.`, for a statement that joins
 * @returns the predicate
 */
export function shapePredicate({
  shape,
  term,
  qualified = false,
}: {
  shape: ProbeShape;
  term: string;
  qualified?: boolean;
}): SQL {
  const body = qualified ? sql`content.body` : sql`body`;
  const title = qualified ? sql`coalesce(content.title, '')` : sql`coalesce(title, '')`;
  if (shape === "exact") {
    const vector = qualified ? sql`content.searchable` : sql`searchable`;
    return sql`${vector} @@ plainto_tsquery('english', ${term})`;
  }
  if (shape === "wild-both") {
    const like = `%${escapeLike({ term })}%`;
    return sql`(${title} ilike ${like} or ${body} ilike ${like})`;
  }
  if (shape === "regex") {
    return sql`(${title} ~* ${term} or ${body} ~* ${term})`;
  }
  // Non-null: `exact`, `wild-both` and `regex` have returned above, and `shapeRegex` answers a pattern for
  // each of the four substring shapes that remain. A miss would be a fault in `./shapes`, not in an input.
  const pattern = shapeRegex({ shape, term })!;
  return sql`(${title} ~* ${pattern} or ${body} ~* ${pattern})`;
}

/**
 * The statement fetching the record ids one shape selected, newest first.
 *
 * Only ever run for a cell whose count already came back at or below the caller's enumeration cap, which
 * is what keeps the `order by` affordable: sorting a few dozen rows by time is free, and sorting a million
 * is the thing this whole ladder exists to avoid doing by accident.
 *
 * @param shape which rung of the ladder
 * @param term the keyword, or for `regex` the caller's own pattern
 * @param source restrict to one source, or the whole store
 * @param limit how many ids to return
 * @param includeBots list bot-authored rows too, so the ids match the count beside them
 * @returns the statement
 */
export function shapeIdsStatement({
  shape,
  term,
  source,
  limit,
  includeBots,
}: {
  shape: ProbeShape;
  term: string;
  source: string | undefined;
  limit: number;
  includeBots: boolean;
}): SQL {
  return sql`
    select id::text as id, source::text as source, occurred_at as "occurredAt"
    from content
    where ${shapePredicate({ shape, term })}
    ${sourceFilter({ source })}
    ${botFilter({ includeBots })}
    order by occurred_at desc
    limit ${limit}
  `;
}
