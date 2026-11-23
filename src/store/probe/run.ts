/**
 * Running a probe: the thin effectful shell over {@link ./sql}'s statements and {@link ./result}'s folds.
 *
 * Everything that decides anything is pure and lives in those two modules. What is here is the loop that
 * executes, the two-phase enumeration, and the mapping of a driver throw into the store's own typed error.
 *
 * ## Two phases, because the second one is the expensive one
 *
 * Counting is cheap and enumerating is not: `order by occurred_at desc` over a million-row containment set
 * sorts a million rows to hand back ten. So the counts come back FIRST, and ids are fetched only for the
 * cells whose count already proved them small. A cell above the cap reports `ids: null` — not asked — and
 * a detective that wants them anyway raises `--enumerate-at-or-below`, having seen what it is asking for.
 */
import { type SQL, sql } from "drizzle-orm";

import { absentAs, absentAsNull } from "#lib/absent.js";
import { err, ok, type Result } from "../../lib/result.js";
import type { StoreReader } from "../client.js";
import { type StoreError, StoreErrors } from "../errors.js";
import { foldSourceCounts, orderCells, type ProbeCell, type ProbeReport, type ProbeRow } from "./result.js";
import { numberOf, optionalText, requireText } from "./rows.js";
import { isIndexed, type ProbeShape } from "./shapes.js";
import {
  botFilter,
  exactCountsStatement,
  ladderCountsStatement,
  type ProbeSubject,
  regexCountsStatement,
  shapeIdsStatement,
  shapePredicate,
  TERM_SHAPES,
} from "./sql.js";

/** Everything a probe invocation was asked for. */
export interface ProbePlan {
  readonly subjects: readonly ProbeSubject[];
  /** Restrict to one source, or the whole store. */
  readonly source: string | undefined;
  /** Fetch a cell's record ids only when its count is at or below this. */
  readonly enumerateAtOrBelow: number;
  /** How many ids to fetch for a cell that is enumerated. */
  readonly ids: number;
  /** Count bot-authored rows too, rather than the human-only default. */
  readonly includeBots: boolean;
}

/**
 * Run one statement against the store and hand back its rows — every read a probe or a breakdown makes.
 *
 * The reader's own `db.execute` in {@link runProbe} and {@link runGroups}; a scripted answer in a unit test.
 */
export type ProbeExecute = (args: { statement: SQL }) => Promise<Iterable<Record<string, unknown>>>;

/**
 * The statement runner a {@link StoreReader} already is.
 *
 * @param reader anything a read can run against
 * @returns the runner that hands each statement to the reader's own `db.execute`
 */
function readerStatements({ reader }: { reader: StoreReader }): ProbeExecute {
  return async ({ statement }) => reader.db.execute(statement);
}

/** What one subject counted: its cells, and the bot-authored rows the default left out of its widest set. */
interface CountedSubject {
  readonly cells: readonly ProbeCell[];
  readonly botsHidden: number;
}

/**
 * Sum a counting statement's per-source `bots` column — the bot-authored rows in the set it scanned.
 *
 * @param rows what the statement returned, one row per source
 * @returns the total
 */
function botTotal({ rows }: { rows: readonly Readonly<Record<string, unknown>>[] }): number {
  return rows.reduce((sum, row) => sum + numberOf({ key: "bots", row }), 0);
}

/**
 * Count one keyword across every derived shape — the exact rung, then the substring ladder.
 *
 * @param runStatement what runs each count against the store
 * @param term the keyword
 * @param source restrict to one source, or the whole store
 * @param includeBots count bot-authored rows too, rather than the human-only default
 * @returns one cell per shape, unordered, and the bot rows the ladder's containment set left out
 */
async function termCells({
  runStatement,
  term,
  source,
  includeBots,
}: {
  runStatement: ProbeExecute;
  term: string;
  source: string | undefined;
  includeBots: boolean;
}): Promise<CountedSubject> {
  const exactRows = await runStatement({ statement: exactCountsStatement({ includeBots, source, term }) });
  const ladderRows = await runStatement({ statement: ladderCountsStatement({ includeBots, source, term }) });
  const exact = foldSourceCounts({
    counts: [...exactRows].map((row) => ({
      rows: numberOf({ key: "rows", row }),
      source: requireText({ key: "source", row }),
    })),
  });
  const cells: ProbeCell[] = [{ bySource: exact.bySource, ids: null, indexed: true, rows: exact.rows, shape: "exact" }];
  const substringShapes = TERM_SHAPES.filter((shape) => shape !== "exact");
  for (const shape of substringShapes) {
    const folded = foldSourceCounts({
      counts: [...ladderRows].map((row) => ({
        rows: numberOf({ key: shape, row }),
        source: requireText({ key: "source", row }),
      })),
    });
    cells.push({
      bySource: folded.bySource,
      ids: null,
      indexed: isIndexed({ shape, term }),
      rows: folded.rows,
      shape,
    });
  }
  return { botsHidden: includeBots ? 0 : botTotal({ rows: [...ladderRows] }), cells };
}

