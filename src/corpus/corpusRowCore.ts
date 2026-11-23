/*
 * What a corpus ROW is: the required-field gate, the optional-field assembly, and the sizing vocabulary
 * every layer above this one measures with.
 *
 * The leaf of the corpus reader. It knows nothing about files, directories or streaming — it is handed one
 * already-read line and answers with a record or a counted skip class, which is what lets everything above
 * it import this without a cycle.
 *
 * Fail-closed in two ways that are the whole point of the module. A corrupt line (bad JSON, wrong shape,
 * missing required field) becomes a NAMED rejection rather than a throw, so one bad line never aborts a
 * read and is never silently swallowed either. And only records whose `source`/`kind` are in the known
 * unions survive; anything else is dropped.
 */

import { BRONZE_SOURCES } from "../integrations/corpusSources.js";
import { parseJsonObject } from "../lib/jsonParse.js";
import { isOneOf, isRecord } from "../lib/parsers.js";
import { bodyFields, deriveRawDigest } from "./deriveProjection.js";
import { CORPUS_KINDS, type CorpusAttributeValue, type CorpusRecord } from "./types.js";

/** Type guard: a non-empty string. Positional — TS1230 forbids destructuring in a type predicate. */
function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

/** A valid attr value: a scalar or a string array. Positional — used as a type predicate. */
function isAttributeValue(value: unknown): value is CorpusAttributeValue {
  return (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    (Array.isArray(value) && value.every((item) => typeof item === "string"))
  );
}

/**
 * Parse the optional `attrs` field defensively: keep only well-typed entries, drop the rest. A malformed
 * `attrs` (or a bad entry) NEVER drops the record — rich metadata is best-effort, the record is not.
 *
 * @param value the raw `attrs` value from a parsed row
 * @returns the valid attrs (undefined when absent or nothing valid survives)
 */
