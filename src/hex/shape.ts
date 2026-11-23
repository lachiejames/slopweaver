/**
 * Pure shaping over what Hex handed back — filtering a project list by words, bounding a result set for a
 * terminal, and the one correlation the owner asked for by name: which of a result's rows fall inside the
 * window Datadog still holds, and which only Hex can still see.
 *
 * ## The retention split, and why it is a mechanism rather than a sentence
 *
 * Datadog is useful for debugging issues over the last 15 days but not for a full breakdown of who is
 * affected, because that often needs a look beyond 15 days. So a result set with a date column is split at
 * {@link ASSUMED_RETENTION_DAYS} — imported from the Datadog detective rather than restated, so the two
 * halves of the correlation cannot drift apart — and a reader sees three numbers: rows Datadog can still
 * corroborate event-by-event, rows only Hex holds now, and rows whose date this code could not parse. The
 * third bucket is reported rather than folded into either side, because a date that will not parse is not
 * evidence of anything.
 *
 * Nothing here reaches a network or a file. Rows go in as Hex serialised them (every value a string or
 * null) and come out the same way.
 */
import { absentAs } from "#lib/absent.js";
import { ASSUMED_RETENTION_DAYS } from "../datadog/detective/search.js";
import type { HexDataConnection, HexProject, HexTableResult } from "./responses.js";

/**
 * The web app's origin — the same one the atlas's client-bundle census compiled.
 *
 * @internal
 */
export const HEX_APP_ORIGIN = "https://app.hex.tech";

/**
 * The URL a human opens to see a project's app.
 *
 * @param projectId the project's UUID
 * @returns the app URL
 */
export function hexAppUrl({ projectId }: { projectId: string }): string {
  return `${HEX_APP_ORIGIN}/app/${projectId}`;
}

/**
 * What one data connection points at, in the identifiers that NAME the warehouse — a BigQuery project, a
 * Postgres host and database, a Snowflake database.
 *
 * Here rather than in either caller because both the `hex connections` verb and the atlas's entity fill
 * need it and a second copy is how the two would drift apart on what counts as a target. Never a credential:
 * `responses.ts` keeps only the identifier fields, and a key Hex adds to `connectionDetails` tomorrow is
 * refused by name at the boundary rather than carried through.
 *
 * @param connection the connection as Hex describes it
 * @returns the target, or `null` when the row carried no detail this reads
 */
export function hexConnectionTarget({ connection }: { connection: HexDataConnection }): string | null {
  const details = connection.connectionDetails;
  if (details === undefined || details === null) {
    return null;
  }
  const bigqueryProject = details.bigquery?.projectId;
  if (bigqueryProject !== undefined) {
    return `bigquery:${bigqueryProject}`;
  }
  const host = details.postgres?.hostname;
  const database = details.postgres?.database;
  if (host !== undefined || database !== undefined) {
    return `postgres:${absentAs({ value: host, whenAbsent: "?" })}/${absentAs({ value: database, whenAbsent: "?" })}`;
  }
  const snowflakeDatabase = details.snowflake?.database;
  if (snowflakeDatabase !== undefined) {
    return `snowflake:${snowflakeDatabase}`;
  }
  return null;
}

/**
 * The shortest word the project filter will match on. Three, matching the Datadog gate and the store's
 * trigram floor for the same reason: below it containment stops discriminating.
 *
 * @internal
 */
export const MIN_FILTER_WORD_CHARS = 3;

/**
 * The words a project's description adds to the filter haystack. Hex sends `null` for a project nobody has
 * written a description for, and such a project offers no description words to match, so its line is empty.
 */
function descriptionText({ project }: { project: HexProject }): string {
  const { description } = project;
  if (description == null) {
    return "";
  }
  return description;
}

/** Case-insensitive containment. */
function contains({ haystack, needle }: { haystack: string; needle: string }): boolean {
  return haystack.toLowerCase().includes(needle.toLowerCase());
}

/**
 * The projects whose title, description or category names contain EVERY usable word.
 *
 * Every word rather than any, because a caller typing three words is narrowing, and a match on one of them
 * would hand back most of the workspace. Words under {@link MIN_FILTER_WORD_CHARS} are ignored and named in
 * the result so a filter that silently matched everything is visible as one.
 *
 * @param projects the list Hex returned
 * @param words the words to require, as typed
 * @returns the matching projects in their original order, and the words that were too short to count
 */
export function filterProjects({ projects, words }: { projects: readonly HexProject[]; words: readonly string[] }): {
  matched: readonly HexProject[];
  ignored: readonly string[];
} {
  const usable = words.map((word) => word.trim()).filter((word) => word.length >= MIN_FILTER_WORD_CHARS);
  const ignored = words.map((word) => word.trim()).filter((word) => word.length < MIN_FILTER_WORD_CHARS);
  const matched = projects.filter((project) => {
    const haystack = [
      project.title,
      descriptionText({ project }),
      ...project.categories.map((category) => category.name),
    ].join("\n");
    return usable.every((word) => contains({ haystack, needle: word }));
  });
  return { ignored, matched };
}

