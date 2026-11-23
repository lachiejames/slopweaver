/**
 * Failed syncs started by the console, read back for the monitor sweep. The console writes both ledgers itself
 * (`site/lib/consoleSyncFailureAppend.ts`), because the failure it records can be a verb that would not start; the
 * row shapes below are the ones that writer restates.
 *
 * Two ledgers: `live/console-sync-failures.jsonl` holds each failure, and the home-root fallback holds a failure that
 * ledger REFUSED, with the error it refused with — so a ledger path turned into a directory, or a `live/` the console
 * cannot write to, still leaves the failed run where the monitor reads.
 *
 * A file's generation is the SHA-256 of its first line, read from at most its first {@link GENERATION_READ_BYTES} bytes.
 * The writer opens every new or emptied file on a header, `{"generation":"<uuid>"}`, written with its first row in
 * one write, so that first line is unique to the file: a file deleted or emptied by hand comes back under a new
 * generation. A row records the OTHER file's size and generation as it was written, and that size orders the two
 * files only while the file still has that generation. A file written before the header existed is identified by its
 * own first row, and so is one whose first write tore, so neither can pass for the other.
 */
import { createHash } from "node:crypto";
import { closeSync, constants, existsSync, fstatSync, openSync, readSync } from "node:fs";

import { errorMessage } from "#lib/errorMessage.js";
import { err, ok, type Result } from "#lib/result.js";

import { readJsonlLines } from "../corpus/corpusStore.js";
import { isRecord } from "../lib/parsers.js";
import { stateHomePaths } from "../stateHome.js";

/** One failed run as the console observed it. */
export interface ConsoleSyncFailure {
  readonly failureId: string;
  readonly slug: string;
  readonly title: string;
  readonly startedAtIso: string;
  readonly tookMs: number;
  readonly why: string;
  /**
   * On a ledger row, the fallback's size in bytes just before this row was appended, so every fallback row starting
   * below it arrived first. Absent when unmeasured, and on every row written before the fallback existed.
   */
  readonly fallbackBytes?: number;
  /**
   * On a ledger row, the fallback's generation when {@link fallbackBytes} was measured. Absent when the fallback was
   * absent or empty, and on every row written before the field existed — whose size then applies only when it is 0.
   */
  readonly fallbackGeneration?: string;
}

/** A failed run the ledger refused, as its fallback holds it. */
export interface ConsoleSyncAppendFailure {
  readonly failure: ConsoleSyncFailure;
  /** What the filesystem said when the ledger refused the row. */
  readonly appendError: string;
  /** The ledger's size in bytes when it refused this row, the mirror of `fallbackBytes`; absent when unmeasured. */
  readonly ledgerBytes?: number;
  /** The ledger's generation when {@link ledgerBytes} was measured, the mirror of `fallbackGeneration`. */
  readonly ledgerGeneration?: string;
}

/** A ledger as read: every row that decoded, in the order written, and how many lines did not. */
interface ReadLedger<Row> {
  readonly failures: readonly Row[];
  /** Where each of {@link failures}' lines starts in the file, index for index — what the other file's sizes compare to. */
  readonly byteOffsets: readonly number[];
  /** Lines that did not decode — counted, never fatal, so one damaged line cannot hide every later failure. */
  readonly damaged: number;
  /** The file's generation, or `undefined` when it is absent or empty — a size recorded for it applies only under it. */
  readonly generation: string | undefined;
  readonly path: string;
}

/** The console sync failure ledger as read. */
export type ConsoleSyncLedger = ReadLedger<ConsoleSyncFailure>;

/** The fallback ledger as read: each failure the console sync failure ledger refused. */
export type ConsoleSyncAppendFailureLedger = ReadLedger<ConsoleSyncAppendFailure>;

