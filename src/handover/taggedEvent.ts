/**
 * One `tagged` journal event, judged whole: the drops it names and every problem it would carry onto the journal.
 * The registry and the one-assignment validator it leans on are `./rowTags.ts`; this is the event built from them.
 */

import { err, ok, type Result } from "#lib/result.js";

import { type RowTagError, RowTagErrors } from "./rowTagErrors.js";
import {
  derivedFromOf,
  knownKey,
  parseTagAssignment,
  TAG_KEYS,
  type TagAssignment,
  tagKeySpec,
  writableAssignment,
} from "./rowTags.js";

/**
 * Read one DROP a session wants to write: a whole declared key, or `key=value` to drop one value of a key that
 * holds several. A one-valued key is dropped whole: `impact=high` as a drop would be a no-op the moment the value
 * had moved, and the grammar says what it removes rather than guessing.
 *
 * @param text `workstream`, or `workstream=iso-certification`
 * @returns the drop as written, or why it names nothing that could be carried
 */
export function parseTagDrop({ text }: { text: string }): Result<string, RowTagError> {
  const trimmed = text.trim();
  if (!trimmed.includes("=")) {
    return knownKey({ key: trimmed }).andThen((spec) =>
      spec.source === "derived"
        ? err(RowTagErrors.derivedKey({ from: derivedFromOf({ spec }), key: spec.key }))
        : ok(trimmed),
    );
  }
  return parseTagAssignment({ text: trimmed }).andThen((assignment) => {
    if (tagKeySpec({ key: assignment.key })?.cardinality === "one") {
      return err(RowTagErrors.valueDropOnOne({ key: assignment.key }));
    }
    return ok(trimmed);
  });
}

/** Each assignment and each drop judged on its own: the problems of one entry, before any are compared. */
function entryProblems({ set, drop }: { set: readonly TagAssignment[]; drop: readonly string[] }): string[] {
  const problems: string[] = [];
  // A padded DROP is refused here: `parseTagDrop` reads what a session typed, and trims it, while the journal
  // keeps the untrimmed text. A padded SET pair is `writableAssignment`'s own refusal, below.
  for (const text of drop.filter((each) => each !== each.trim())) {
    problems.push(RowTagErrors.padded({ text }).message);
  }
  for (const assignment of set) {
    const written = writableAssignment({ assignment });
    if (written.isErr()) {
      problems.push(written.error.message);
    }
  }
  for (const text of drop) {
    const dropped = parseTagDrop({ text });
    if (dropped.isErr()) {
      problems.push(dropped.error.message);
    }
  }
  return problems;
}

/**
 * Every problem one `tagged` event would carry onto the journal, empty when it is well-formed.
 *
 * @param set the assignments the event writes
 * @param drop the keys, or single values, it removes
 * @returns one message per problem
 */
export function taggedEventProblems({
  set,
  drop,
}: {
  set: readonly TagAssignment[];
  drop: readonly string[];
}): readonly string[] {
  const problems = entryProblems({ drop, set });
  for (const key of overlapping({ drop, set })) {
    problems.push(RowTagErrors.setAndDropped({ key }).message);
  }
  for (const spec of TAG_KEYS.filter((each) => each.cardinality === "one")) {
    if (set.filter((assignment) => assignment.key === spec.key).length > 1) {
      problems.push(RowTagErrors.setTwice({ key: spec.key }).message);
    }
  }
  for (const text of repeated({
    texts: [...set.map((each) => `${each.key}=${each.value}`), ...drop.map((each) => `--drop ${each}`)],
  })) {
    problems.push(RowTagErrors.repeated({ text }).message);
  }
  if (set.length === 0 && drop.length === 0) {
    problems.push("a tagged event must set or drop at least one tag");
  }
  return problems;
}

/**
 * Each entry one event carries more than once. Refused rather than collapsed: the journal line would record more
 * than the write did, and a receipt could not say which copy was the satisfied one.
 */
function repeated({ texts }: { texts: readonly string[] }): readonly string[] {
  return [...new Set(texts.filter((text, at) => texts.indexOf(text) !== at))];
}

/**
 * The keys one event both sets and drops. Refused rather than ordered: which half wins would be a rule nobody
 * reading the journal line could see, and `handover tag` can always say it in two writes.
 */
function overlapping({ set, drop }: { set: readonly TagAssignment[]; drop: readonly string[] }): readonly string[] {
  const dropped = new Set(drop.map((text) => (text.includes("=") ? text.slice(0, text.indexOf("=")) : text)));
  return [...new Set(set.map((assignment) => assignment.key))].filter((key) => dropped.has(key));
}
