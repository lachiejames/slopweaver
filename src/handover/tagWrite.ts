/**
 * What one `handover tag` write REQUESTS, what of it would actually change the row, and which of its values are
 * new to the board — the pure judgements the verb and `register --tag` share.
 *
 * A write states a DESIRED state, not a delta: running it twice leaves the row as once, and a retry after an
 * ambiguous commit is safe. So what is appended is only the part the row does not already
 * hold, judged against EVERYTHING the row holds — an `unrecognised` value included, since a filter still sees it.
 *
 * Pure: no filesystem, no clock. The locked read-then-append is `./tagStore.ts`.
 */

import { levenshteinDistance } from "#lib/editDistance.js";
import { err, ok, type Result } from "#lib/result.js";

import type { RowTag, TagAssignment, TagKeySpec } from "./rowTags.js";
import { parseTagAssignment, TAG_LIST_SEPARATOR } from "./rowTags.js";
import { parseTagDrop, taggedEventProblems } from "./taggedEvent.js";

/** One write as a session asked for it, validated whole and not yet reduced against the row. */
export interface TagRequest {
  readonly set: readonly TagAssignment[];
  readonly drop: readonly string[];
  /** The values the writer acknowledges are new to the board, for a key whose spec asks for that. */
  readonly newValues: readonly TagAssignment[];
}

/** The part of a request that would change the row, and the parts it already satisfies. */
export interface TagChange {
  readonly set: readonly TagAssignment[];
  readonly drop: readonly string[];
  /** Each assignment or drop the row already satisfies, as written — reported, never appended. */
  readonly satisfied: readonly string[];
}

/** The entries of one comma-separated flag, empty when the flag was not passed. */
function listed({ text }: { text: string | undefined }): readonly string[] {
  if (text === undefined) {
    return [];
  }
  return text.split(TAG_LIST_SEPARATOR);
}

/** Every `key=value` in a list, or one message per entry that is not one a session may write. */
function assignmentsOf({ texts }: { texts: readonly string[] }): {
  readonly assignments: readonly TagAssignment[];
  readonly problems: readonly string[];
} {
  const assignments: TagAssignment[] = [];
  const problems: string[] = [];
  for (const text of texts) {
    const parsed = parseTagAssignment({ text });
    if (parsed.isErr()) {
      problems.push(parsed.error.message);
    } else {
      assignments.push(parsed.value);
    }
  }
  return { assignments, problems };
}

/**
 * Read one write's arguments into a request, refusing it WHOLE when any part is wrong: validation runs on the
 * request as typed, before anything the row already holds reduces it, so a contradiction inside it is refused
 * even when half of it would have been a no-op.
 *
 * @param assignments the `key=value` positionals to set
 * @param drops the `--drop` flag's comma-separated keys or `key=value`s
 * @param newValues the `--new-value` flag's comma-separated `key=value`s
 * @returns the request, or every problem with it
 */
export function parseTagRequest({
  assignments,
  drops,
  newValues,
}: {
  assignments: readonly string[];
  drops: string | undefined;
  newValues: string | undefined;
}): Result<TagRequest> {
  const set = assignmentsOf({ texts: assignments });
  const acknowledged = assignmentsOf({ texts: listed({ text: newValues }) });
  const drop: string[] = [];
  const problems = [...set.problems, ...acknowledged.problems];
  for (const text of listed({ text: drops })) {
    const parsed = parseTagDrop({ text });
    if (parsed.isErr()) {
      problems.push(parsed.error.message);
    } else {
      drop.push(parsed.value);
    }
  }
  if (problems.length > 0) {
    return err(problems);
  }
  const eventProblems = taggedEventProblems({ drop, set: set.assignments });
  if (eventProblems.length > 0) {
    return err(eventProblems);
  }
  return ok({ drop, newValues: acknowledged.assignments, set: set.assignments });
}

