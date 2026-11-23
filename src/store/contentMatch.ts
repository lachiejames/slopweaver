/**
 * Whether the store holds a row AS a bronze record says it should — its kind, title, body, visibility and one named
 * attribute, not merely its key.
 *
 * `./contentPresence.ts` answers "is a row under this `(source, source_id)` there at all", which is the right
 * question for a drift report and the wrong one for a caller about to act on the row's CONTENT. Bronze appends a
 * new version of a record whose content changed under the same `sourceId`, and the store holds whichever version
 * it last replayed — so a key probe passes over a stale row exactly when the row is stale.
 *
 * The body is compared as an md5 digest computed BY the database, so the probe never pulls a body over the wire.
 * md5 is a change detector here, never a security boundary: both sides hash the same redacted bronze text. The
 * attribute is the one fact a caller proved a record by beyond those (a meeting's date, say), read from where
 * `./project.ts` keeps an unclaimed attribute: `metadata.attrs.<key>`.
 */
import { createHash } from "node:crypto";

import { and, eq, inArray, sql } from "drizzle-orm";

import type { CorpusRecord } from "../corpus/types.js";
import { err, ok, type Result } from "../lib/result.js";

import type { StoreClient } from "./client.js";
import { presenceBatches } from "./contentPresence.js";
import { type StoreError, StoreErrors } from "./errors.js";
import { type ContentRow, contentTable } from "./schema/content.js";

/** The facts a stored content row is matched on. */
export interface StoredContentFacts {
  readonly sourceId: string;
  readonly kind: string;
  readonly title: string | null;
  /** The lowercase hex md5 of the body. */
  readonly bodyMd5: string;
  /** The named attribute's value as text, or `null` when the row carries none. */
  readonly attr: string | null;
  /** Who may read the row: the axis every row-level security policy turns on. */
  readonly visibility: ContentRow["visibility"];
}

/**
 * The facts the store's projection would write for one bronze record. Pure.
 *
 * Mirrors `./project.ts`: the body is the record's text, an absent title is stored as `null`, an unclaimed attribute
 * keeps its value, and an unstamped record is stored `public`.
 *
 * @param record the bronze record the store should hold
 * @param attrKey the one attribute compared beside kind, title and body
 * @returns the facts its stored row must carry
 */
export function contentFactsOf({ record, attrKey }: { record: CorpusRecord; attrKey: string }): StoredContentFacts {
  let title: string | null = null;
  if (record.title !== undefined) {
    title = record.title;
  }
  let attr: string | null = null;
  const value = record.attrs?.[attrKey];
  if (typeof value === "string") {
    attr = value;
  }
  let visibility: ContentRow["visibility"] = "public";
  if (record.visibility !== undefined) {
    visibility = record.visibility;
  }
  return {
    attr,
    bodyMd5: createHash("md5").update(record.text, "utf8").digest("hex"),
    kind: record.kind,
    sourceId: record.sourceId,
    title,
    visibility,
  };
}

/**
 * The ids whose stored row carries every fact expected of it. Pure.
 *
 * @param expected what bronze says each row should be
 * @param stored what the store holds, keyed by source id
 * @returns the source ids that match, kind, title, body, attribute and visibility alike
 */
export function matchingContentIds({
  expected,
  stored,
}: {
  expected: readonly StoredContentFacts[];
  stored: ReadonlyMap<string, StoredContentFacts>;
}): ReadonlySet<string> {
  const matching = new Set<string>();
  for (const facts of expected) {
    const row = stored.get(facts.sourceId);
    if (
      row !== undefined &&
      row.kind === facts.kind &&
      row.title === facts.title &&
      row.bodyMd5 === facts.bodyMd5 &&
      row.attr === facts.attr &&
      row.visibility === facts.visibility
    ) {
      matching.add(facts.sourceId);
    }
  }
  return matching;
}

/**
 * The matched facts of every stored row under `sourceIds` for one source, the body hashed by the database.
 *
 * @param client the open store
 * @param source which source rows to read
 * @param sourceIds the native ids to read, in any order
 * @param attrKey the one attribute read from `metadata.attrs`
 * @returns the facts per source id present, or the typed database failure
 */
export async function readStoredContentFacts({
  attrKey,
  client,
  source,
  sourceIds,
}: {
  attrKey: string;
  client: StoreClient;
  source: ContentRow["source"];
  sourceIds: readonly string[];
}): Promise<Result<ReadonlyMap<string, StoredContentFacts>, StoreError>> {
  const stored = new Map<string, StoredContentFacts>();
  try {
    for (const batch of presenceBatches({ sourceIds })) {
      const rows = await client.db
        .select({
          attr: sql<string | null>`${contentTable.metadata} -> 'attrs' ->> ${attrKey}`,
          bodyMd5: sql<string>`md5(${contentTable.body})`,
          kind: contentTable.kind,
          sourceId: contentTable.sourceId,
          title: contentTable.title,
          visibility: contentTable.visibility,
        })
        .from(contentTable)
        .where(and(eq(contentTable.source, source), inArray(contentTable.sourceId, [...batch])));
      rows.forEach((row) => stored.set(row.sourceId, row));
    }
  } catch (error: unknown) {
    return err(StoreErrors.queryFailed({ cause: error, what: "store content match probe" }));
  }
  return ok(stored);
}
