/**
 * The register FILE's lines a reader could not decode — the pure half of refusing to answer from part of it.
 *
 * `./importRegister.ts` skips a line that will not decode and carries it out of the read
 * (`./types.ts`'s `AutonomyRegisterRead`), so `autonomy adopt` can name every one in a single pass. A reader whose
 * answer is an ABSENCE — "no act carries that id" — cannot skip, because the thing it would conclude is missing
 * could be on the skipped line. {@link completeAutonomyRecords} is that reader's door: it refuses, naming the
 * lines, rather than answering from part of the file.
 */
import { err, ok, type Result } from "../lib/result.js";

import { AutonomyErrors, type RegisterIncompleteError } from "./errors.js";
import type { AutonomyRecord, AutonomyRegisterRead } from "./types.js";

/**
 * Every record, but only when the read skipped nothing — for a reader whose answer is an absence.
 *
 * @param read one read of the register
 * @returns the records, or a refusal naming every line that could not be read
 */
export function completeAutonomyRecords({
  read,
}: {
  read: AutonomyRegisterRead;
}): Result<readonly AutonomyRecord[], RegisterIncompleteError> {
  if (read.unparsed.length > 0) {
    return err(AutonomyErrors.registerIncomplete({ lineNumbers: read.unparsed.map((error) => error.lineNumber) }));
  }
  return ok(read.records);
}
