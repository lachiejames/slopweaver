/**
 * Reading a corpus row back by where it sits — the half of the corpus census that turns a skinny entry back
 * into its record, one positioned read at a time, so a caller holds a batch of bodies rather than the corpus.
 *
 * A descriptor is opened per file on first use and closed when {@link withRowReader}'s work ends, however it
 * ends. A row whose bytes no longer parse means the file changed underneath the read — most likely a
 * compaction rewrote it — and is a typed failure naming the file and offset, never a silently wrong record.
 */
import { closeSync, openSync, readSync } from "node:fs";

import { err, ok, type Result } from "#lib/result.js";
import { safeFs } from "#lib/safeBoundary.js";

import { type CensusRowUnreadableError, CorpusCensusErrors } from "./corpusCensus.errors.js";
import { type CorpusProjection, parseRow } from "./corpusRowCore.js";
import type { CorpusRecord } from "./types.js";

/** Where one row sits on disk: enough to read it back with one positioned read, and nothing else. */
export interface RowPointer {
  readonly path: string;
  readonly byteOffset: number;
  readonly byteLength: number;
}

/**
 * The typed failure for one row that could not be read back where its pointer says it sits.
 *
 * @param reason what the read or the parse reported
 * @returns the typed error, naming the file and offset
 */
export function rowUnreadable({ pointer, reason }: { pointer: RowPointer; reason: string }): CensusRowUnreadableError {
  return CorpusCensusErrors.rowUnreadable({ byteOffset: pointer.byteOffset, path: pointer.path, reason });
}

/**
 * Reads rows back by pointer, holding one descriptor per file for as long as it is open. Open one with
 * {@link withRowReader}, which closes every descriptor however the work inside it ends.
 */
export interface RowReader {
  /** The row's text, exactly as {@link ./corpusStore.readJsonlLines} delivered it. */
  readonly line: (args: { pointer: RowPointer }) => Result<string, CensusRowUnreadableError>;
  /** The row parsed under a projection — an error when the bytes there no longer parse into a record. */
  readonly record: (args: {
    pointer: RowPointer;
    projection: CorpusProjection;
  }) => Result<CorpusRecord, CensusRowUnreadableError>;
}

/**
 * Run some work with a {@link RowReader}, closing every descriptor it opened afterwards — including when the
 * work throws.
 *
 * @param run the work, handed the reader
 * @returns whatever the work returned
 */
export function withRowReader<T>({ run }: { run: (reader: RowReader) => T }): T {
  const descriptors = new Map<string, number>();
  const line = ({ pointer }: { pointer: RowPointer }): Result<string, CensusRowUnreadableError> => {
    const read = safeFs({
      execute: () => {
        let fd = descriptors.get(pointer.path);
        if (fd === undefined) {
          fd = openSync(pointer.path, "r");
          descriptors.set(pointer.path, fd);
        }
        const buffer = Buffer.allocUnsafe(pointer.byteLength);
        const got = readSync(fd, buffer, 0, pointer.byteLength, pointer.byteOffset);
        return buffer.subarray(0, got).toString("utf8");
      },
      operation: "corpusCensus.readRow",
      path: pointer.path,
    });
    return read.isErr() ? err(rowUnreadable({ pointer, reason: read.error.message })) : ok(read.value);
  };
  const reader: RowReader = {
    line,
    record: ({ pointer, projection }) => {
      const text = line({ pointer });
      if (text.isErr()) {
        return err(text.error);
      }
      const parsed = parseRow({ line: text.value, projection });
      if (!("record" in parsed)) {
        return err(rowUnreadable({ pointer, reason: parsed.error }));
      }
      return ok(parsed.record);
    },
  };
  try {
    return run(reader);
  } finally {
    for (const fd of descriptors.values()) {
      closeSync(fd);
    }
  }
}