/** A result set cut down for a reader: the columns asked for, the rows that fit, and what was left out. */
export interface BoundedOutput {
  readonly columns: readonly string[];
  readonly rows: readonly Readonly<Record<string, string | null>>[];
  /** Rows Hex returned that the bound dropped — the reader's own `--limit`, not Hex's. */
  readonly omittedRows: number;
  /** Columns the caller asked for that the result does not carry, named rather than silently absent. */
  readonly missingColumns: readonly string[];
}

/**
 * Bound a table result to `limit` rows and, when asked, to a subset of its columns.
 *
 * @param result the table arm of a cell output
 * @param limit the most rows to keep
 * @param columns the column names to keep, in the order given; omitted keeps every column in Hex's order
 * @returns the bounded rows with what was omitted counted
 */
export function boundOutput({
  result,
  limit,
  columns,
}: {
  result: HexTableResult;
  limit: number;
  columns?: readonly string[];
}): BoundedOutput {
  const available = result.columns.map((column) => column.name);
  const kept = columns === undefined ? available : columns.filter((name) => available.includes(name));
  const missingColumns = columns === undefined ? [] : columns.filter((name) => !available.includes(name));
  const rows = result.rows.slice(0, Math.max(0, limit)).map((row) => {
    const projected: Record<string, string | null> = {};
    for (const name of kept) {
      const value = row[name];
      projected[name] = value === undefined ? null : value;
    }
    return projected;
  });
  return {
    columns: kept,
    missingColumns,
    omittedRows: Math.max(0, result.rows.length - rows.length),
    rows,
  };
}

/** What the retention split came to. */
export interface RetentionSplit {
  /** The window's edge: rows dated on or after this instant are inside what Datadog still holds. */
  readonly edgeIso: string;
  /** The number of days the edge sits before `nowIso` — Datadog's assumed retention, restated for the reader. */
  readonly retentionDays: number;
  /** Rows Datadog can still corroborate event by event. */
  readonly inside: number;
  /** Rows only Hex holds now — the ones the question of who is affected beyond 15 days is about. */
  readonly beyond: number;
  /** Rows whose date column would not parse, or was null. Reported, never folded into a side. */
  readonly unparseable: number;
}

/** Milliseconds in a day, named so the edge arithmetic reads as days. */
const DAY_MS = 86_400_000;

/**
 * Split rows at Datadog's retention edge on one date column.
 *
 * @param rows the rows, values as Hex serialised them
 * @param dateColumn the column holding an ISO-8601 (or otherwise `Date.parse`-able) instant
 * @param nowIso the instant the window is judged against
 * @param retentionDays how many days back Datadog still holds events; defaults to the detective's assumption
 * @returns the three counts and the edge they were judged at
 */
export function retentionSplit({
  rows,
  dateColumn,
  nowIso,
  retentionDays = ASSUMED_RETENTION_DAYS,
}: {
  rows: readonly Readonly<Record<string, string | null>>[];
  dateColumn: string;
  nowIso: string;
  retentionDays?: number;
}): RetentionSplit {
  const now = Date.parse(nowIso);
  const edgeMs = now - retentionDays * DAY_MS;
  let inside = 0;
  let beyond = 0;
  let unparseable = 0;
  for (const row of rows) {
    const raw = row[dateColumn];
    if (raw === undefined || raw === null) {
      unparseable += 1;
      continue;
    }
    const at = Date.parse(raw);
    if (Number.isNaN(at)) {
      unparseable += 1;
    } else if (at >= edgeMs) {
      inside += 1;
    } else {
      beyond += 1;
    }
  }
  return { beyond, edgeIso: new Date(edgeMs).toISOString(), inside, retentionDays, unparseable };
}

/**
 * Render bounded rows as an aligned text table for a terminal.
 *
 * @param output the bounded rows
 * @returns one line per row plus a header and a rule, or one line saying the result is empty
 */
export function renderOutputTable({ output }: { output: BoundedOutput }): readonly string[] {
  if (output.columns.length === 0) {
    return ["(no columns)"];
  }
  const cell = ({ value }: { value: string | null | undefined }): string => absentAs({ value, whenAbsent: "∅" });
  const widths = output.columns.map((name) =>
    Math.max(name.length, ...output.rows.map((row) => cell({ value: row[name] }).length)),
  );
  const widthOf = ({ index, name }: { index: number; name: string }): number => {
    const width = widths[index];
    if (width === undefined) {
      return name.length;
    }
    return width;
  };
  const pad = ({ text, width }: { text: string; width: number }): string => text.padEnd(width);
  const header = output.columns.map((name, index) => pad({ text: name, width: widthOf({ index, name }) })).join("  ");
  const rule = widths.map((width) => "-".repeat(width)).join("  ");
  const lines = output.rows.map((row) =>
    output.columns
      .map((name, index) => pad({ text: cell({ value: row[name] }), width: widthOf({ index, name }) }))
      .join("  "),
  );
  return [header, rule, ...lines];
}
