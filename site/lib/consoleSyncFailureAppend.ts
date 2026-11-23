/**
 * The console's half of the console sync failure ledger: one durable line per refresh the console started that
 * failed, which `src/live/consoleSyncFailureStore.ts` reads for the `console-sync-failed` monitor.
 *
 * Written here rather than by spawning a verb to record it, because the failure being recorded can be a verb that
 * would not start at all. `site/` never imports `src/`, so the row shapes are restated, and
 * `src/__tests__/unit/live/consoleSyncFailureAppendMirror.test.ts` holds the paths, the rows and the modes equal to
 * what the reader accepts.
 *
 * When the ledger refuses the row — its path is a directory, or `live/` cannot be written — the row goes to a
 * fallback ledger at the home root with the error the ledger refused it with, so the failed run still reaches the
 * monitor rather than only the browser tab that pressed.
 *
 * Each new or emptied file opens on a header, `{"generation":"<uuid>"}`, written in the same write as its first row,
 * so its first line is unique to it. A file's generation is the SHA-256 of that first line, and each row records the
 * other file's size AND generation, so the reader never orders a row by a size measured on a file that has since been
 * deleted or emptied by hand.
 */
import { createHash, randomUUID } from "node:crypto";
import {
  closeSync,
  fchmodSync,
  fstatSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readSync,
  statSync,
  writeSync,
} from "node:fs";
import { dirname } from "node:path";

import { consoleHomePaths } from "./consoleHome";

/** One failed run as the console observed it — the reader's `ConsoleSyncFailure`, restated. */
export interface ConsoleSyncFailure {
  readonly failureId: string;
  readonly slug: string;
  readonly title: string;
  readonly startedAtIso: string;
  readonly tookMs: number;
  readonly why: string;
  /**
   * On a ledger row, the fallback's size in bytes just before this row was appended — so every fallback row starting
   * below it arrived first, whatever the clock said. Absent when that size could not be measured.
   */
  readonly fallbackBytes?: number;
  /** On a ledger row, the fallback's generation when {@link fallbackBytes} was measured; absent when it was empty. */
  readonly fallbackGeneration?: string;
}

/** A failed run the ledger refused, as the fallback holds it — the reader's `ConsoleSyncAppendFailure`, restated. */
export interface ConsoleSyncAppendFailure {
  readonly failure: ConsoleSyncFailure;
  /** What the filesystem said when the ledger refused the row. */
  readonly appendError: string;
  /** The ledger's size in bytes when it refused this row, the mirror of `fallbackBytes`; absent when unmeasurable. */
  readonly ledgerBytes?: number;
  /** The ledger's generation when {@link ledgerBytes} was measured; absent when it was empty. */
  readonly ledgerGeneration?: string;
}

/** Where the other file stood as a row was written: its size and its generation, `undefined` when it was empty. */
interface FilePosition {
  readonly bytes: number;
  readonly generation: string | undefined;
}

/** The most of a file's leading bytes its generation is read from — the reader's `GENERATION_READ_BYTES`, restated. */
const GENERATION_READ_BYTES = 4096;

/**
 * Where a failed run was recorded: the ledger, the fallback with the ledger's error, or nowhere with both errors.
 * Every arm but `recorded` carries the sentence the route adds to the browser reply.
 */
export type ConsoleSyncFailureRecord =
  | { readonly kind: "recorded"; readonly path: string }
  | { readonly kind: "fallback"; readonly path: string; readonly appendError: string; readonly notice: string }
  | { readonly kind: "lost"; readonly appendError: string; readonly fallbackError: string; readonly notice: string };

/**
 * Record one failed run for the fleet: appended to the ledger, or — when the ledger refuses it — to the fallback
 * ledger at the home root with the ledger's error. Never throws: a refusal from both is the `lost` arm, naming
 * both errors for the route to show beside the failure it was recording.
 *
 * @param failure the failed run
 * @param home the state home, given only by a test that writes into a throwaway one
 * @returns where the row landed, and the sentence for the browser when it was not the ledger
 */
export function appendConsoleSyncFailure({
  failure,
  home,
}: {
  failure: ConsoleSyncFailure;
  home?: string;
}): ConsoleSyncFailureRecord {
  const paths = consoleHomePaths(home === undefined ? {} : { home });
  // A run time is wall-clock, so a clock stepped back mid-run would make it negative, which the reader refuses.
  const row = { ...failure, tookMs: Math.max(0, failure.tookMs) };
  // Each row records the OTHER file's size and generation as it is written, so the reader orders the two files by
  // what each held at the time rather than by a clock that can step back. The writes are synchronous in one server
  // process, so nothing lands in between.
  const fallback = filePosition({ path: paths.consoleSyncFailureAppendFailures });
  let appendError: string;
  try {
    appendJsonLine({
      path: paths.consoleSyncFailures,
      value: {
        ...row,
        ...(fallback === undefined ? {} : { fallbackBytes: fallback.bytes }),
        ...(fallback?.generation === undefined ? {} : { fallbackGeneration: fallback.generation }),
      },
    });
    return { kind: "recorded", path: paths.consoleSyncFailures };
  } catch (cause: unknown) {
    appendError = messageOf({ cause });
  }
  const ledger = filePosition({ path: paths.consoleSyncFailures });
  const fallbackRow: ConsoleSyncAppendFailure = {
    appendError,
    failure: row,
    ...(ledger === undefined ? {} : { ledgerBytes: ledger.bytes }),
    ...(ledger?.generation === undefined ? {} : { ledgerGeneration: ledger.generation }),
  };
  try {
    appendJsonLine({ path: paths.consoleSyncFailureAppendFailures, value: fallbackRow });
  } catch (cause: unknown) {
    const fallbackError = messageOf({ cause });
    return {
      appendError,
      fallbackError,
      kind: "lost",
      notice: `the server could not record this failure for the fleet: its ledger refused it (${appendError}) and so did the fallback (${fallbackError})`,
    };
  }
  return {
    appendError,
    kind: "fallback",
    notice: `the server's failure ledger refused this failure (${appendError}), so the fleet reads it from ${paths.consoleSyncFailureAppendFailures} instead`,
    path: paths.consoleSyncFailureAppendFailures,
  };
}

