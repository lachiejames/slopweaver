/**
 * Keep one file the owner attached in the console's Messenger under the home, where the thinking model's `file_read` reads
 * it: the effectful half of `slopweaver talk attach`, whose rules are `./attachment.ts`'s.
 *
 * The console route stages the owner's file in a `0600` file of its own and hands this the path, the way `talk relay` is
 * handed a frame. This re-judges that file rather than trusting the route, because the verb is callable without it:
 * a symlink is never followed (`O_NOFOLLOW`), a FIFO or device is refused before any read, and a file whose size is
 * over its kind's cap is refused on its `fstat` before its bytes are read at all. What passes is written once, whole,
 * to `talk/attachments/<uuid>/<name>`: the directory `0700`, the file `0600` and created exclusively, so nothing is
 * ever written through a path something else already holds. A failed write removes the directory it made.
 *
 * Nothing here reaches a provider. What leaves the machine, and when, is `docs/security/voice-boundary.md`'s.
 */
import {
  closeSync,
  constants,
  fstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

import { errorMessage } from "#lib/errorMessage.js";
import { err, ok, type Result } from "#lib/result.js";

import { stateHomePaths } from "../stateHome.js";
import {
  type Attachment,
  type AttachmentError,
  AttachmentErrors,
  attachmentCapOf,
  attachmentVerdict,
  safeAttachmentName,
} from "./attachment.js";
import { IMAGE_SNIFF_BYTES } from "./imageSniff.js";

/** One attachment kept: where, under what name, what kind, how large. */
export interface KeptAttachment {
  readonly path: string;
  readonly name: string;
  readonly kind: Attachment["kind"];
  /** The picture's type, present only for a picture. */
  readonly mediaType?: string;
  readonly bytes: number;
}

/**
 * The staged file could not be opened or read, or is not a regular file.
 *
 * @internal — reached as a member of {@link AttachmentStoreError}, never named by a consumer.
 */
export interface AttachmentStagedUnreadableError {
  readonly code: "STAGED_UNREADABLE";
  readonly message: string;
  readonly path: string;
}

/**
 * The attachment passed but could not be written under the home.
 *
 * @internal — reached as a member of {@link AttachmentStoreError}, never named by a consumer.
 */
export interface AttachmentWriteFailedError {
  readonly code: "WRITE_FAILED";
  readonly message: string;
  readonly path: string;
}

/** Why `talk attach` kept nothing: the attachment's own refusal, or a fact about the disk. */
export type AttachmentStoreError = AttachmentError | AttachmentStagedUnreadableError | AttachmentWriteFailedError;

/** The store's own error factories; the verdict's are `AttachmentErrors`. */
const AttachmentStoreErrors = {
  stagedUnreadable: ({ path, why }: { path: string; why: string }): AttachmentStagedUnreadableError => ({
    code: "STAGED_UNREADABLE",
    message: `the staged file ${path} ${why}`,
    path,
  }),
  writeFailed: ({ cause, path }: { cause: unknown; path: string }): AttachmentWriteFailedError => ({
    code: "WRITE_FAILED",
    message: `the attachment could not be kept at ${path}: ${errorMessage({ error: cause })}`,
    path,
  }),
} as const;

/**
 * Read the staged file whole, refusing a symlink, anything but a regular file, and a file over its kind's cap before
 * its bytes are read.
 *
 * @param path the staged file the route wrote
 * @returns every byte of it, or why it was not read
 */
function readStaged({ path }: { path: string }): Result<Uint8Array, AttachmentStoreError> {
  let descriptor: number | undefined;
  try {
    descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const stats = fstatSync(descriptor);
    if (!stats.isFile()) {
      return err(AttachmentStoreErrors.stagedUnreadable({ path, why: "is not a regular file" }));
    }
    const head = new Uint8Array(IMAGE_SNIFF_BYTES);
    const headRead = readSync(descriptor, head, 0, IMAGE_SNIFF_BYTES, 0);
    const cap = attachmentCapOf({ head: head.subarray(0, headRead) });
    if (stats.size > cap.maxBytes) {
      return err(AttachmentErrors.tooLarge({ bytes: stats.size, kind: cap.kind, maxBytes: cap.maxBytes }));
    }
    // The stat bounds the read, and the file can change between the two: a read of any other length than the stat
    // is refused rather than kept, so a file cut short while it was read is never kept as if it were whole.
    const bytes = new Uint8Array(readFileSync(descriptor));
    if (bytes.length !== stats.size) {
      const why = `changed size while it was read (${String(stats.size)} bytes, then ${String(bytes.length)})`;
      return err(AttachmentStoreErrors.stagedUnreadable({ path, why }));
    }
    return ok(bytes);
  } catch (cause) {
    return err(
      AttachmentStoreErrors.stagedUnreadable({ path, why: `could not be read: ${errorMessage({ error: cause })}` }),
    );
  } finally {
    if (descriptor !== undefined) {
      closeSync(descriptor);
    }
  }
}

/**
 * Judge the staged file and, when it passes, keep a copy of it under the home.
 *
 * @param home the Slopweaver home the copy is kept under
 * @param stagedPath the file the console route wrote
 * @param name the name the owner chose the file under
 * @param newId mints the directory id: `randomUUID` in the verb, a fixed one in a test
 * @returns the kept attachment, or the one reason nothing was kept
 */
export function keepAttachment({
  home,
  stagedPath,
  name,
  newId,
}: {
  home: string;
  stagedPath: string;
  name: string;
  newId: () => string;
}): Result<KeptAttachment, AttachmentStoreError> {
  // The name first, so a credential's name is refused before the staged file is even opened.
  const named = safeAttachmentName({ name });
  if (named.isErr()) {
    return err(named.error);
  }
  const read = readStaged({ path: stagedPath });
  if (read.isErr()) {
    return err(read.error);
  }
  const verdict = attachmentVerdict({ bytes: read.value, name });
  if (verdict.isErr()) {
    return err(verdict.error);
  }
  const attachment = verdict.value;
  const root = stateHomePaths({ home }).talkAttachments;
  const dir = join(root, newId());
  const path = join(dir, attachment.safeName);
  try {
    mkdirSync(root, { mode: 0o700, recursive: true });
    mkdirSync(dir, { mode: 0o700 });
  } catch (cause) {
    return err(AttachmentStoreErrors.writeFailed({ cause, path }));
  }
  try {
    writeFileSync(path, attachment.bytes, { flag: "wx", mode: 0o600 });
  } catch (cause) {
    rmSync(dir, { force: true, recursive: true });
    return err(AttachmentStoreErrors.writeFailed({ cause, path }));
  }
  const kept = { bytes: attachment.bytes.length, kind: attachment.kind, name: attachment.safeName, path };
  if (attachment.kind === "picture") {
    return ok({ ...kept, mediaType: attachment.mediaType });
  }
  return ok(kept);
}
