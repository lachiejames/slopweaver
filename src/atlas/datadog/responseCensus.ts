/**
 * A structural census of Datadog answers — every key path, its JSON kinds and how often it was present, per
 * admitted operation — and NEVER a value. It is what `tools/generateDatadogResponseBoundaries.ts` declares each
 * operation's strict boundary from, and `tools/datadogResponseCensus.ts` takes it against the live organisation.
 *
 * How a path is written and which keys are normalised is the kit's (`../kit/responseStructure.ts`), shared with
 * JumpCloud's census so the two read structure identically. What is Datadog's is the tally around it: statuses,
 * and the kind of root each 2xx answer arrived as — an object, an array, an empty body, or a body that is not JSON
 * at all, which is how the operations the pinned specification declares as a file download show up.
 *
 * ## One census is one run
 *
 * A census carries the instant it was taken and is never merged with an earlier one. A key that was required in
 * an earlier run and is absent in this one is drift, and a union of runs would read it as optional instead.
 */
import { z } from "zod";

import { parseJson } from "#lib/jsonParse.js";
import { err, ok, type Result } from "#lib/result.js";
import { safeJsonParse } from "#lib/safeJson.js";

import {
  bumpCensusCount,
  observeResponseStructure,
  ownCensusEntry,
  RESPONSE_CENSUS_COUNTS,
  RESPONSE_JSON_KINDS,
  RESPONSE_PATH_CENSUS_FILE,
  type ResponseStructure,
  responseCensusKey,
  responseCensusKeyShape,
  responseJsonKind,
} from "../kit/responseStructure.js";

/** One operation's tally: the kit's structure, plus its statuses and the root each 2xx answer arrived as. */
export interface DatadogOperationCensus extends ResponseStructure {
  /** Answers by HTTP status; `none` when the request never reached Datadog. */
  statuses: Record<string, number>;
  /** 2xx answers by root: a JSON kind, `empty-text`, or `non-json`. */
  roots: Record<string, number>;
}

/** One census run across the admitted operations. */
export interface DatadogResponseCensus {
  /** The instant the run started, so a boundary generated from it says how old its evidence is. */
  takenAt: string;
  /** Each operation's tally, by registry name. */
  operations: Record<string, DatadogOperationCensus>;
}

/**
 * A count of something seen, which this module only ever starts at one. A zero would read as a kind measured or an
 * object counted that never was, so the generator would declare it.
 */
const SEEN = RESPONSE_CENSUS_COUNTS.refine(
  (counts) => Object.values(counts).every((n) => Number.isSafeInteger(n) && n > 0),
  {
    message: "a count of zero, a fraction or one too large to hold exactly, which this census never writes",
  },
);

/** Every root a 2xx answer is counted as: a JSON kind, or a body that was empty or not JSON. */
const ROOT_KINDS: ReadonlySet<string> = new Set([...RESPONSE_JSON_KINDS, "empty-text", "non-json"]);

/** The roots counted, each a root this module writes; any other name would be listed as a kind no answer had. */
const ROOTS_SEEN = SEEN.refine((counts) => Object.keys(counts).every((root) => ROOT_KINDS.has(root)), {
  message: "a root this census never writes: neither a JSON kind, empty-text nor non-json",
});

/** One key path's tally, its presence and every kind count seen at least once, its empty arrays counted from zero. */
const PATH_SEEN = RESPONSE_PATH_CENSUS_FILE.refine(
  (entry) =>
    [entry.present, ...Object.values(entry.kinds)].every((n) => Number.isSafeInteger(n) && n > 0) &&
    Number.isSafeInteger(entry.emptyArrays) &&
    entry.emptyArrays >= 0,
  {
    message: "a path present, or of a kind, zero times, or a count no run could write, which this census never writes",
  },
);

/** A status the census reads a body for: a 2xx, written the way {@link observeDatadogAnswer} keys it. */
const SUCCESS = /^2\d\d$/;

/** How many times one kind was counted at a path, the root's read from its root tally; zero when never. */
function kindCount({
  operation,
  path,
  kind,
}: {
  operation: DatadogOperationCensus;
  path: string;
  kind: "array" | "object";
}): number {
  const counts = path === "" ? operation.roots : ownCensusEntry({ key: path, record: operation.paths })?.kinds;
  const count = counts === undefined ? undefined : ownCensusEntry<number>({ key: kind, record: counts });
  if (count === undefined) {
    return 0;
  }
  return count;
}