/**
 * Read every console sync failure in the order written. An absent ledger is no failures. A line that does not
 * decode is COUNTED rather than failing the read: nothing trims this ledger, so a read that one bad line could fail
 * would stay failed for good and keep every later failure off a card. Only a ledger that cannot be read at all fails.
 *
 * @returns the decoded rows with the damaged count, or why the ledger could not be read
 */
export function readConsoleSyncFailures({ home }: { home: string }): Result<ConsoleSyncLedger> {
  return readLedger({
    decode: decodeFailure,
    name: "the console sync failure ledger",
    path: stateHomePaths({ home }).live.consoleSyncFailuresJsonl,
  });
}

/**
 * Read every failure the console sync failure ledger refused, from its fallback at the home root, by the same
 * contract as {@link readConsoleSyncFailures}: absent is none, a damaged line is counted, an unreadable file fails.
 *
 * @returns the decoded rows with the damaged count, or why the fallback could not be read
 */
export function readConsoleSyncAppendFailures({ home }: { home: string }): Result<ConsoleSyncAppendFailureLedger> {
  return readLedger({
    decode: decodeAppendFailure,
    name: "the console sync failure fallback ledger",
    path: stateHomePaths({ home }).consoleSyncFailureAppendFailuresJsonl,
  });
}

/** Read one JSON-lines ledger, decoding each line, counting the ones that do not decode. */
function readLedger<Row>({
  decode,
  name,
  path,
}: {
  decode: (args: { value: unknown }) => Row | undefined;
  name: string;
  path: string;
}): Result<ReadLedger<Row>> {
  if (!existsSync(path)) {
    return ok({ byteOffsets: [], damaged: 0, failures: [], generation: undefined, path });
  }
  const failures: Row[] = [];
  const byteOffsets: number[] = [];
  let undecodable = 0;
  let generation: string | undefined;
  try {
    generation = generationOf({ path });
    readJsonlLines({
      onLine: ({ byteOffset, line }) => {
        if (line === "") {
          return;
        }
        const value = parsedOrUndefined({ line });
        // Only the first line can be the header; one anywhere else is a damaged row.
        if (byteOffset === 0 && isHeader({ value })) {
          return;
        }
        const row = decode({ value });
        if (row === undefined) {
          undecodable += 1;
          return;
        }
        failures.push(row);
        byteOffsets.push(byteOffset);
      },
      path,
      strictUtf8: true,
    });
  } catch (cause) {
    return err([`${name} at ${path} could not be read: ${errorMessage({ error: cause })}`]);
  }
  return ok({ byteOffsets, damaged: undecodable, failures, generation, path });
}

/**
 * The most of a file's leading bytes its generation is read from. Restated by the writer
 * (`site/lib/consoleSyncFailureAppend.ts`); the mirror test holds the two equal by what each records.
 */
const GENERATION_READ_BYTES = 4096;

/**
 * A file's generation: the SHA-256 of its first line — the bytes before the first newline inside its first
 * {@link GENERATION_READ_BYTES}, or all of those bytes when none is a newline — or `undefined` for an empty file.
 * Read from raw bytes, exactly as the writer reads it, so the two can never disagree over a line's decoding.
 */
function generationOf({ path }: { path: string }): string | undefined {
  // Non-blocking, so a FIFO at the path cannot hang the sweep; anything but a regular file has no generation.
  const fd = openSync(path, constants.O_RDONLY | constants.O_NONBLOCK);
  try {
    if (!fstatSync(fd).isFile()) {
      return undefined;
    }
    const head = Buffer.alloc(GENERATION_READ_BYTES);
    const read = readSync(fd, head, 0, head.length, 0);
    if (read === 0) {
      return undefined;
    }
    const bytes = head.subarray(0, read);
    const newline = bytes.indexOf(0x0a);
    return createHash("sha256")
      .update(newline === -1 ? bytes : bytes.subarray(0, newline))
      .digest("hex");
  } finally {
    closeSync(fd);
  }
}

/**
 * Whether a parsed first line is the generation header: an object whose only key is `generation`, holding a lowercase
 * UUID as `crypto.randomUUID` spells it. Anything else is read as a row, and counted as damage when it is not one.
 */