/**
 * A ledger file's size in bytes and the generation its first line carries, both read through one descriptor so they
 * describe the same file: 0 bytes and no generation when it does not exist yet, since it then holds no row;
 * `undefined` when it cannot be measured or is not a regular file, so the reader falls back to the other file's
 * record, then the clock. Never throws.
 */
function filePosition({ path }: { path: string }): FilePosition | undefined {
  let fd: number;
  try {
    // A directory or a socket is refused before it is opened, and a fifo is never opened at all.
    if (!statSync(path).isFile()) {
      return undefined;
    }
    fd = openSync(path, "r");
  } catch (cause: unknown) {
    if (cause instanceof Error && "code" in cause && cause.code === "ENOENT") {
      return { bytes: 0, generation: undefined };
    }
    return undefined;
  }
  try {
    const { size } = fstatSync(fd);
    const head = Buffer.alloc(Math.min(size, GENERATION_READ_BYTES));
    const read = readSync(fd, head, 0, head.length, 0);
    return { bytes: size, generation: generationOf({ head: head.subarray(0, read) }) };
  } catch {
    return undefined;
  } finally {
    closeSync(fd);
  }
}

/**
 * A file's generation from its leading bytes: the SHA-256 of its first line — the bytes before the first newline, or
 * all of them when none is one — or `undefined` for an empty file. The reader's `generationOf`, restated.
 */
function generationOf({ head }: { head: Buffer }): string | undefined {
  if (head.length === 0) {
    return undefined;
  }
  const newline = head.indexOf(0x0a);
  return createHash("sha256")
    .update(newline === -1 ? head : head.subarray(0, newline))
    .digest("hex");
}

/** A thrown value's message, or the value itself as text. */
function messageOf({ cause }: { cause: unknown }): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/**
 * Append one value as a JSON line, fsync'd, leaving the file owner-only whether it was just created or not. A parent
 * directory that already exists keeps its own mode: `live/` holds every other live store, the home everything.
 * Throws when the filesystem refuses.
 *
 * The writer cannot make a line the reader refuses: every byte is written, and a file left ending mid-line by an
 * earlier torn write gets a newline first, so that fragment stays one damaged line rather than swallowing this row.
 */
function appendJsonLine({ path, value }: { path: string; value: unknown }): void {
  mkdirSync(dirname(path), { mode: 0o700, recursive: true });
  const fd = openSync(path, "a+", 0o600);
  try {
    // The create mode reaches a NEW file only; a file left wider by an earlier writer is narrowed before the row.
    fchmodSync(fd, 0o600);
    writeWhole({ bytes: Buffer.from(`${leadOf({ fd })}${JSON.stringify(value)}\n`), fd });
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  flushDirectory({ dir: dirname(path) });
}

/**
 * What goes before the row in the open file: a fresh generation header when the file is empty — absent, deleted or
 * emptied since — so it is written in the same write as the first row; a newline when the last byte is not one, the
 * tail a torn write leaves; else nothing. A non-empty file without a header never gains one, so a file written before
 * the header existed keeps reading as generation `undefined`.
 */
function leadOf({ fd }: { fd: number }): string {
  const { size } = fstatSync(fd);
  if (size === 0) {
    return `${JSON.stringify({ generation: randomUUID() })}\n`;
  }
  const last = Buffer.alloc(1);
  readSync(fd, last, 0, 1, size - 1);
  return last[0] === 0x0a ? "" : "\n";
}

/** Write every byte, since one `writeSync` may write fewer than it was given. */
function writeWhole({ bytes, fd }: { bytes: Buffer; fd: number }): void {
  let offset = 0;
  while (offset < bytes.length) {
    offset += writeSync(fd, bytes, offset, bytes.length - offset);
  }
}

/** Flush the directory so a newly created ledger's entry survives a crash, best effort as in `./callLeaseFile.ts`. */
function flushDirectory({ dir }: { dir: string }): void {
  try {
    const fd = openSync(dir, "r");
    try {
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
  } catch {
    // A directory cannot be flushed on every platform; the row's own bytes are already on the device.
  }
}