/**
 * Whether every key in a recorded path is one the kit's walker writes: a placeholder, or a key it records as
 * itself. A raw `constructor` or `a.b` is a key the walker would have recorded as `<unsafe>`.
 */
function writablePath({ path }: { path: string }): boolean {
  return path.split(".").every((segment, index) => {
    const key = segment.replace(/(\[\])+$/, "");
    if (key === "") {
      return index === 0 && segment !== "";
    }
    const placeholder = key === "<unsafe>" || responseCensusKeyShape({ placeholder: key }) !== null;
    return placeholder || responseCensusKey({ key }) === key;
  });
}

/**
 * Every way one operation's tally contradicts itself, which no run of this module can write: a raw key the walker
 * records only under a placeholder, a path whose presence
 * is not the sum of its kinds, a key under no counted object or a field name on more objects than its parent
 * counted (a placeholder holds every key of its shape, so it may count more), an item under no counted array,
 * an object count that is not the `object` kind counted at its path, more empty arrays than arrays, roots counted
 * other than once per 2xx answer (a failed call's body is never read), or a count negative or so large that a sum
 * of them no longer adds exactly. A generator reading any of them would declare a shape no answer had, or miss one
 * an answer did.
 *
 * @returns one line per contradiction, naming its path; empty when the tally is consistent
 */
export function datadogCensusContradictions({ operation }: { operation: DatadogOperationCensus }): readonly string[] {
  const found: string[] = [];
  const successes = Object.entries(operation.statuses)
    .filter(([status]) => SUCCESS.test(status))
    .reduce((sum, [, n]) => sum + n, 0);
  const rooted = Object.values(operation.roots).reduce((sum, n) => sum + n, 0);
  if (rooted !== successes) {
    found.push(`(operation): ${String(rooted)} roots counted against ${String(successes)} 2xx answers`);
  }
  for (const [path, entry] of Object.entries(operation.paths)) {
    found.push(...pathContradictions({ entry, operation, path }));
  }
  const counted = new Set([...Object.keys(operation.objects), ...Object.keys(operation.paths), ""]);
  for (const path of counted) {
    const objects = ownCensusEntry({ key: path, record: operation.objects });
    const kind = kindCount({ kind: "object", operation, path });
    const disagrees = objects === undefined ? kind !== 0 : objects !== kind;
    if (disagrees) {
      found.push(`${path === "" ? "(root)" : path}: objects counted apart from the object kind counted there`);
    }
  }
  if (!countsExact({ operation })) {
    found.push("(operation): counts summing past the largest integer a number holds exactly, which no fold reads");
  }
  return found;
}

/** Every way one recorded path contradicts its own counts or its parent's, for {@link datadogCensusContradictions}. */
function pathContradictions({
  operation,
  path,
  entry,
}: {
  operation: DatadogOperationCensus;
  path: string;
  entry: DatadogOperationCensus["paths"][string];
}): readonly string[] {
  const found: string[] = [];
  if (!writablePath({ path })) {
    found.push(`${path}: a key the census records only under a placeholder`);
  }
  const kinds = Object.values(entry.kinds).reduce((sum, n) => sum + n, 0);
  if (kinds !== entry.present) {
    found.push(`${path}: present ${String(entry.present)} times but its kinds count ${String(kinds)}`);
  }
  if (entry.emptyArrays > kindCount({ kind: "array", operation, path })) {
    found.push(`${path}: more empty arrays counted than arrays`);
  }
  if (path.endsWith("[]")) {
    const arrays = kindCount({ kind: "array", operation, path: path.slice(0, -2) });
    return arrays === 0 ? [...found, `${path}: items under a path no array was counted at`] : found;
  }
  const cut = path.lastIndexOf(".");
  const objects = ownCensusEntry({ key: path.slice(0, Math.max(cut, 0)), record: operation.objects });
  // Every key one object carries that a placeholder records is counted under it, so only a field name is bounded.
  const placeholder = path.slice(cut + 1).startsWith("<");
  if (objects === undefined || (!placeholder && entry.present > objects)) {
    found.push(`${path}: present on more objects than its parent counted`);
  }
  return found;
}

