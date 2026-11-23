/**
 * The GCP door's two local file edges for a secret: reading a payload to add, and writing an accessed one.
 *
 * Reading refuses a symlink, a non-regular file and anything over Secret Manager's 64 KiB, so the bytes that go
 * up are the bytes of exactly the file named. Writing creates a NEW file, mode `0600`, and refuses a path that
 * already exists — `O_EXCL` makes that one atomic step, so an existing file is never truncated and a symlink
 * planted at the path is never followed. Neither ever prints a byte; a refusal names the path.
 */
import { closeSync, constants, fstatSync, openSync, readFileSync, writeSync } from "node:fs";

import { errorMessage } from "#lib/errorMessage.js";
import { err, ok, type Result } from "#lib/result.js";

import { type GcpDoorError, GcpDoorErrors } from "./errors.js";
import { SECRET_PAYLOAD_MAX_BYTES } from "./secretPayload.js";

/**
 * Read a payload file's exact bytes.
 *
 * @param path the `--data-file` path
 * @returns the bytes, or `SECRET_FILE_FAILED` naming why the file was refused
 */
export function readSecretFile({ path }: { path: string }): Result<Uint8Array, GcpDoorError> {
  let descriptor: number | null = null;
  try {
    descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const stats = fstatSync(descriptor);
    if (!stats.isFile()) {
      return err(GcpDoorErrors.secretFile({ path, why: "not a regular file" }));
    }
    if (stats.size > SECRET_PAYLOAD_MAX_BYTES) {
      return err(
        GcpDoorErrors.secretFile({
          path,
          why: `${String(stats.size)} bytes, over Secret Manager's ${String(SECRET_PAYLOAD_MAX_BYTES)}`,
        }),
      );
    }
    return ok(new Uint8Array(readFileSync(descriptor)));
  } catch (error: unknown) {
    return err(GcpDoorErrors.secretFile({ path, why: errorMessage({ error }) }));
  } finally {
    if (descriptor !== null) {
      closeSync(descriptor);
    }
  }
}

/**
 * Write accessed bytes to a new owner-only file.
 *
 * @param path the `--to-file` path; it must not exist
 * @param bytes the decoded, checked payload
 * @returns nothing, or `SECRET_FILE_FAILED` — an existing path is refused and left untouched
 */
export function writeSecretFile({ path, bytes }: { path: string; bytes: Uint8Array }): Result<void, GcpDoorError> {
  let descriptor: number | null = null;
  try {
    descriptor = openSync(
      path,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
      0o600,
    );
    let written = 0;
    while (written < bytes.length) {
      written += writeSync(descriptor, bytes, written);
    }
    return ok(undefined);
  } catch (error: unknown) {
    const exists = error instanceof Error && "code" in error && error.code === "EEXIST";
    return err(
      GcpDoorErrors.secretFile({
        path,
        why: exists ? "the path already exists — the door never overwrites a file" : errorMessage({ error }),
      }),
    );
  } finally {
    if (descriptor !== null) {
      closeSync(descriptor);
    }
  }
}