/** Every value a row holds under each key, whatever the value's source. */
function holdingsOf({ held }: { held: readonly RowTag[] }): ReadonlyMap<string, readonly string[]> {
  const holdings = new Map<string, string[]>();
  for (const tag of held) {
    const values = holdings.get(tag.key);
    if (values === undefined) {
      holdings.set(tag.key, [tag.value]);
    } else {
      values.push(tag.value);
    }
  }
  return holdings;
}

/** The values one key holds, empty when it holds none. */
function valuesUnder({
  holdings,
  key,
}: {
  holdings: ReadonlyMap<string, readonly string[]>;
  key: string;
}): readonly string[] {
  const values = holdings.get(key);
  if (values === undefined) {
    return [];
  }
  return values;
}

/** Whether a row already holds one assignment: exactly `[v]` for a one-valued key, `v` among several otherwise. */
function assignmentHeld({
  assignment,
  holdings,
  oneValued,
}: {
  assignment: TagAssignment;
  holdings: ReadonlyMap<string, readonly string[]>;
  oneValued: ReadonlySet<string>;
}): boolean {
  const values = valuesUnder({ holdings, key: assignment.key });
  if (oneValued.has(assignment.key)) {
    return values.length === 1 && values[0] === assignment.value;
  }
  return values.includes(assignment.value);
}

/** Whether a drop would remove anything: a whole key that holds a value, or a `k=v` whose value is held. */
function dropRemoves({ holdings, text }: { holdings: ReadonlyMap<string, readonly string[]>; text: string }): boolean {
  const at = text.indexOf("=");
  if (at < 0) {
    return valuesUnder({ holdings, key: text }).length > 0;
  }
  return valuesUnder({ holdings, key: text.slice(0, at) }).includes(text.slice(at + 1));
}

/**
 * The part of a request that would change the row.
 *
 * A one-valued `set k=v` is satisfied only when `k` holds exactly `[v]`: a row holding `[v, other]` is ambiguous,
 * and writing `v` is what settles it. A many-valued set is satisfied when `v` is held; a whole-key drop when the
 * key holds nothing; a `k=v` drop when `v` is not held.
 *
 * @param held every tag the row holds — declared and unrecognised, never derived
 * @param request the validated request
 * @param oneValued the keys that hold one value
 * @returns what to append, and what was already so
 */
export function effectiveTagChange({
  held,
  request,
  oneValued,
}: {
  held: readonly RowTag[];
  request: Pick<TagRequest, "drop" | "set">;
  oneValued: ReadonlySet<string>;
}): TagChange {
  const holdings = holdingsOf({ held: held.filter((tag) => tag.source !== "derived") });
  const set = request.set.filter((assignment) => !assignmentHeld({ assignment, holdings, oneValued }));
  const drop = request.drop.filter((text) => dropRemoves({ holdings, text }));
  const satisfied = [
    ...request.set
      .filter((assignment) => !set.includes(assignment))
      .map((assignment) => `${assignment.key}=${assignment.value}`),
    ...request.drop.filter((text) => !drop.includes(text)).map((text) => `--drop ${text}`),
  ];
  return { drop, satisfied, set };
}

/**
 * The keys whose new values need `--new-value`, read from the registry rather than named here, so a key that opts
 * in is guarded by that one field.
 *
 * @param specs the registry, or a synthetic one in a test
 * @returns the guarded keys
 */
export function guardedKeys({ specs }: { specs: readonly TagKeySpec[] }): ReadonlySet<string> {
  return new Set(specs.filter((spec) => spec.newValueNeedsFlag === true).map((spec) => spec.key));
}

/**
 * Every value of a guarded key the board's rows DECLARE — the set a value must be in to count as existing.
 * `unrecognised` values are left out: a spelling the registry refuses is not a precedent for writing it again.
 *
 * @param rows each readable row's declared tags
 * @param guarded the keys to collect
 * @returns each guarded key's values across the board
 */
