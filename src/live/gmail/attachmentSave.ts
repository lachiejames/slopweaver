/**
 * Puts an attachment's verified bytes on disk: one owner-only message directory, proven real at every level the
 * attachment tree owns, then the injected atomic write. `gmail attachment` saves through it, and `outlook
 * attachment` shares the directory check.
 */
import { lstatSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

import { err, ok, type Result } from "../../lib/result.js";
import { safeFs } from "../../lib/safeBoundary.js";
import { type GmailError, GmailErrors } from "./errors.js";

/**
 * How many directories, from the message directory upwards, the attachment tree owns:
 * `<message-id>`, `attachments`, `gmail` and `live` under `$SLOPWEAVER_HOME` (`stateHomePaths`).
 */
const OWNED_DIRECTORY_DEPTH = 4;

/**
 * Create the message directory owner-only and prove it and every directory above it that the attachment tree
 * owns are REAL directories. `mkdir -p` succeeds through a symlink at ANY level, and the atomic write's rename
 * only protects the final path component, so `lstat` on each owned level is what stops a linked `live`,
 * `gmail`, `attachments` or message directory sending the bytes somewhere else. The home itself may be a
 * link, and is not checked. Residue: a swap between this check and the write needs local write access to the
 * home, and is not closed here.
 *
 * @param directory the checked message directory
 * @returns nothing, or the typed reason the directory is unusable
 */
export function prepareAttachmentDirectory({ directory }: { directory: string }): Result<void, GmailError> {
  const made = safeFs({
    execute: () => {
      mkdirSync(directory, { mode: 0o700, recursive: true });
      let level = directory;
      for (let depth = 0; depth < OWNED_DIRECTORY_DEPTH; depth += 1) {
        if (!lstatSync(level).isDirectory()) {
          return false;
        }
        level = dirname(level);
      }
      return true;
    },
    operation: "gmail.attachment.prepareDirectory",
    path: directory,
  });
  if (made.isErr()) {
    return err(GmailErrors.destinationUnusable({ destination: directory, reason: made.error.message }));
  }
  if (!made.value) {
    return err(GmailErrors.destinationUnusable({ destination: directory, reason: "it is not a real directory" }));
  }
  return ok(undefined);
}

/** Writes the bytes to a path, owner-only and atomically; throws on failure. */
export type WriteAttachmentBytes = (args: { path: string; bytes: Buffer }) => void;

/**
 * Prepare the checked directory, then write the verified bytes through the injected atomic write.
 *
 * @returns nothing, or the typed reason the bytes could not be saved
 */
export function saveAttachmentBytes({
  bytes,
  directory,
  path,
  writeBytes,
}: {
  bytes: Buffer;
  directory: string;
  path: string;
  writeBytes: WriteAttachmentBytes;
}): Result<void, GmailError> {
  const prepared = prepareAttachmentDirectory({ directory });
  if (prepared.isErr()) {
    return err(prepared.error);
  }
  const written = safeFs({
    execute: () => {
      writeBytes({ bytes, path });
    },
    operation: "gmail.attachment.write",
    path,
  });
  if (written.isErr()) {
    return err(GmailErrors.destinationUnusable({ destination: path, reason: written.error.message }));
  }
  return ok(undefined);
}
