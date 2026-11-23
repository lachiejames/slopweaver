/**
 * The record head every disclosure verb selects, and how a driver row becomes one.
 *
 * Carved out of {@link ./disclose} along its one real seam: the three joins and columns are the same for
 * `hits`, `peek`, `open` and `around`, and what a row's head IS (which fields, which of them may be null)
 * is decided here once. `authorNativeId` sits beside `author` because the two answer different questions —
 * the name to print, and the platform id a picture is joined on (`identity avatars --ids`).
 */

import { type SQL, sql } from "drizzle-orm";

import { numberOf, optionalText, requireText } from "./rows.js";

/** One record as every disclosure verb identifies it. */
export interface RecordHead {
  readonly id: string;
  readonly source: string;
  readonly sourceId: string;
  readonly kind: string;
  readonly url: string;
  readonly occurredAt: string;
  readonly title: string | null;
  readonly author: string | null;
  /**
   * What the platform said authored it — a Slack member id, a GitHub login — whether or not a person
   * resolved. The join key for a picture (`identity avatars`); `author` is the name to print.
   */
  readonly authorNativeId: string | null;
  readonly container: string | null;
}

/** One record, with just enough of its text to decide whether to open it. */
export interface RecordPeek extends RecordHead {
  /** The window, centred on the match where one was named. */
  readonly excerpt: string;
  /** Where the window starts in the body, so a caller can ask for the next one. */
  readonly from: number;
  /** How long the whole body is, so "this is all of it" and "this is a slice" stay apart. */
  readonly bodyChars: number;
}

/** One record, whole. */
export interface RecordOpen extends RecordHead {
  readonly body: string;
  /** The URLs this record's text linked to, as ingest extracted them. */
  readonly refs: readonly string[];
}

/** The three joins and the columns every disclosure verb selects. */
export const HEAD_COLUMNS: SQL = sql`
  content.id::text as id,
  content.source::text as source,
  content.source_id as "sourceId",
  content.kind::text as kind,
  content.url as url,
  to_char(content.occurred_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as "occurredAt",
  content.title as title,
  coalesce(person.display_name, content.author_native_id) as author,
  content.author_native_id as "authorNativeId",
  container.native_id as container
`;

/** The two left joins that resolve a record's author and container to names. */
export const HEAD_JOINS: SQL = sql`
  left join container on container.id = content.container_id
  left join person on person.id = content.author_id
`;

/**
 * The most a peek will ever show of one record, whatever the caller asks for.
 *
 * @internal
 */
export const MAX_PEEK_CHARS = 4000;

/**
 * Read a head off a driver row.
 *
 * @param row one row as the driver returned it
 * @returns the record's identity
 */
export function headOf({ row }: { row: Record<string, unknown> }): RecordHead {
  return {
    author: optionalText({ key: "author", row }),
    authorNativeId: optionalText({ key: "authorNativeId", row }),
    container: optionalText({ key: "container", row }),
    id: requireText({ key: "id", row }),
    kind: requireText({ key: "kind", row }),
    occurredAt: requireText({ key: "occurredAt", row }),
    source: requireText({ key: "source", row }),
    sourceId: requireText({ key: "sourceId", row }),
    title: optionalText({ key: "title", row }),
    url: requireText({ key: "url", row }),
  };
}

/**
 * The ids a disclosure verb was given, bound as one array parameter rather than a list of placeholders.
 *
 * @returns the \`uuid[]\` parameter
 */
export function idArray({ ids }: { ids: readonly string[] }): SQL {
  return sql`${sql.param([...ids])}::uuid[]`;
}

/**
 * Read a peek off a driver row.
 *
 * @param row one row as the driver returned it
 * @returns the record and its window
 */
export function peekOf({ row }: { row: Record<string, unknown> }): RecordPeek {
  return {
    ...headOf({ row }),
    bodyChars: numberOf({ key: "bodyChars", row }),
    excerpt: requireText({ key: "excerpt", row }),
    from: numberOf({ key: "from", row }),
  };
}