export function boardValues({
  rows,
  guarded,
}: {
  rows: readonly (readonly RowTag[])[];
  guarded: ReadonlySet<string>;
}): ReadonlyMap<string, ReadonlySet<string>> {
  const values = new Map<string, Set<string>>([...guarded].map((key) => [key, new Set<string>()]));
  for (const tag of rows.flat()) {
    if (tag.source === "declared") {
      values.get(tag.key)?.add(tag.value);
    }
  }
  return values;
}

/** The furthest an existing value may be from a new one and still be named as the likely intent. */
const NEAREST_VALUE_DISTANCE = 2;

/** The existing value closest to a new one, as a hint, or an empty string when none is close. */
function nearestHint({ value, among }: { value: string; among: ReadonlySet<string> | undefined }): string {
  if (among === undefined) {
    return "";
  }
  const ranked = [...among]
    .map((candidate) => ({ candidate, distance: levenshteinDistance({ left: value, right: candidate }) }))
    .filter((each) => each.distance <= NEAREST_VALUE_DISTANCE)
    .toSorted((left, right) => left.distance - right.distance || left.candidate.localeCompare(right.candidate));
  const [best] = ranked;
  return best === undefined ? "" : ` — did you mean ${best.candidate}?`;
}

/**
 * Why the guarded values in a change may not be written as they stand, empty when they may.
 *
 * A value no readable row carries needs `--new-value` naming it. The acknowledgement is itself checked, so it
 * cannot become a blanket bypass: it must name a guarded key and a value this write sets. One naming a value that
 * is no longer new is REDUNDANT, never refused — an ambiguous first attempt may have committed it, or another
 * writer minted it meanwhile, and the one recovery command has to be right in both worlds.
 *
 * @param request the validated request, as typed
 * @param change what of it would change the row
 * @param existing each guarded key's values across the board
 * @param guarded the keys whose new values need acknowledging
 * @param unreadableJournals how many rows' journals could not be read, so a refusal never claims certainty
 * @returns one message per problem, and each acknowledgement that turned out redundant
 */
export function newValueProblems({
  request,
  change,
  existing,
  guarded,
  unreadableJournals,
}: {
  request: TagRequest;
  change: TagChange;
  existing: ReadonlyMap<string, ReadonlySet<string>>;
  guarded: ReadonlySet<string>;
  unreadableJournals: number;
}): { readonly problems: readonly string[]; readonly redundant: readonly string[] } {
  const isKnown = (assignment: TagAssignment): boolean => existing.get(assignment.key)?.has(assignment.value) === true;
  const same = (left: TagAssignment) => (right: TagAssignment) => left.key === right.key && left.value === right.value;
  const caveat =
    unreadableJournals > 0
      ? ` (${String(unreadableJournals)} row journal(s) could not be read, so it may exist there)`
      : "";
  const problems: string[] = [];
  const redundant: string[] = [];
  for (const assignment of change.set.filter((each) => guarded.has(each.key))) {
    if (!isKnown(assignment) && !request.newValues.some(same(assignment))) {
      problems.push(
        `${assignment.key}=${assignment.value} is new — no row on the board carries it${caveat}${nearestHint({ among: existing.get(assignment.key), value: assignment.value })}; pass --new-value ${assignment.key}=${assignment.value} if it is meant`,
      );
    }
  }
  for (const acknowledged of request.newValues) {
    const text = `${acknowledged.key}=${acknowledged.value}`;
    if (!guarded.has(acknowledged.key)) {
      problems.push(
        `--new-value ${text}: ${acknowledged.key} takes any valid value, so there is nothing to acknowledge`,
      );
    } else if (!request.set.some(same(acknowledged))) {
      problems.push(`--new-value ${text} names a value this write does not set`);
    } else if (isKnown(acknowledged)) {
      redundant.push(text);
    }
  }
  return { problems, redundant };
}
