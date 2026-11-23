/**
 * The two reads a profile delivery marker makes of a session's transcript (`./profileDelivery.ts`): the bytes appended
 * since the marker's last check, and where the last whole line ends when a marker is written. Both are bounded reads
 * through one descriptor rather than a whole-file read, because a long session's transcript runs to megabytes and the
 * check sits on the path every guarded call takes.
 */
import { closeSync, fstatSync, openSync, readSync } from "node:fs";

import { isRecord } from "#lib/parsers.js";
import { err, ok, type Result } from "#lib/result.js";

import { type ProfileDeliveryError, ProfileDeliveryErrors } from "./profileDeliveryErrors.js";

/** How far back a marker write looks for the last whole line of the transcript, per read. */
const TAIL_STEP_BYTES = 64 * 1024;

/**
 * The transcript's bytes from an offset to its end.
 *
 * @param path the transcript
 * @param offset where the marker's last check stopped
 * @returns the bytes; `undefined` when the file is shorter than the offset; empty when it does not exist and the
 *   offset is zero (a session whose host has not written its first line yet); or why it could not be read
 */
export function transcriptBytesFrom({
  path,
  offset,
}: {
  path: string;
  offset: number;
}): Result<Buffer | undefined, ProfileDeliveryError> {
  let fd: number;
  try {
    fd = openSync(path, "r");
  } catch (cause) {
    if (isRecord(cause) && cause["code"] === "ENOENT") {
      return ok(offset === 0 ? Buffer.alloc(0) : undefined);
    }
    return err(ProfileDeliveryErrors.transcriptUnreadable({ cause, path }));
  }
  try {
    const size = fstatSync(fd).size;
    if (size < offset) {
      return ok(undefined);
    }
    const bytes = Buffer.allocUnsafe(size - offset);
    let filled = 0;
    while (filled < bytes.length) {
      const read = readSync(fd, bytes, filled, bytes.length - filled, offset + filled);
      if (read === 0) {
        break;
      }
      filled += read;
    }
    return ok(bytes.subarray(0, filled));
  } catch (cause) {
    return err(ProfileDeliveryErrors.transcriptUnreadable({ cause, path }));
  } finally {
    closeSync(fd);
  }
}

/**
 * Where the transcript's last whole line ends — the offset a new marker starts its checks from, so a record the host
 * is part-way through writing is judged by the next check rather than counted as already seen.
 *
 * @param path the transcript
 * @returns the offset (zero for a transcript not written yet), or why it could not be read
 */
export function transcriptLastWholeLineEnd({ path }: { path: string }): Result<number, ProfileDeliveryError> {
  let fd: number;
  try {
    fd = openSync(path, "r");
  } catch (cause) {
    if (isRecord(cause) && cause["code"] === "ENOENT") {
      return ok(0);
    }
    return err(ProfileDeliveryErrors.transcriptUnreadable({ cause, path }));
  }
  try {
    let end = fstatSync(fd).size;
    const chunk = Buffer.allocUnsafe(TAIL_STEP_BYTES);
    while (end > 0) {
      const start = Math.max(0, end - TAIL_STEP_BYTES);
      const read = readSync(fd, chunk, 0, end - start, start);
      const newline = chunk.subarray(0, read).lastIndexOf(0x0a);
      if (newline !== -1) {
        return ok(start + newline + 1);
      }
      end = start;
    }
    return ok(0);
  } catch (cause) {
    return err(ProfileDeliveryErrors.transcriptUnreadable({ cause, path }));
  } finally {
    closeSync(fd);
  }
}
