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
import type { ProjectedRecord } from "./project.js";

/**
 * The facts a rule reads about one projected content record.
 *
 * @param record the projected record about to be written
 * @returns its facts, visibility made effective
 */
export function contentDataClassFacts({ record }: { record: ProjectedRecord }): DataClassFacts {
  const { content } = record;
  const alwaysPrivate =
    isAlwaysPrivateSource({ source: content.source }) || isAlwaysPrivateKind({ kind: content.kind });
  let author: string | null = null;
  if (record.author !== null) {
    author = record.author.nativeId;
  }
  return {
    author,
    container: record.container.nativeId,
    kind: content.kind,
    source: content.source,
    table: "content",
    visibility: alwaysPrivate ? "private" : content.visibility,
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