function isHeader({ value }: { value: unknown }): boolean {
  return (
    isRecord(value) &&
    Object.keys(value).length === 1 &&
    typeof value["generation"] === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.test(value["generation"])
  );
}

/** Whether a stored value is a generation: a SHA-256 in lowercase hex. */
function isGeneration(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{64}$/u.test(value);
}

/** Whether a stored value is absent or a generation token. */
function isOptionalGeneration(value: unknown): value is string | undefined {
  return value === undefined || isGeneration(value);
}

/** One line parsed as JSON, or `undefined` when it is not JSON — which no decoder accepts. */
function parsedOrUndefined({ line }: { line: string }): unknown {
  try {
    return JSON.parse(line);
  } catch {
    return undefined;
  }
}

/** One fallback row, or `undefined` when it is malformed. */
function decodeAppendFailure({ value }: { value: unknown }): ConsoleSyncAppendFailure | undefined {
  if (!isRecord(value) || !isNonemptyString(value["appendError"])) {
    return undefined;
  }
  const failure = decodeFailure({ value: value["failure"] });
  const ledgerBytes = value["ledgerBytes"];
  const ledgerGeneration = value["ledgerGeneration"];
  if (failure === undefined || !isOptionalByteCount(ledgerBytes) || !isOptionalGeneration(ledgerGeneration)) {
    return undefined;
  }
  return {
    appendError: value["appendError"],
    failure,
    ...(ledgerBytes === undefined ? {} : { ledgerBytes }),
    ...(ledgerGeneration === undefined ? {} : { ledgerGeneration }),
  };
}

/** Whether a stored size is absent or a whole number of bytes. */
function isOptionalByteCount(value: unknown): value is number | undefined {
  return value === undefined || (typeof value === "number" && Number.isSafeInteger(value) && value >= 0);
}

/** One failure row, or `undefined` when it is malformed. */
function decodeFailure({ value }: { value: unknown }): ConsoleSyncFailure | undefined {
  if (
    !isRecord(value) ||
    !isLedgerId(value["failureId"]) ||
    !isNonemptyString(value["slug"]) ||
    !isNonemptyString(value["title"]) ||
    !isIsoInstant(value["startedAtIso"]) ||
    typeof value["tookMs"] !== "number" ||
    !Number.isFinite(value["tookMs"]) ||
    value["tookMs"] < 0 ||
    !isNonemptyString(value["why"]) ||
    !isOptionalByteCount(value["fallbackBytes"]) ||
    !isOptionalGeneration(value["fallbackGeneration"])
  ) {
    return undefined;
  }
  const fallbackBytes = value["fallbackBytes"];
  const fallbackGeneration = value["fallbackGeneration"];
  return {
    failureId: value["failureId"],
    slug: value["slug"],
    startedAtIso: value["startedAtIso"],
    title: value["title"],
    tookMs: value["tookMs"],
    why: value["why"],
    ...(fallbackBytes === undefined ? {} : { fallbackBytes }),
    ...(fallbackGeneration === undefined ? {} : { fallbackGeneration }),
  };
}

/** Whether a stored value is non-empty text. */
function isNonemptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

/** Whether a stored value is the exact ISO spelling written by `Date.toISOString`. */
function isIsoInstant(value: unknown): value is string {
  if (typeof value !== "string") {
    return false;
  }
  const epochMs = Date.parse(value);
  return Number.isFinite(epochMs) && new Date(epochMs).toISOString() === value;
}

/**
 * Whether a failure id is safe as the monitor subject key: the hand-step id shape (`../hand/step.ts`) and short enough
 * that `mon-console-sync-<id>.<n>` stays inside its 60-character cap. Anything else reads loud, never as a card the
 * register would refuse in silence.
 */
function isLedgerId(value: unknown): value is string {
  return typeof value === "string" && value.length <= 36 && /^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(value);
}
