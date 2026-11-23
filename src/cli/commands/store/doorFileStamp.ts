/**
 * The door import's file stamp: nothing locks `ledgers/door.jsonl` while it is imported, so its size and
 * modification time are taken before the first pass and compared again after the read-back and after the marker.
 * A seat still appending to it in that window is refused loudly rather than reported as a clean import.
 */
import { statSync } from "node:fs";

import { err, ok, type Result } from "../../../lib/result.js";
import { type FleetImportError, FleetImportErrors } from "../../../store/fleet/errors.js";

/**
 * The file's size and modification time as one comparable token.
 *
 * @param path the ledger file
 * @returns the stamp, or the leg's write failure carrying the stat's own message
 */
export function fileStamp({ path }: { path: string }): Result<string, FleetImportError> {
  try {
    const stat = statSync(path);
    return ok(`${String(stat.size)}:${String(stat.mtimeMs)}`);
  } catch (cause: unknown) {
    const reason = cause instanceof Error ? cause.message : "the stat failed";
    return err(FleetImportErrors.legWriteFailed({ path, reason }));
  }
}

/**
 * The refusal when the file changed since `before` was stamped — a line appended mid-pass — else nothing.
 *
 * @param before the stamp taken before the first pass
 * @param verifying whether this pass only verified an import that had already run, which names the refusal
 * @returns no refusal for an unchanged file, else the one refusal naming what was interrupted
 */
export function changedFileRefusals({
  before,
  path,
  verifying,
}: {
  before: string;
  path: string;
  verifying: boolean;
}): readonly FleetImportError[] {
  const after = fileStamp({ path });
  if (after.isOk() && after.value === before) {
    return [];
  }
  const doing = verifying ? "verified" : "imported";
  const reason = `the file changed while it was being ${doing} — stop every seat still writing it, then import again`;
  return [FleetImportErrors.legWriteFailed({ path, reason })];
}
