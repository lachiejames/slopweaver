/**
 * `store hits` — the one SEARCH rung of the disclosure ladder, one page of the records a shape selected.
 *
 * Its own module rather than a section of `./disclose.ts` because it is the odd one out there: `peek`,
 * `open` and `around` READ records a detective already chose by id, while `hits` still SEARCHES by a
 * shape's predicate. That is why it alone takes the human-only bot scope — the same
 * filter `probe` and `groups` apply — and the reading rungs never do (`./disclose.ts` § the header).
 */
import { type SQL, sql } from "drizzle-orm";

import { err, ok, type Result } from "../../lib/result.js";
import type { StoreReader } from "../client.js";
import { type StoreError, StoreErrors } from "../errors.js";
import { HEAD_COLUMNS, HEAD_JOINS, headOf, type RecordHead } from "./head.js";
import type { ProbeShape } from "./shapes.js";
import { botFilter, shapePredicate } from "./sql.js";

/** What one `hits` page asks for — every field the statement turns into SQL. */
type HitsQuery = {
  readonly shape: ProbeShape;
  /** The keyword, or for `regex` the caller's own pattern. */
  readonly term: string;
  /** Restrict to one source, or the whole store. */
  readonly source: string | undefined;
  readonly limit: number;
  readonly offset: number;
  /** List bot-authored rows too, rather than the human-only default. */
  readonly includeBots: boolean;
};

/**
 * The statement one `hits` page runs, newest first.
 *
 * Pure, so the bot filter and the paging are asserted on the rendered SQL with no database. The paging is
 * by offset rather than by keyset, which is the honest trade for a set whose ordering expression is not
 * indexed alongside its predicate: a keyset cursor would be exact and would still have to re-sort the same
 * containment set on every page. A detective reading page four of a wide cell is already doing the wrong
 * thing — `groups` is the move that makes it narrow instead. Offset paging is only a traversal when the order is
 * total, so `content.id` breaks a tie of `occurred_at`: without it two pages may each pick a different ordering of
 * tied rows and skip one (the resync demand gate pages here).
 *
 * @returns the statement
 */
export function hitsStatement({ shape, term, source, limit, offset, includeBots }: HitsQuery): SQL {
  const restrict = source === undefined ? sql`` : sql`and content.source = ${source}`;
  return sql`
    select ${HEAD_COLUMNS}
    from content ${HEAD_JOINS}
    where ${shapePredicate({ qualified: true, shape, term })} ${restrict}
    ${botFilter({ includeBots, qualified: true })}
    order by content.occurred_at desc, content.id desc
    limit ${limit} offset ${offset}
  `;
}

/**
 * One page of the records a shape selected — {@link hitsStatement}, run.
 *
 * @param reader anything a read can run against
 * @returns the page, or the store's own typed failure
 */
export async function runHits({
  reader,
  ...query
}: HitsQuery & { reader: StoreReader }): Promise<Result<readonly RecordHead[], StoreError>> {
  try {
    const rows = await reader.db.execute(hitsStatement(query));
    return ok([...rows].map((row) => headOf({ row })));
  } catch (error: unknown) {
    return err(StoreErrors.queryFailed({ cause: error, what: "store hits" }));
  }
}
