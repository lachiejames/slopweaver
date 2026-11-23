/**
 * The PURE rendering of what a `store` read returned — a listed page, a facet table, one row whole — split
 * out of `./core.ts` along the rendering boundary, so the parsers there and the lines here each stay a file
 * a reader can hold.
 *
 * Every absent value a row can carry is named where it is rendered: a row with no title is headed by its
 * body's first line, and a detail read the store resolved no container or author for prints `(none)`.
 */

import type { ContentDetail, FacetCount } from "../../../store/client.js";
import type { StoreFacet } from "../../../store/query.js";
import type { ContentRow } from "../../../store/schema/content.js";

/**
 * Render a listed page as one line per row.
 *
 * @param rows the page the query selected
 * @param total how many rows matched before the page was taken
 * @returns the lines to print, including the one that says an empty result is a real answer
 */
export function listLines({ rows, total }: { rows: readonly ContentRow[]; total: number }): readonly string[] {
  if (rows.length === 0) {
    return [`no rows match — the store holds ${String(total)} matching row(s), so this filter is the reason`];
  }
  return [
    ...rows.map(
      (row) => `${row.occurredAt.toISOString()}  ${row.source}/${row.kind}  ${row.sourceId}  ${headline({ row })}`,
    ),
    `${String(rows.length)} of ${String(total)} matching row(s)`,
  ];
}

/** A listed row's headline: its title, or — for a row that carries none — the first line of its body. */
function headline({ row }: { row: ContentRow }): string {
  const title = row.title;
  if (title === null) {
    return firstLine({ text: row.body });
  }
  return title;
}

/**
 * The first line of a body, capped, for a row that carries no title.
 *
 * @returns a single-line preview
 */
function firstLine({ text }: { text: string }): string {
  // `!` rather than a fallback: `split` with a limit of one always yields at least one element, even for
  // the empty string, so an absent element here would be a fault in the runtime rather than in the data.
  const line = text.split("\n", 1)[0]!;
  return line.length > 96 ? `${line.slice(0, 96)}…` : line;
}

/**
 * Render facet counts as an aligned table, largest group first.
 *
 * ## Why the denominator is passed in rather than summed from the rows
 *
 * MEASURED on a store holding 1,000 Slack records: `store facets --facet container --limit 8`
 * printed a top group at `33.4%`, because the first version divided by the sum of the EIGHT groups it had
 * been given rather than by the 1,000 rows they came from. The real share was 14.2%. Nothing in the output
 * said the denominator was a page — the number simply meant something other than what it read as, which is
 * the class of defect a reader cannot catch. The true matching count is now a parameter, and a truncated
 * table says so on its last line.
 *
 * @param counts the grouped counts, already ordered largest first
 * @param facet which column they were grouped by
 * @param total how many rows matched the query in total, which is what a percentage is OF
 * @returns the lines to print
 */
export function facetLines({
  counts,
  facet,
  total,
}: {
  counts: readonly FacetCount[];
  facet: StoreFacet;
  total: number;
}): readonly string[] {
  if (counts.length === 0) {
    return [`no rows to group by ${facet}`];
  }
  const shown = counts.reduce((sum, entry) => sum + entry.rows, 0);
  const width = Math.max(...counts.map((entry) => entry.value.length));
  const share = ({ rows }: { rows: number }): string => (total === 0 ? "0.0" : ((rows / total) * 100).toFixed(1));
  const tail =
    shown === total
      ? `${String(counts.length)} ${facet} value(s) over all ${String(total)} matching row(s)`
      : `${String(counts.length)} largest ${facet} value(s), covering ${String(shown)} of ${String(total)} matching row(s) — raise --limit for the rest`;
  return [
    ...counts.map(
      (entry) => `${entry.value.padEnd(width)}  ${String(entry.rows).padStart(8)}  ${share({ rows: entry.rows })}%`,
    ),
    tail,
  ];
}

/**
 * Render one row whole, with its resolved container, author and per-source columns.
 *
 * @param detail the row and its names, or `null` when nothing carries that pair
 * @param source which platform was asked for
 * @param sourceId which id was asked for
 * @returns the lines to print
 */
export function detailLines({
  detail,
  source,
  sourceId,
}: {
  detail: ContentDetail | null;
  source: string;
  sourceId: string;
}): readonly string[] {
  if (detail === null) {
    return [`no ${source} row carries the id ${sourceId} — the store has never held one, or it was never ingested`];
  }
  return [
    `${detail.row.source}/${detail.row.kind}  ${detail.row.sourceId}`,
    `when:      ${detail.row.occurredAt.toISOString()}`,
    `container: ${resolvedName({ detail, key: "container" })}`,
    `author:    ${resolvedName({ detail, key: "author" })}`,
    `url:       ${detail.row.url}`,
    `visible:   ${detail.row.visibility}`,
    ...(detail.row.title === null ? [] : [`title:     ${detail.row.title}`]),
    ...sourceRowLines({ sourceRow: detail.sourceRow }),
    "",
    detail.row.body,
  ];
}

/** A detail read's resolved container or author name — `(none)` when the store resolved no name for it. */
function resolvedName({ detail, key }: { detail: ContentDetail; key: "container" | "author" }): string {
  const name = detail[key];
  if (name === null) {
    return "(none)";
  }
  return name;
}

/**
 * Render the per-source columns of a detail read, one `key: value` line each.
 *
 * Every source's table has a different column set, so this renders whatever the row HAS rather than a
 * fixed list — a column added to a per-source table appears here without this function being touched,
 * which is the property a hand-written list of four column sets would lose on its first change.
 *
 * @param sourceRow the side row, or `null` for a source with no table
 * @returns one line per non-empty column, headed by the source's own name
 */
function sourceRowLines({ sourceRow }: { sourceRow: Record<string, unknown> | null }): readonly string[] {
  if (sourceRow === null) {
    return [];
  }
  const lines: string[] = [];
  for (const [key, value] of Object.entries(sourceRow)) {
    if (key === "contentId" || key === "source" || value === null || value === undefined) {
      continue;
    }
    if (Array.isArray(value) && value.length === 0) {
      continue;
    }
    lines.push(`${key.padEnd(10)} ${scalarText({ value })}`);
  }
  return lines.length === 0 ? [] : ["", ...lines];
}

/**
 * One per-source column's value as a line of text, whatever type the column holds.
 *
 * A column can be a string, a number, a boolean, an instant, a text array or — for Notion's property bag
 * — an arbitrary object, so this dispatches on what the value IS rather than assuming it stringifies.
 * A bare template on an object prints `[object Object]`, which is a line that looks like data.
 *
 * @param value the column's value, already known to be neither null nor an empty array
 * @returns the text to print beside the column's name
 */
function scalarText({ value }: { value: unknown }): string {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  // `JSON.stringify` narrows to `string` for every value that reaches here: `undefined`, a function and
  // a symbol are the three it answers `undefined` for, and each was excluded by the caller's own skip of
  // null and undefined plus the checks above. A column never holds a function.
  return JSON.stringify(value);
}
