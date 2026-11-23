/**
 * The one filesystem read behind a snapshot outline: the filed snapshot, whole, as UTF-8.
 *
 * Whole because an outline counts what it left out and `--find` searches every line, and both are wrong over a
 * prefix. There is no fallback — not a prefix, not an empty outline, not a fresh look — because each would hand a
 * session an answer about a page it did not read.
 */
import { readFileSync } from "node:fs";

import { errorMessage } from "../lib/errorMessage.js";
import { err, ok, type Result } from "../lib/result.js";
import { type ElementsError, ElementsErrors } from "./elementsError.js";

/**
 * Read a filed snapshot whole.
 *
 * @param path the snapshot file a look filed
 * @returns its text, or why it could not be read
 */
export function readSnapshotYaml({ path }: { path: string }): Result<string, ElementsError> {
  try {
    return ok(readFileSync(path, "utf8"));
  } catch (error: unknown) {
    return err(ElementsErrors.snapshotUnreadable({ detail: errorMessage({ error }), path }));
  }
}
