/**
 * The effectful shell around `./alignmentBoardProjection.ts` — read the projection file, and write it atomically.
 *
 * A read names WHICH way it failed — missing, unreadable, invalid — and never answers an empty projection: the
 * one caller that reads it (`handover alignment-board`) rebuilds from the board on any of the three, and says
 * which one it was.
 */

import { readFileSync } from "node:fs";
import { dirname } from "node:path";

import { errorMessage } from "#lib/errorMessage.js";
import { err, ok, type Result } from "#lib/result.js";
import { ensureDirectory, writeFileAtomic } from "#lib/writeAtomic.js";

import {
  type AlignmentBoardProjection,
  parseAlignmentBoardProjection,
  renderAlignmentBoardProjection,
} from "./alignmentBoardProjection.js";
import {
  type AlignmentBoardProjectionError,
  AlignmentBoardProjectionErrors,
} from "./alignmentBoardProjectionErrors.js";

/**
 * The projection on disk, whole, or the one reason it is not.
 *
 * @param path the projection's own file, from `stateHome.ts`'s `alignmentBoardJson`
 * @returns the projection, or why it is missing, unreadable or invalid
 */
export function readAlignmentBoardProjection({
  path,
}: {
  path: string;
}): Result<AlignmentBoardProjection, AlignmentBoardProjectionError> {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (cause) {
    if (cause instanceof Error && "code" in cause && cause.code === "ENOENT") {
      return err(AlignmentBoardProjectionErrors.missing({ path }));
    }
    return err(AlignmentBoardProjectionErrors.unreadable({ detail: errorMessage({ error: cause }), path }));
  }
  return parseAlignmentBoardProjection({ path, text });
}

/**
 * Write the projection, atomically — a reader sees the old file or the new one, never half of either.
 *
 * @param path the projection's own file
 * @param projection what to record
 * @returns the path written, or the one reason it was not
 */
export function writeAlignmentBoardProjection({
  path,
  projection,
}: {
  path: string;
  projection: AlignmentBoardProjection;
}): Result<string, AlignmentBoardProjectionError> {
  try {
    ensureDirectory({ directory: dirname(path) });
    writeFileAtomic({ contents: renderAlignmentBoardProjection({ projection }), path });
  } catch (cause) {
    return err(AlignmentBoardProjectionErrors.writeFailed({ detail: errorMessage({ error: cause }), path }));
  }
  return ok(path);
}
