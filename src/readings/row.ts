/**
 * The pure half of the readings ledger: what a valid row is, how a producer names its directory, and how
 * one index line is parsed. No I/O; `./store.ts` is the effectful half.
 */

import { parseIsoMs } from "#lib/date.js";
import { isRecord } from "#lib/parsers.js";
import { err, ok, type Result } from "#lib/result.js";
import { safeJsonParse } from "#lib/safeJson.js";
import { duplicateTopLevelKey } from "../autonomy/duplicateKey.js";

import { type ReadingsError, ReadingsErrors } from "./errors.js";
import { READING_BY_MAX, READING_PRODUCER_MAX, type ReadingRecord } from "./types.js";

/**
 * The directory name a producer's documents live under.
 *
 * The producer is the verb WORDS — `github landing`, `claude gauge` — and the slug is that name lowercased
 * with every run of non-alphanumerics folded to one dash. A flag spelled into the producer becomes part of
 * the slug and splits the key, which is why `tick-capture` strips its argv to the words before the first
 * `--` and why `github landing` records under a constant.
 *
 * @param producer the verb line
 * @returns the slug, never empty for a non-empty producer
 */
export function producerSlug({ producer }: { producer: string }): string {
  return producer
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * The file name one recording writes, and the id its row carries.
 *
 * The instant is made path-safe by dropping the colons; the id keeps it verbatim beside the slug so a
 * reader can find the file from the id and the id from the file.
 *
 * @param recordedAtIso the append instant
 * @param slug the producer's directory
 * @returns the file path relative to `readings/`, and the id
 */
export function readingFileOf({ recordedAtIso, slug }: { recordedAtIso: string; slug: string }): {
  file: string;
  readingId: string;
} {
  return {
    file: `${slug}/${recordedAtIso.replace(/:/g, "")}.json`,
    readingId: `${recordedAtIso}-${slug}`,
  };
}

/** A trimmed, non-empty string no longer than `max`, or the field's refusal. */
function text({ field, value, max }: { field: string; value: unknown; max: number }): Result<string, ReadingsError> {
  if (typeof value !== "string") {
    return err(ReadingsErrors.invalidField({ field, why: "must be a string" }));
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return err(ReadingsErrors.invalidField({ field, why: "must not be empty" }));
  }
  if (trimmed.length > max) {
    return err(ReadingsErrors.invalidField({ field, why: `must be at most ${String(max)} characters` }));
  }
  return ok(trimmed);
}

/** An ISO instant with a parseable time, or the field's refusal. */
function instant({ field, value }: { field: string; value: unknown }): Result<string, ReadingsError> {
  if (typeof value !== "string" || parseIsoMs({ tsIso: value }) === undefined) {
    return err(ReadingsErrors.invalidField({ field, why: "must be an ISO-8601 instant" }));
  }
  return ok(value);
}

/**
 * Validate one row, whatever built it — the same rules for a caller's arguments and for a stored line.
 *
 * @param value the candidate
 * @returns the row, trimmed and re-built as a plain literal, or the first refusal
 */
export function validateReadingRecord({ value }: { value: unknown }): Result<ReadingRecord, ReadingsError> {
  if (!isRecord(value)) {
    return err(ReadingsErrors.invalidField({ field: "row", why: "must be an object" }));
  }
  const producer = text({ field: "producer", max: READING_PRODUCER_MAX, value: value["producer"] });
  if (producer.isErr()) {
    return err(producer.error);
  }
  const by = text({ field: "by", max: READING_BY_MAX, value: value["by"] });
  if (by.isErr()) {
    return err(by.error);
  }
  const observedAtIso = instant({ field: "observedAtIso", value: value["observedAtIso"] });
  if (observedAtIso.isErr()) {
    return err(observedAtIso.error);
  }
  const recordedAtIso = instant({ field: "recordedAtIso", value: value["recordedAtIso"] });
  if (recordedAtIso.isErr()) {
    return err(recordedAtIso.error);
  }
  const slug = producerSlug({ producer: producer.value });
  if (slug.length === 0) {
    return err(ReadingsErrors.invalidField({ field: "producer", why: "must contain a letter or digit" }));
  }
  const expected = readingFileOf({ recordedAtIso: recordedAtIso.value, slug });
  if (value["readingId"] !== expected.readingId) {
    return err(ReadingsErrors.invalidField({ field: "readingId", why: `must be ${expected.readingId}` }));
  }
  if (value["file"] !== expected.file) {
    return err(ReadingsErrors.invalidField({ field: "file", why: `must be ${expected.file}` }));
  }
  const bytes = value["bytes"];
  if (typeof bytes !== "number" || !Number.isInteger(bytes) || bytes < 0) {
    return err(ReadingsErrors.invalidField({ field: "bytes", why: "must be a non-negative integer" }));
  }
  return ok({
    by: by.value,
    bytes,
    file: expected.file,
    observedAtIso: observedAtIso.value,
    producer: producer.value,
    readingId: expected.readingId,
    recordedAtIso: recordedAtIso.value,
  });
}

/**
 * Build the row one recording appends.
 *
 * @param producer the verb line that printed the document
 * @param by who took the reading
 * @param observedAtIso when the document was true
 * @param recordedAtIso the append instant
 * @param bytes the document's size
 * @returns the validated row, or the first refusal
 */
export function buildReadingRecord({
  producer,
  by,
  observedAtIso,
  recordedAtIso,
  bytes,
}: {
  producer: string;
  by: string;
  observedAtIso: string;
  recordedAtIso: string;
  bytes: number;
}): Result<ReadingRecord, ReadingsError> {
  const slug = producerSlug({ producer });
  const named = readingFileOf({ recordedAtIso, slug });
  return validateReadingRecord({
    value: { by, bytes, file: named.file, observedAtIso, producer, readingId: named.readingId, recordedAtIso },
  });
}

/**
 * Parse one index line.
 *
 * @param line the raw line
 * @param lineNumber its 1-based position, carried on a refusal
 * @returns the row, or a corrupt-row refusal naming the line
 */
export function parseReadingLine({
  line,
  lineNumber,
}: {
  line: string;
  lineNumber: number;
}): Result<ReadingRecord, ReadingsError> {
  let decoded: unknown;
  try {
    decoded = JSON.parse(line);
  } catch {
    return err(ReadingsErrors.corruptRow({ lineNumber, why: "the line is not valid JSON" }));
  }
  const duplicate = duplicateTopLevelKey({ text: line });
  if (duplicate !== undefined) {
    return err(ReadingsErrors.corruptRow({ lineNumber, why: `the field \`${duplicate}\` is written twice` }));
  }
  const validated = validateReadingRecord({ value: decoded });
  if (validated.isErr()) {
    return err(ReadingsErrors.corruptRow({ lineNumber, why: validated.error.message }));
  }
  return ok(validated.value);
}

/**
 * One producer's rows, newest first by append instant.
 *
 * @param records every row, in file order
 * @param producer the verb line, compared by slug so flag spellings do not split one producer in two
 * @returns the producer's rows, a tie going to the row appended later in the index
 */
export function readingsNewestFirst({
  records,
  producer,
}: {
  records: readonly ReadingRecord[];
  producer: string;
}): readonly ReadingRecord[] {
  const slug = producerSlug({ producer });
  return records
    .map((record, index) => ({ index, record }))
    .filter(({ record }) => producerSlug({ producer: record.producer }) === slug)
    .toSorted(
      // A validated row's instant always parses.
      (left, right) =>
        parseIsoMs({ tsIso: right.record.recordedAtIso })! - parseIsoMs({ tsIso: left.record.recordedAtIso })! ||
        right.index - left.index,
    )
    .map(({ record }) => record);
}

/**
 * The latest row for one producer, by append instant.
 *
 * @param records every row, in file order
 * @param producer the verb line, compared by slug so flag spellings do not split one producer in two
 * @returns the latest row, or `undefined` when the producer has none
 */
export function latestReadingFor({
  records,
  producer,
}: {
  records: readonly ReadingRecord[];
  producer: string;
}): ReadingRecord | undefined {
  return readingsNewestFirst({ producer, records }).at(0);
}

/**
 * Whether a document is a verb saying it did NOT read — so it is no reading of the world, and a page that
 * showed it as the latest one would show nothing.
 *
 * `github landing --if-due` prints one when its cadence says this tick is not due (`reportSkipped`,
 * `../cli/commands/github/landingRun.ts`); no other producer prints one at the top level. MEASURED:
 * 161 of the 611 `github landing` documents on the owner's machine were skips, and the newest of them blanked both
 * console sidebar badges for the half hour it stood
 * (`grep -l '"kind":"skipped"' -r ~/.slopweaver/readings/github-landing | wc -l`).
 *
 * @param document the parsed document
 * @returns true for a skip
 */
export function isSkipDocument({ document }: { document: unknown }): boolean {
  return isRecord(document) && document["kind"] === "skipped";
}

/**
 * {@link isSkipDocument} over a document's printed text, for a writer holding bytes rather than a value.
 * Text that is not JSON is not a skip: it is the ledger's to refuse (`recordReading`), and refused there by name.
 *
 * @param printed the document's text, exactly as the producer wrote it
 * @returns true for a skip
 */
export function isSkipText({ printed }: { printed: string }): boolean {
  let document: unknown;
  try {
    document = safeJsonParse({ label: "a reading's document", text: printed });
  } catch {
    return false;
  }
  return isSkipDocument({ document });
}
