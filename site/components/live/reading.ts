/**
 * The envelope `reading last --producer <x> --json` prints: the ledger row's fields flat beside a
 * `document`. Every page that reads the supervisor tick's own recording rather than running a verb itself
 * — `now`, `workstreams` — narrows its document through `readingOf`, so the live path and the recorded one
 * can never disagree about a shape.
 */
import { isBag, str } from "../../lib/bag";

/** One recorded reading of a verb, with who took it and when it was true. */
export interface Reading<T> {
  /** Who appended it — a tick label such as `tick-248`, a session, `fixture-capture`. */
  readonly by: string;
  readonly readingId: string;
  /** When the document was true of the machine — the ledger's own stamp, which the tile ages. */
  readonly observedAtIso: string;
  readonly recordedAtIso: string;
  readonly value: T;
}

/**
 * Read the object `reading last --producer <x> --json` prints, narrowing its `document` with `read`.
 *
 * @param read the document reader for one producer
 * @returns the reading, or `undefined` when the payload is not one or its document will not read
 */
export function readingOf<T>({
  payload,
  read,
}: {
  payload: unknown;
  read: (document: unknown) => T | undefined;
}): Reading<T> | undefined {
  if (!isBag(payload)) {
    return undefined;
  }
  const by = str({ bag: payload, key: "by" });
  const readingId = str({ bag: payload, key: "readingId" });
  const observedAtIso = str({ bag: payload, key: "observedAtIso" });
  const recordedAtIso = str({ bag: payload, key: "recordedAtIso" });
  const value = read(payload.document);
  if (
    by === undefined ||
    readingId === undefined ||
    observedAtIso === undefined ||
    recordedAtIso === undefined ||
    value === undefined
  ) {
    return undefined;
  }
  return { by, observedAtIso, readingId, recordedAtIso, value };
}

/** The refusal code `reading last` exits 3 with when the producer has recorded nothing yet. */
export const NO_READING = "NO_READING";

/** The keys of the runner's `LiveExpectedEmpty` envelope (`../../lib/liveVerbs.ts`), and no others. */
const ENVELOPE_KEYS: ReadonlySet<string> = new Set(["code", "kind", "why"]);

/** No reading recorded for the producer yet: an answer, so a page draws its empty state rather than a failure. */
export interface ReadingNotRecorded {
  readonly kind: "not-recorded";
  /** The verb's own sentence. */
  readonly why: string;
}

/** A producer's last reading as a page takes it: the recorded one, or the answer that there is none yet. */
export type RecordedReading<T> = Reading<T> | ReadingNotRecorded;

/**
 * Whether a reading is the not-recorded answer.
 *
 * @param reading the reading as it read
 * @returns true for the not-recorded arm
 */
export function isReadingNotRecorded<T>(reading: RecordedReading<T>): reading is ReadingNotRecorded {
  // Keyed on the field every recorded reading carries, never on `kind`, so no document can pass itself off as absent.
  return !("readingId" in reading);
}

/**
 * Read a `reading last` payload whose row declares `NO_READING` as its expected-empty exit: the runner's envelope for
 * that code as {@link ReadingNotRecorded}, anything else through {@link readingOf}.
 *
 * @param payload the live reading's payload, untrusted
 * @param read the document reader for one producer
 * @returns the reading, or `undefined` when it reads as neither — another refusal code included
 */
export function readingOrNotRecordedOf<T>({
  payload,
  read,
}: {
  payload: unknown;
  read: (document: unknown) => T | undefined;
}): RecordedReading<T> | undefined {
  if (isBag(payload) && payload["kind"] === "expected-empty") {
    const why = payload["why"];
    // Exactly the runner's three keys: the envelope travels in-band, so anything beyond them is the verb's own stdout.
    const onlyEnvelopeKeys = Object.keys(payload).every((key) => ENVELOPE_KEYS.has(key));
    if (payload["code"] !== NO_READING || typeof why !== "string" || !onlyEnvelopeKeys) {
      return undefined;
    }
    return { kind: "not-recorded", why };
  }
  return readingOf({ payload, read });
}