/** Whether every count is a non-negative safe integer and their total is one too, for {@link datadogCensusContradictions}. */
function countsExact({ operation }: { operation: DatadogOperationCensus }): boolean {
  // Every sum the generator takes (a map's keys folded together, a path's kinds) adds a subset of these counts, and
  // a sum of integers stays exact until it first passes the largest safe integer, so bounding the total bounds all.
  const counts = [
    ...Object.values(operation.objects),
    ...Object.values(operation.roots),
    ...Object.values(operation.statuses),
    ...Object.values(operation.paths).flatMap((entry) => [
      entry.present,
      entry.emptyArrays,
      ...Object.values(entry.kinds),
    ]),
  ];
  // A negative count would cancel an oversized one out of the total, so each is bounded below as well.
  const whole = counts.every((n) => Number.isSafeInteger(n) && n >= 0);
  return whole && Number.isSafeInteger(counts.reduce((sum, n) => sum + n, 0));
}

/** One operation's tally as this module writes it, refused when it contradicts itself. */
const OPERATION_FILE = z
  .strictObject({
    objects: SEEN,
    paths: z.record(z.string(), PATH_SEEN),
    roots: ROOTS_SEEN,
    statuses: SEEN,
  })
  .superRefine((operation, ctx) => {
    for (const message of datadogCensusContradictions({ operation })) {
      ctx.addIssue({ code: "custom", message });
    }
  });

/** The census exactly as this module writes it, so a file of any other shape is refused when it is read back. */
const CENSUS_FILE = z.strictObject({
  operations: z.record(z.string(), OPERATION_FILE),
  takenAt: z.iso.datetime(),
});

/**
 * Read a census file back for the generator, refusing one that is not the shape this module writes rather than
 * declaring boundaries from whatever it holds.
 *
 * @param text the census file's whole text
 * @returns the census, or one line per place the file departs from the census shape
 */
export function parseDatadogResponseCensus({ text }: { text: string }): Result<DatadogResponseCensus> {
  const parsed = CENSUS_FILE.safeParse(safeJsonParse({ label: "the Datadog response census", text }));
  if (!parsed.success) {
    return err(parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`));
  }
  return ok(parsed.data);
}

/** One operation's tally, opened empty the first time the operation answers. */
function operationEntry({
  census,
  surface,
}: {
  census: DatadogResponseCensus;
  surface: string;
}): DatadogOperationCensus {
  const seen = ownCensusEntry({ key: surface, record: census.operations });
  if (seen !== undefined) {
    return seen;
  }
  const opened: DatadogOperationCensus = { objects: {}, paths: {}, roots: {}, statuses: {} };
  census.operations[surface] = opened;
  return opened;
}

/**
 * Fold one answer into the census. Only its structure is kept: keys, kinds and counts, never a value. A failed
 * call is counted by its status and nothing of its body is read.
 *
 * @param census the census run, updated in place
 * @param surface the admitted operation's registry name
 * @param status the HTTP status, or `null` when the request never reached Datadog
 * @param text the 2xx body, or `null` for a failed call
 */
export function observeDatadogAnswer({
  census,
  surface,
  status,
  text,
}: {
  census: DatadogResponseCensus;
  surface: string;
  status: number | null;
  text: string | null;
}): void {
  const tally = operationEntry({ census, surface });
  const key = status === null ? "none" : String(status);
  bumpCensusCount({ counts: tally.statuses, key });
  // Only a 2xx answer's body is structure; any other is counted by its status alone, as a failed call is.
  if (text === null || !SUCCESS.test(key)) {
    return;
  }
  if (text.trim().length === 0) {
    bumpCensusCount({ counts: tally.roots, key: "empty-text" });
    return;
  }
  const body = parseJson({ text });
  if (body.isErr()) {
    bumpCensusCount({ counts: tally.roots, key: "non-json" });
    return;
  }
  bumpCensusCount({ counts: tally.roots, key: responseJsonKind({ value: body.value }) });
  observeResponseStructure({ path: "", structure: tally, value: body.value });
}
