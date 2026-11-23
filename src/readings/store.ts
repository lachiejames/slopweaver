/**
 * Reading and appending the readings ledger — the effectful half of {@link ./row.js}.
 *
 * Two files per reading, in a fixed order. The DOCUMENT is written first, atomically, to
 * `readings/<producer slug>/<instant>.json`; the index row is appended to `readings/index.jsonl` second.
 * A document with no row is invisible and harmless; a row naming a document that never landed would be a
 * ledger that lies, so the order is the rule rather than a preference.
 *
 * ## The read REFUSES rather than reporting empty
 *
 * Same call as `../autonomy/importRegister.ts`: a page rendering "no reading yet" because the index could not be
 * read is the confident wrong answer the ledger exists to prevent. Only an ABSENT default index is empty —
 * every other errno is a store we cannot see, and says so.
 *
 * ## Why the index is streamed and the document is not
 *
 * The index grows for as long as the install runs, so it goes through `readJsonlLines` from the first
 * commit (`whole-file-json`). A document is ONE verb's `--json` report, bounded by the code that shaped
 * it, and is read whole through `safeJsonParse`, which warns and refuses at the house sizes.
 */
import { existsSync, mkdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { appendLines } from "#lib/appendSeparator.js";
import { parseIsoMs } from "#lib/date.js";
import { errorMessage } from "#lib/errorMessage.js";
import { isRecord } from "#lib/parsers.js";
import { nonBlockingFileBytes } from "#lib/presentFile.js";
import { err, ok, type Result } from "#lib/result.js";
import { safeJsonParse, safeJsonStringify } from "#lib/safeJson.js";
import { writeFileAtomic } from "#lib/writeAtomic.js";
import { acquireOperationLock } from "../admit/operationLock.js";
import { readJsonlLines } from "../corpus/corpusStore.js";
import { slopweaverHome } from "../homeDir.js";
import { stateHomePaths } from "../stateHome.js";
import { type ReadingsError, ReadingsErrors } from "./errors.js";
import { landingSelectionRefusal } from "./landingSelection.js";
import { buildReadingRecord, isSkipDocument, parseReadingLine, readingsNewestFirst } from "./row.js";
import type { Reading, ReadingReceipt, ReadingRecord } from "./types.js";

/** Owner-only, like every ledger under the home: a document quotes what a verb saw. */
const DIR_MODE = 0o700;
const FILE_MODE = 0o600;

/** The lock key every writer of this ledger takes. One ledger, one key. */
const LOCK_KEY = "readings-ledger";

/**
 * Whether the index is there, genuinely absent, or present-but-unreachable — `existsSync` cannot tell the
 * last two apart, and the difference is the whole point of refusing rather than reporting empty.
 */
function presence({ path }: { path: string }): "present" | "absent" | "unreachable" {
  try {
    statSync(path);
    return "present";
  } catch (error: unknown) {
    return isRecord(error) && error["code"] === "ENOENT" ? "absent" : "unreachable";
  }
}

/**
 * Every row the index holds, in the order they were appended. An install that has recorded nothing is empty.
 *
 * @param home the state home (defaults to the resolved home)
 * @returns every row, or the first failure
 */
export function readReadingIndex({ home }: { home?: string } = {}): Result<readonly ReadingRecord[], ReadingsError> {
  const path = stateHomePaths(home === undefined ? {} : { home }).readingsIndexJsonl;
  const seen = presence({ path });
  if (seen === "unreachable") {
    return err(
      ReadingsErrors.storeUnreadable({ cause: "the index could not be reached — check its permissions", path }),
    );
  }
  if (seen === "absent") {
    return ok([]);
  }
  const records: ReadingRecord[] = [];
  let failure: ReadingsError | undefined;
  try {
    readJsonlLines({
      onLine: ({ line, index }) => {
        if (failure !== undefined || line.trim().length === 0) {
          return;
        }
        const parsed = parseReadingLine({ line, lineNumber: index + 1 });
        if (parsed.isErr()) {
          failure = parsed.error;
          return;
        }
        records.push(parsed.value);
      },
      path,
    });
  } catch (cause) {
    return err(ReadingsErrors.storeUnreadable({ cause: errorMessage({ error: cause }), path }));
  }
  if (failure !== undefined) {
    return err(failure);
  }
  return ok(records);
}

/**
 * An optional bound's instant: `undefined` when the caller passed none, refused when it does not parse.
 *
 * @param field the option's name, carried into the refusal
 * @returns the bound in epoch ms, `undefined` when unbounded, or the refusal
 */
function optionalInstantMs({
  field,
  iso,
}: {
  field: string;
  iso: string | undefined;
}): Result<number | undefined, ReadingsError> {
  if (iso === undefined) {
    return ok(undefined);
  }
  const ms = parseIsoMs({ tsIso: iso });
  if (ms === undefined) {
    return err(ReadingsErrors.invalidField({ field, why: `is not an instant: "${iso}"` }));
  }
  return ok(ms);
}

/**
 * Whether a validated row's instant sits at or before an optional bound; no bound holds every row.
 *
 * @returns true when the row is inside the bound
 */
function atOrBefore({ boundMs, iso }: { boundMs: number | undefined; iso: string }): boolean {
  return boundMs === undefined || parseIsoMs({ tsIso: iso })! <= boundMs;
}

/**
 * The latest reading one producer recorded, with its document parsed — passing over every cadence skip
 * newer than it (`isSkipDocument`), because a verb that did not read is not the latest state of anything.
 * Tick-capture never appends one, but a seat running older code or a hand `reading record` still can.
 *
 * A document that is missing or will not parse is still refused at the row that names it, never passed
 * over: that is a ledger we cannot see, not a skip.
 *
 * @param producer the verb line, matched by slug
 * @param home the state home (defaults to the resolved home)
 * @param asOfIso when given, only a row the ledger held by then — the reading in force at that instant, which no
 *   later append can change
 * @param observedByIso when given, only a row whose `observedAtIso` is at or before it too — the ledger does not hold
 *   a row's observed instant to its recorded one, so a replay that must see nothing from after its instant passes both
 * @returns the reading, `NO_READING` when the producer has none but skips, or the failure
 */
export function lastReading({
  producer,
  home,
  asOfIso,
  observedByIso,
}: {
  producer: string;
  home?: string;
  asOfIso?: string;
  observedByIso?: string;
}): Result<Reading, ReadingsError> {
  const index = readReadingIndex(home === undefined ? {} : { home });
  if (index.isErr()) {
    return err(index.error);
  }
  const readingsDir = stateHomePaths(home === undefined ? {} : { home }).readings;
  const asOfMs = optionalInstantMs({ field: "asOfIso", iso: asOfIso });
  if (asOfMs.isErr()) {
    return err(asOfMs.error);
  }
  const observedByMs = optionalInstantMs({ field: "observedByIso", iso: observedByIso });
  if (observedByMs.isErr()) {
    return err(observedByMs.error);
  }
  const held = readingsNewestFirst({ producer, records: index.value }).filter(
    // A validated row's instants always parse.
    (record) =>
      atOrBefore({ boundMs: asOfMs.value, iso: record.recordedAtIso }) &&
      atOrBefore({ boundMs: observedByMs.value, iso: record.observedAtIso }),
  );
  for (const record of held) {
    const path = join(readingsDir, record.file);
    let document: unknown;
    try {
      document = safeJsonParse({
        label: `reading ${record.readingId}`,
        text: nonBlockingFileBytes({ path }).toString("utf8"),
      });
    } catch (cause) {
      return err(ReadingsErrors.storeUnreadable({ cause: errorMessage({ error: cause }), path }));
    }
    if (!isSkipDocument({ document })) {
      return ok({ document, record });
    }
  }
  return err(ReadingsErrors.noReading({ producer }));
}

/**
 * Every reading one producer recorded whose `observedAtIso` falls inside `[fromIso, toIso]`, oldest first, each
 * document parsed — the series a windowed summary reads, where `lastReading` gives only its newest point.
 *
 * Only the selected documents are opened, never the producer's whole history. A cadence skip is passed over
 * exactly as `lastReading` passes it; a selected document that is missing or will not parse refuses the whole
 * series, because a series silently one reading short reads as a quieter window than the one that happened.
 *
 * @param producer the verb line, matched by slug
 * @param home the state home (defaults to the resolved home)
 * @param fromIso the window's first instant, inclusive
 * @param toIso the window's last instant, inclusive — nothing observed or recorded after it is read, so a replay agrees
 * @returns the readings, oldest first (empty for a window nothing landed in), or the failure
 */
export function readingsInWindow({
  producer,
  home,
  fromIso,
  toIso,
}: {
  producer: string;
  home?: string;
  fromIso: string;
  toIso: string;
}): Result<readonly Reading[], ReadingsError> {
  const fromMs = parseIsoMs({ tsIso: fromIso });
  const toMs = parseIsoMs({ tsIso: toIso });
  if (fromMs === undefined) {
    return err(ReadingsErrors.invalidField({ field: "fromIso", why: `is not an instant: "${fromIso}"` }));
  }
  if (toMs === undefined) {
    return err(ReadingsErrors.invalidField({ field: "toIso", why: `is not an instant: "${toIso}"` }));
  }
  if (toMs < fromMs) {
    return err(ReadingsErrors.invalidField({ field: "toIso", why: `is before fromIso ${fromIso}` }));
  }
  const index = readReadingIndex(home === undefined ? {} : { home });
  if (index.isErr()) {
    return err(index.error);
  }
  const readingsDir = stateHomePaths(home === undefined ? {} : { home }).readings;
  // A validated row's instant always parses.
  const observedMsOf = ({ record }: { record: ReadingRecord }): number => parseIsoMs({ tsIso: record.observedAtIso })!;
  // Nothing recorded after `toIso` either, exactly as `lastReading`'s `asOfIso`, so a replay sees what was there then.
  const recordedByEnd = ({ record }: { record: ReadingRecord }): boolean =>
    parseIsoMs({ tsIso: record.recordedAtIso })! <= toMs;
  const selected = readingsNewestFirst({ producer, records: index.value })
    .filter(
      (record) => observedMsOf({ record }) >= fromMs && observedMsOf({ record }) <= toMs && recordedByEnd({ record }),
    )
    .toSorted((left, right) => observedMsOf({ record: left }) - observedMsOf({ record: right }));
  const series: Reading[] = [];
  for (const record of selected) {
    const path = join(readingsDir, record.file);
    let document: unknown;
    try {
      document = safeJsonParse({
        label: `reading ${record.readingId}`,
        text: nonBlockingFileBytes({ path }).toString("utf8"),
      });
    } catch (cause) {
      return err(ReadingsErrors.storeUnreadable({ cause: errorMessage({ error: cause }), path }));
    }
    if (!isSkipDocument({ document })) {
      series.push({ document, record });
    }
  }
  return ok(series);
}

/**
 * The first millisecond at or after the built row's instant whose document file does not exist yet, with
 * its directory made. Held under the ledger lock, so the place found is the place written.
 *
 * @returns the row at that instant and its document path, or the failure
 */
function unoccupiedPlace({
  built,
  readingsDir,
}: {
  built: ReadingRecord;
  readingsDir: string;
}): Result<{ record: ReadingRecord; documentPath: string }, ReadingsError> {
  let record = built;
  let documentPath = join(readingsDir, record.file);
  try {
    mkdirSync(dirname(documentPath), { mode: DIR_MODE, recursive: true });
  } catch (cause) {
    return err(ReadingsErrors.storeUnreadable({ cause: errorMessage({ error: cause }), path: documentPath }));
  }
  while (existsSync(documentPath)) {
    // A built row's instant always parses: `buildReadingRecord` refused it otherwise.
    const later = new Date(parseIsoMs({ tsIso: record.recordedAtIso })! + 1).toISOString();
    const rebuilt = buildReadingRecord({ ...record, recordedAtIso: later });
    if (rebuilt.isErr()) {
      return err(rebuilt.error);
    }
    record = rebuilt.value;
    documentPath = join(readingsDir, record.file);
  }
  return ok({ documentPath, record });
}

/**
 * Why a document may not be recorded: it does not parse as JSON, or it is a landing reading not taken as the owner
 * (`./landingSelection.ts`).
 *
 * @param producer the verb line that printed the document
 * @param document the exact text the producer printed
 * @returns the refusal, or undefined when the document may be recorded
 */
function refusedDocument({ producer, document }: { producer: string; document: string }): ReadingsError | undefined {
  let parsed: unknown;
  try {
    parsed = safeJsonParse({ label: `a reading of ${producer}`, text: document });
  } catch (cause) {
    return ReadingsErrors.invalidField({ field: "document", why: `must be JSON — ${errorMessage({ error: cause })}` });
  }
  const refusal = landingSelectionRefusal({ document: parsed, producer });
  if (refusal !== undefined) {
    return ReadingsErrors.invalidField({ field: `a "${producer}" document`, why: refusal });
  }
  return undefined;
}

/**
 * Record one reading: write its document, then append its row, under the ledger's lock.
 *
 * @param producer the verb line that printed the document
 * @param by who took it
 * @param observedAtIso when the document was true
 * @param document the exact text the producer printed — stored as-is, never re-serialised; refused unless it
 *   parses as JSON, because a reading IS a document and a page reads it as one
 * @param nowIso the append instant, which is also the lock's clock; a second append for the same producer
 *   inside the same millisecond is recorded one millisecond later rather than over the first, and the
 *   receipt's `recordedAtIso` says so
 * @param home the state home (defaults to the resolved home)
 * @returns the row and both paths, or the failure
 */
export function recordReading({
  producer,
  by,
  observedAtIso,
  document,
  nowIso,
  home = slopweaverHome(),
}: {
  producer: string;
  by: string;
  observedAtIso: string;
  document: string;
  nowIso: string;
  home?: string;
}): Result<ReadingReceipt, ReadingsError> {
  const paths = stateHomePaths({ home });
  const refused = refusedDocument({ document, producer });
  if (refused !== undefined) {
    return err(refused);
  }
  const bytes = Buffer.byteLength(document, "utf8");
  const built = buildReadingRecord({ by, bytes, observedAtIso, producer, recordedAtIso: nowIso });
  if (built.isErr()) {
    return err(built.error);
  }
  const lock = acquireOperationLock({ home, key: LOCK_KEY, nowIso });
  if (lock.isErr()) {
    return err(ReadingsErrors.ledgerBusy({ why: lock.error }));
  }
  const placed = unoccupiedPlace({ built: built.value, readingsDir: paths.readings });
  if (placed.isErr()) {
    lock.value.release();
    return err(placed.error);
  }
  const { documentPath, record } = placed.value;
  try {
    writeFileAtomic({ contents: document, dirMode: DIR_MODE, fileMode: FILE_MODE, path: documentPath });
  } catch (cause) {
    lock.value.release();
    return err(ReadingsErrors.storeUnreadable({ cause: errorMessage({ error: cause }), path: documentPath }));
  }
  const indexPath = paths.readingsIndexJsonl;
  try {
    appendLines({
      mode: FILE_MODE,
      path: indexPath,
      text: `${safeJsonStringify({ label: "a readings index row", value: record })}\n`,
    });
  } catch (cause) {
    return err(ReadingsErrors.storeUnreadable({ cause: errorMessage({ error: cause }), path: indexPath }));
  } finally {
    lock.value.release();
  }
  return ok({ documentPath, indexPath, record });
}