/**
 * Count the caller's own regex — its own single-rung ladder.
 *
 * @param runStatement what runs the count against the store
 * @param pattern the caller's regex
 * @param source restrict to one source, or the whole store
 * @param includeBots count bot-authored rows too, rather than the human-only default
 * @returns the one cell, and the bot rows the pattern matched and the default left out
 */
async function regexCells({
  runStatement,
  pattern,
  source,
  includeBots,
}: {
  runStatement: ProbeExecute;
  pattern: string;
  source: string | undefined;
  includeBots: boolean;
}): Promise<CountedSubject> {
  const rows = await runStatement({ statement: regexCountsStatement({ includeBots, pattern, source }) });
  const folded = foldSourceCounts({
    counts: [...rows].map((row) => ({
      rows: numberOf({ key: "rows", row }),
      source: requireText({ key: "source", row }),
    })),
  });
  return {
    botsHidden: includeBots ? 0 : botTotal({ rows: [...rows] }),
    cells: [
      {
        bySource: folded.bySource,
        ids: null,
        indexed: isIndexed({ shape: "regex", term: pattern }),
        rows: folded.rows,
        shape: "regex",
      },
    ],
  };
}

/**
 * Fetch the record ids for every cell the counts proved small enough to enumerate.
 *
 * @param runStatement what runs each id read against the store
 * @param cells one subject's cells, already counted
 * @param subject the keyword or regex those cells came from
 * @param plan what the invocation asked for
 * @returns the same cells, with `ids` filled in where it was asked for
 */
async function enumerateCells({
  runStatement,
  cells,
  subject,
  plan,
}: {
  runStatement: ProbeExecute;
  cells: readonly ProbeCell[];
  subject: string;
  plan: ProbePlan;
}): Promise<readonly ProbeCell[]> {
  const filled: ProbeCell[] = [];
  for (const cell of cells) {
    if (cell.rows === 0) {
      filled.push({ ...cell, ids: [] });
      continue;
    }
    if (cell.rows > plan.enumerateAtOrBelow) {
      filled.push(cell);
      continue;
    }
    const rows = await runStatement({
      statement: shapeIdsStatement({
        includeBots: plan.includeBots,
        limit: plan.ids,
        shape: cell.shape,
        source: plan.source,
        term: subject,
      }),
    });
    filled.push({ ...cell, ids: [...rows].map((row) => String(row["id"])) });
  }
  return filled;
}

/**
 * Fan every subject across its shapes over the whole store, and enumerate what proves narrow.
 *
 * @param reader anything a read can run against
 * @param plan what the invocation asked for
 * @returns the count matrix, or the store's own typed failure
 */
export async function runProbe({
  reader,
  plan,
}: {
  reader: StoreReader;
  plan: ProbePlan;
}): Promise<Result<ProbeReport, StoreError>> {
  return runProbeVia({ nowMs: () => Date.now(), plan, runStatement: readerStatements({ reader }) });
}

/**
 * {@link runProbe} over any statement runner and clock: count every subject, then enumerate what proves narrow.
 *
 * @param runStatement what runs every count and id read, in order
 * @param plan what the invocation asked for
 * @param nowMs the clock, read at the probe's start and end and at each subject's start and end
 * @returns the count matrix, or the store's own typed failure
 */
