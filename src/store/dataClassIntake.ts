/**
 * Classify a content row at intake: read its facts off the projected record and sort them by the rules. Pure; the
 * rules are loaded once per run beside the exclusion lists (`./ingest.ts`'s `loadExclusionLists`).
 *
 * Visibility is the record's EFFECTIVE read scope, so a mailbox, calendar or recorded-call row reads `private`
 * whether or not its bronze line carried the mark (`../corpus/visibility.ts`); a rule matching `private` therefore
 * sees every always-private source, not only the ones stamped at projection.
 */
import { isAlwaysPrivateKind, isAlwaysPrivateSource } from "../corpus/visibility.js";

import type { DataClass } from "./dataClass.js";
import { type DataClassFacts, type DataClassRule, sortDataClass, storedDataClass } from "./dataClassRules.js";
import type { ProjectedContent, ProjectedRecord } from "./project.js";

/**
 * The fields of one content row a rule's facts are built from, whether the row is about to be written or is
 * already stored: `store classify` reads the same five back out of the store and builds them here too.
 */
export interface ContentDataClassFactFields {
  readonly source: ProjectedContent["source"];
  readonly kind: ProjectedContent["kind"];
  readonly visibility: ProjectedContent["visibility"];
  /** The container's native id, as the container row stores it; null for a row stored against none. */
  readonly container: string | null;
  /** The author's native id, as `content.author_native_id` stores it. */
  readonly author: string | null;
}

/**
 * The facts a rule reads about one content row, from its plain fields. The one place the always-private fold
 * happens, so intake and the backfill of stored rows cannot sort the same row two ways.
 *
 * @param visibility the row's stored read scope, overridden to private for an always-private source or kind
 * @returns its facts, visibility made effective
 */
export function contentDataClassFactsFromFields({
  source,
  kind,
  visibility,
  container,
  author,
}: ContentDataClassFactFields): DataClassFacts {
  const alwaysPrivate = isAlwaysPrivateSource({ source }) || isAlwaysPrivateKind({ kind });
  return { author, container, kind, source, table: "content", visibility: alwaysPrivate ? "private" : visibility };
}

/**
 * The facts a rule reads about one projected content record.
 *
 * @param record the projected record about to be written
 * @returns its facts, visibility made effective
 */
export function contentDataClassFacts({ record }: { record: ProjectedRecord }): DataClassFacts {
  const { content } = record;
  let author: string | null = null;
  if (record.author !== null) {
    author = record.author.nativeId;
  }
  return contentDataClassFactsFromFields({
    author,
    container: record.container.nativeId,
    kind: content.kind,
    source: content.source,
    visibility: content.visibility,
  });
}

/**
 * The facts a rule reads about one `owner_capture` row. The table is denied to the bot outright, so its effective
 * scope is `private`; it names no kind, container or author.
 *
 * @param source the capturing app the row names
 * @returns its facts
 */
export function ownerCaptureDataClassFacts({ source }: { source: string }): DataClassFacts {
  return { author: null, container: null, kind: null, source, table: "owner_capture", visibility: "private" };
}

/** The `source` an `owner_turn` row's facts carry: the table has no source column, and a rule may still name one. */
export const OWNER_TURN_FACT_SOURCE = "owner-turn";

/**
 * The facts a rule reads about one `owner_turn` body: the owner's words a supervisor seat wrote down, denied to the
 * bot outright, so `private`, under the one source value `owner-turn`.
 *
 * @returns its facts
 */
export function ownerTurnDataClassFacts(): DataClassFacts {
  return {
    author: null,
    container: null,
    kind: null,
    source: OWNER_TURN_FACT_SOURCE,
    table: "owner_turn",
    visibility: "private",
  };
}

/**
 * The data class one projected content record is written with.
 *
 * @param record the projected record about to be written
 * @param rules the run's composed rules
 * @returns its class: the rule's, or `unknown` when it needs assessment or no rule matched
 */
export function contentDataClass({
  record,
  rules,
}: {
  record: ProjectedRecord;
  rules: readonly DataClassRule[];
}): DataClass {
  return storedDataClass({ outcome: sortDataClass({ facts: contentDataClassFacts({ record }), rules }) });
}