function parseAttrs({ value }: { value: unknown }): Readonly<Record<string, CorpusAttributeValue>> | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const out: Record<string, CorpusAttributeValue> = {};
  for (const [key, raw] of Object.entries(value)) {
    if (isAttributeValue(raw)) {
      out[key] = raw;
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * Which fields of a row the reader RETAINS.
 *
 * - `bronze` — the whole record, `raw` included. What every writer-side verb needs.
 * - `retrieval` — the record without `raw`. The query path never reads the raw source payload, and on the
 *   real corpus it is the single largest thing in memory: measured over hundreds of thousands of
 *   records, they cost a few GiB live with `raw` and well under half that without it — over half the load was a field nothing
 *   downstream of the load would ever touch.
 * - `derive` — additionally drops `text`, keeping only the retained `raw` scalar signals silver actually reads
 *   (`./deriveProjection.ts`'s `deriveRawDigest` lists them).
 *
 * The projection happens at PARSE time, per line, so the dropped payload is garbage before the next line is
 * read. Dropping it after the whole file was parsed would still need the whole file's worth of heap first.
 *
 * `derive` exists because silver was the last reader loading a whole multi-gigabyte corpus into heap and
 * refusing at the ceiling on every `refresh`. MEASURED over a sample of tens of thousands of records across all
 * six sources:
 * `text` is under half of bronze's bytes and `raw` over a third, so the two together are about four-fifths of what a derive was
 * carrying — and silver reads NEITHER wholesale. Reproduce the breakdown by summing
 * `JSON.stringify(value).length` per top-level key over a bronze sample.
 */
export type CorpusProjection = "bronze" | "retrieval" | "derive";

/**
 * The band of live heap bytes a projection RETAINS per byte of bronze on disk — what the heap guard projects
 * with. A band rather than one number, because the ratio is a property of the SOURCE (a `self` row is mostly
 * text and carries no `raw`, a Slack row is mostly `raw`) and a single coefficient taken as the maximum
 * over-projects a mixed corpus three-fold, which would refuse a real corpus at the ceiling this guard
 * exists to let it run under.
 *
 * - `ceiling` — the most any source has been measured to retain. Used for the PER-CHUNK tripwire inside a
 *   file's read, where the projection is bounded by {@link READ_CHUNK_BYTES} whatever the file's size, so a
 *   pessimistic number costs at most one chunk of premature refusal. It was used for a whole-FILE tripwire
 *   before the per-source coefficients, where the same pessimism over-projected a 2 GB Slack window 3.5× and refused a corpus
 *   that fits — see {@link readFileInto}.
 * - `floor` — the least any source has been measured to retain. Used for the WHOLE-CORPUS preflight, which
 *   exists to refuse a hopeless load in milliseconds and must never refuse one that could have fit.
 *
 * Measured with `slopweaver dev heap-curve --projection <p> --corpus <dir>` (post-GC live heap, never RSS),
 * per source dir of the real corpus. Re-measure with that verb whenever the record shape or
 * the reader changes — its exit code says whether the band still holds.
 *
 * | source dir   | bronze | retrieval |
 * | ------------ | ------ | --------- |
 * | self         |   1.51 |      1.51 |
 * | notion       |   0.99 |      0.50 |
 * | github       |   1.72 |      0.87 |
 * | linear       |   0.88 |      0.41 |
 * | slack        |   1.61 |      0.52 |
 * | whole corpus |   1.36 |      0.60 |
 *
 * Each source dir measured ran to tens or hundreds of MiB and tens to hundreds of thousands of records; the
 * ratio, not the size, is what the guard reads. The `derive` column was measured the same way, per source
 * dir, with `slopweaver dev heap-curve --projection derive --corpus ~/.slopweaver/corpus/bronze/<source>`:
 *
 * | source | derive |
 * | ------ | ------ |
 * | github |   0.06 |
 * | notion |   0.14 |
 * | linear |   0.16 |
 * | slack  |   0.18 |
 * | gmail  |   0.50 |
 * | self   |   0.69 |
 *
 * `self` is the ceiling again and for a new reason: it is the one source that carries no `raw` at all, so
 * dropping `text` leaves its urls, paths and refs as the whole of the row, and those retain nearly as much
 * per surviving byte as bronze did per total byte. `github` is the floor because its `raw` is the largest
 * share of its bytes and four scalars survive it. Slack was most of the measured corpus and sits at 0.18, so
 * the MIXED whole-corpus figure lands near there — under a fifth of a multi-gigabyte corpus's size in live
 * heap, against a ceiling the `bronze` projection would have needed about four times over to clear.
 *
 * `self` retains the same either way — its rows carry no `raw` — and retains the MOST per byte, because its
 * text is two-byte in V8 (one non-latin1 character makes the whole string so). That is the ceiling. Linear
 * without `raw` is the floor.
 */
export interface HeapCoefficientBand {
  readonly floor: number;
  readonly ceiling: number;
}

export const HEAP_BYTES_PER_DISK_BYTE: Readonly<Record<CorpusProjection, HeapCoefficientBand>> = {
  bronze: { ceiling: 2.0, floor: 0.7 },
  derive: { ceiling: 0.7, floor: 0.05 },
  retrieval: { ceiling: 1.8, floor: 0.35 },
};

/** The validated core (required) fields of a corpus record — the parts that gate acceptance. */
interface CorpusRowCore {
  readonly source: CorpusRecord["source"];
  readonly kind: CorpusRecord["kind"];
  readonly sourceId: string;
  readonly tsIso: string;
  readonly container: string;
  readonly text: string;
  readonly url: string;
  readonly refs: readonly string[];
}

/**
 * The CLASS a rejected row belongs to — a closed union, not the per-row message.
 *
 * `excluded-author` is the one member that is not a defect: it is a row the install's own denylist
 * ({@link ./syncExclusion}) told the index not to admit. It tallies here rather than vanishing precisely
 * because it is a POLICY skip — a corpus that silently held less than its operator believed would be worse
 * than one holding junk, and the conservation law below is what makes the exclusion visible in every
 * coverage report that already prints these.
 *
 * `empty-field` is a separate class from `missing-field` because conflating them hid a whole population for
 * weeks. One message — `"missing required field (sourceId/tsIso/container/text)"` — covered both, named four
 * fields when one was at fault, and said "missing" of a field that was present. Measured over the whole
 * bronze tree of a real install: **hundreds of rows rejected this way and not one had a missing
 * field.** Every one was `text: ""` — Notion `page` rows most, then Notion `database` and calendar `event` — and
 * the two have different fixes, so they need different names. Reproduce with `slopweaver audit run`, which
 * prints the collapsed per-file lines these now produce.
 *
 * The conservation law (`ingested = indexed + skipped_with_reason`) is only useful if the skip side groups.
 * A per-row message would produce one tally row per bad line, which is a log, not a number; a class produces
 * `invalid-json ×<n>`, which is a fact a reader can act on.
 */
export const SKIP_REASONS = [
  "invalid-json",
  "unknown-source",
  "unknown-kind",
  "missing-field",
  "empty-field",
  "bad-url",
  "bad-refs",
  "superseded",
  "excluded-author",
] as const;

export type SkipReason = (typeof SKIP_REASONS)[number];

/** A rejection: the human message (kept verbatim for the warning) plus the class it tallies under. */
interface RowRejection {
  readonly error: string;
  readonly reason: SkipReason;
}

/**
 * The rejection for one required string field that failed — naming the field, and saying which of the two
 * things went wrong. Pure.
 *
 * A present-but-empty string and an absent one are different defects with different fixes: the first is a
 * connector projecting a row that genuinely has no body (an untitled Notion `data_source`, a calendar event
 * with no description), the second is a malformed line. Both used to say "missing".
 *
 * @param field the required field that failed
 * @param value what was actually there, which decides empty-vs-missing
 * @returns the rejection, carrying the class that tallies it
 */
function requiredFieldRejection({ field, value }: { field: string; value: unknown }): RowRejection {
  if (typeof value === "string") {
    return { error: `empty required field: ${field}`, reason: "empty-field" };
  }
  return { error: `missing required field: ${field}`, reason: "missing-field" };
}

/** Validate the required fields of a parsed row, or return the first rejection reason. Pure. */
function validateRowCore({ value }: { value: Record<string, unknown> }): { core: CorpusRowCore } | RowRejection {
  const { source, sourceId, url, tsIso, kind, container, text, refs } = value;
  // BRONZE_SOURCES, not CORPUS_SOURCES: this gate decides what may appear on a line of bronze, which is a
  // wider question than what refresh fetches. Validating against the fetch list made a `self` line unreadable.
  if (typeof source !== "string" || !isOneOf(source, BRONZE_SOURCES)) {
    return { error: `unknown source: ${String(source)}`, reason: "unknown-source" };
  }
  if (typeof kind !== "string" || !isOneOf(kind, CORPUS_KINDS)) {
    return { error: `unknown kind: ${String(kind)}`, reason: "unknown-kind" };
  }
  // One `if` per field rather than one disjunction, so the message can NAME the field that failed. The old
  // single check reported all four every time, which is how hundreds of rows all failing on `text` read for weeks as
  // a vague four-way complaint nobody could act on.
  if (!isNonEmptyString(sourceId)) {
    return requiredFieldRejection({ field: "sourceId", value: sourceId });
  }
  if (!isNonEmptyString(tsIso)) {
    return requiredFieldRejection({ field: "tsIso", value: tsIso });
  }
  if (!isNonEmptyString(container)) {
    return requiredFieldRejection({ field: "container", value: container });
  }
  if (!isNonEmptyString(text)) {
    return requiredFieldRejection({ field: "text", value: text });
  }
  if (typeof url !== "string") {
    return { error: "url must be a string", reason: "bad-url" };
  }
  if (!Array.isArray(refs) || !refs.every((r) => typeof r === "string")) {
    return { error: "refs must be a string array", reason: "bad-refs" };
  }
  return { core: { container, kind, refs, source, sourceId, text, tsIso, url } };
}

/** Assemble a record from its validated core plus best-effort optional fields (author/title/attrs/raw). Pure. */
function assembleCorpusRecord({
  core,
  value,
  projection,
}: {
  core: CorpusRowCore;
  value: Record<string, unknown>;
  projection: CorpusProjection;
}): CorpusRecord {
  const { author, title, attrs, raw } = value;
  const parsedAttrs = parseAttrs({ value: attrs });
  // `raw` is the opaque full source payload — kept verbatim (never field-validated), dropped only if it
  // isn't an object. A malformed raw never drops the record. The retrieval projection never keeps it, and
  // `derive` keeps a four-scalar SUMMARY of it rather than the blob (see `deriveRawDigest`).
  const parsedRaw = projection === "bronze" && isRecord(raw) ? raw : undefined;
  const deriveRaw = projection === "derive" ? deriveRawDigest({ raw: isRecord(raw) ? raw : undefined }) : undefined;
  // `visibility` (PR4.5): ONLY an explicit `"private"` survives; absent/anything-else reads as public (the
  // default-public migration contract), so a legacy row is never fail-closed into the private lane.
  const isPrivate = value["visibility"] === "private";
  const titled = isNonEmptyString(title) ? title : undefined;
  return {
    ...core,
    ...bodyFields({ projection, text: core.text, title: titled }),
    ...(titled !== undefined ? { title: titled } : {}),
    ...(isNonEmptyString(author) ? { author } : {}),
    ...(isPrivate ? { visibility: "private" as const } : {}),
    ...(parsedAttrs !== undefined ? { attrs: parsedAttrs } : {}),
    ...(parsedRaw !== undefined ? { raw: parsedRaw } : {}),
    ...(deriveRaw !== undefined ? { raw: deriveRaw } : {}),
  };
}

/**
 * Decode one parsed JSON object into a record, or the reason it was rejected. Pure — a thin composition of
 * {@link validateRowCore} (required-field gate) + {@link assembleCorpusRecord} (best-effort optionals).
 *
 * @param value the parsed row object
 * @param projection which fields to retain — `bronze` (everything) unless a reader says otherwise
 * @returns the decoded record, or a rejection reason
 */
export function decodeCorpusRecordRow({
  value,
  projection = "bronze",
}: {
  value: Record<string, unknown>;
  projection?: CorpusProjection;
}): { record: CorpusRecord } | RowRejection {
  const validated = validateRowCore({ value });
  if ("error" in validated) {
    return validated;
  }
  return { record: assembleCorpusRecord({ core: validated.core, projection, value }) };
}

/**
 * Parse one JSONL line into a record, or return an error string describing why it was rejected. Pure.
 *
 * @param line one raw JSONL line
 * @param projection which fields to retain — `bronze` (everything) unless a reader says otherwise
 * @returns the record, or an error string saying why — an error VALUE rather than a throw, so one bad line
 *   is reported without costing the rest of the file
 */
export function parseRow({
  line,
  projection = "bronze",
}: {
  line: string;
  projection?: CorpusProjection;
}): { record: CorpusRecord } | RowRejection {
  const parsed = parseJsonObject({ text: line });
  if (parsed.isErr()) {
    return { error: parsed.error.message, reason: "invalid-json" };
  }
  return decodeCorpusRecordRow({ projection, value: parsed.value });
}