export async function runProbeVia({
  runStatement,
  plan,
  nowMs,
}: {
  runStatement: ProbeExecute;
  plan: ProbePlan;
  nowMs: () => number;
}): Promise<Result<ProbeReport, StoreError>> {
  const started = nowMs();
  const rows: ProbeRow[] = [];
  try {
    for (const subject of plan.subjects) {
      const subjectStarted = nowMs();
      const text = subject.kind === "term" ? subject.term : subject.pattern;
      const counted =
        subject.kind === "term"
          ? await termCells({ includeBots: plan.includeBots, runStatement, source: plan.source, term: subject.term })
          : await regexCells({
              includeBots: plan.includeBots,
              pattern: subject.pattern,
              runStatement,
              source: plan.source,
            });
      const cells = await enumerateCells({ cells: counted.cells, plan, runStatement, subject: text });
      rows.push({
        botsHidden: counted.botsHidden,
        cells: orderCells({ cells }),
        elapsedMs: nowMs() - subjectStarted,
        kind: subject.kind,
        subject: text,
      });
    }
  } catch (error: unknown) {
    return err(StoreErrors.queryFailed({ cause: error, what: "store probe" }));
  }
  return ok({
    elapsedMs: nowMs() - started,
    enumerateAtOrBelow: plan.enumerateAtOrBelow,
    includeBots: plan.includeBots,
    rows,
    source: absentAsNull({ value: plan.source }),
  });
}

/** One group of a breakdown: where a shape's hits concentrate. */
export interface StoreGroup {
  readonly value: string;
  readonly rows: number;
}

/** Which column a breakdown groups by. */
export const GROUP_FACETS = ["source", "kind", "container", "author"] as const;

/** One column a breakdown may group by. */
export type GroupFacet = (typeof GROUP_FACETS)[number];

/**
 * Split one wide cell into groups, so a detective can see which container or person owns the noise.
 *
 * This is the move that turns one unreadable cell into several readable leads: a keyword whose
 * `wild-both` count is a million is one dead cell, and the same keyword split by container is a list in
 * which one alert channel holds 99% and six real conversations hold the rest.
 *
 * @param reader anything a read can run against
 * @param shape which rung of the ladder to split
 * @param term the keyword, or for `regex` the caller's own pattern
 * @param facet which column to group by
 * @param limit how many groups to return, largest first
 * @param includeBots group bot-authored rows too, rather than the human-only default
 * @returns the groups, or the store's own typed failure
 */
export async function runGroups({
  reader,
  shape,
  term,
  facet,
  limit,
  includeBots,
}: {
  reader: StoreReader;
  shape: ProbeShape;
  term: string;
  facet: GroupFacet;
  limit: number;
  includeBots: boolean;
}): Promise<Result<readonly StoreGroup[], StoreError>> {
  return runGroupsVia({ facet, includeBots, limit, runStatement: readerStatements({ reader }), shape, term });
}

/**
 * {@link runGroups} over any statement runner: one grouped count, largest group first.
 *
 * @param runStatement what runs the grouped count against the store
 * @param shape which rung of the ladder to split
 * @param term the keyword, or for `regex` the caller's own pattern
 * @param facet which column to group by
 * @param limit how many groups to return, largest first
 * @param includeBots group bot-authored rows too, rather than the human-only default
 * @returns the groups, or the store's own typed failure
 */
export async function runGroupsVia({
  runStatement,
  shape,
  term,
  facet,
  limit,
  includeBots,
}: {
  runStatement: ProbeExecute;
  shape: ProbeShape;
  term: string;
  facet: GroupFacet;
  limit: number;
  includeBots: boolean;
}): Promise<Result<readonly StoreGroup[], StoreError>> {
  const grouped = groupExpression({ facet });
  try {
    const rows = await runStatement({
      statement: sql`
      select ${grouped} as value, count(*)::bigint as rows
      from content
      left join container on container.id = content.container_id
      left join person on person.id = content.author_id
      where ${shapePredicate({ qualified: true, shape, term })}
      ${botFilter({ includeBots, qualified: true })}
      group by 1
      order by 2 desc
      limit ${limit}
    `,
    });
    return ok(
      [...rows].map((row) => ({
        rows: numberOf({ key: "rows", row }),
        value: absentAs({ value: optionalText({ key: "value", row }), whenAbsent: "(none)" }),
      })),
    );
  } catch (error: unknown) {
    return err(StoreErrors.queryFailed({ cause: error, what: "store groups" }));
  }
}

/**
 * The expression one breakdown facet groups by.
 *
 * A container and an author are rendered by NAME rather than by id, because the id is what the detective
 * would then have to look up and the name is what it is actually deciding on.
 *
 * @param facet which column to group by
 * @returns the grouping expression
 */
function groupExpression({ facet }: { facet: GroupFacet }): ReturnType<typeof sql> {
  if (facet === "container") {
    return sql`coalesce(container.native_id, '(no container)')`;
  }
  if (facet === "author") {
    return sql`coalesce(person.display_name, content.author_native_id, '(no author)')`;
  }
  if (facet === "kind") {
    return sql`content.kind::text`;
  }
  return sql`content.source::text`;
}
