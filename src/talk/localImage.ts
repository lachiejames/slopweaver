/**
 * The picture half of `slopweaver talk file read`: a file whose own first bytes name a PNG, JPEG or WebP
 * (`./imageSniff.ts`) is read whole rather than as a masked text window. `./localFile.ts` runs every path refusal
 * and the inode check first and hands over the open descriptor; nothing here resolves or opens a path.
 */
import { readSync } from "node:fs";

import { err, ok, type Result } from "../lib/result.js";

import { IMAGE_SNIFF_BYTES, type ImageMediaType, sniffImage } from "./imageSniff.js";
import { type LocalFileError, LocalFileErrors } from "./localFileErrors.js";

/**
 * The largest picture one read carries whole. A Retina screenshot PNG runs to a few MiB; the page fits whatever
 * comes to the size the provider looks at before it is sent, so this only bounds the local hop, whose base64 is
 * a third larger and stays under `src/lib/safeJson.ts`'s 32 MiB warning.
 */
export const IMAGE_MAX_BYTES = 16 * 1024 * 1024;

/**
 * One local picture, whole. Nothing in pixels can be masked, so the bytes go only to the console page, which
 * draws them onto a canvas and re-encodes what it sends: every metadata chunk (EXIF, a PNG text chunk) stays on
 * this machine, and the pixels cross exactly as a `read_screen` frame does.
 */
export interface LocalImageRead {
  readonly kind: "image";
  /** The path as asked, expanded. */
  readonly path: string;
  /** Where it resolved to. */
  readonly resolvedPath: string;
  /** The file's whole size in bytes. */
  readonly size: number;
  /** The format its own first bytes name. */
  readonly mediaType: ImageMediaType;
  /** The whole file, base64. */
  readonly base64: string;
}

/**
 * The picture format an open file's first bytes name, read from offset 0 without moving the descriptor. The
 * bytes come back too, so neither read that follows reads them a second time: a file whose reads answer
 * differently each time is read once per byte, whichever way it goes.
 *
 * @param fd an open, already-checked descriptor
 * @param size the file's whole size, so an empty or tiny file reads only what it has
 * @returns the bytes read from offset 0, and the format, `undefined` for anything not a PNG, JPEG or WebP
 */
export function sniffOpened({ fd, size }: { fd: number; size: number }): {
  head: Buffer;
  mediaType: ImageMediaType | undefined;
} {
  const buffer = Buffer.alloc(Math.min(IMAGE_SNIFF_BYTES, size));
  const head = buffer.subarray(0, readSync(fd, buffer, 0, buffer.length, 0));
  return { head, mediaType: sniffImage({ head }) };
}

/**
 * Fill `into`, which holds the file from `at`, with what `head` already read and the rest from `fd`.
 *
 * @param into the buffer to fill, sized to the span wanted
 * @param at the file offset `into` starts at
 * @param head the bytes {@link sniffOpened} read from offset 0
 * @returns how many bytes of `into` hold file content
 */
export function readAfterHead({ fd, into, at, head }: { fd: number; into: Buffer; at: number; head: Buffer }): number {
  const known = head.subarray(Math.min(at, head.length), Math.min(at + into.length, head.length));
  let filled = known.copy(into, 0);
  while (filled < into.length) {
    const got = readSync(fd, into, filled, into.length - filled, at + filled);
    if (got === 0) {
      break;
    }
    filled += got;
  }
  return filled;
}

/**
 * Read a sniffed picture whole out of an open descriptor, refusing a window into it or one past the cap.
 *
 * @param fd an open descriptor `./localFile.ts` already checked is the file it resolved
 * @param from the offset asked for, which must be 0: a picture has no windows
 * @param mediaType the format {@link sniffOpened} named
 * @param head the bytes {@link sniffOpened} already read, never read again
 * @param path the path as asked, expanded
 * @param real where it resolved to
 * @param size the file's whole size in bytes
 * @returns the picture, or why it was refused
 */
export function readLocalImage({
  fd,
  from,
  mediaType,
  head,
  path,
  real,
  size,
}: {
  fd: number;
  from: number;
  mediaType: ImageMediaType;
  head: Buffer;
  path: string;
  real: string;
  size: number;
}): Result<LocalImageRead, LocalFileError> {
  return pictureOf({
    from,
    mediaType,
    path,
    read: () => {
      const bytes = Buffer.alloc(size);
      return bytes.subarray(0, readAfterHead({ at: 0, fd, head, into: bytes }));
    },
    real,
    size,
  });
}

/**
 * Read a sniffed picture whole out of bytes already held in memory — a published page's document the store returned —
 * refused exactly as the same bytes read off disk would be.
 *
 * @param bytes the whole document
 * @param from the offset asked for, which must be 0: a picture has no windows
 * @param mediaType the format its first bytes name
 * @param path the address the bytes answer to, named in the read and in every refusal
 * @returns the picture, or why it was refused
 */
export function readHeldImage({
  bytes,
  from,
  mediaType,
  path,
}: {
  bytes: Uint8Array;
  from: number;
  mediaType: ImageMediaType;
  path: string;
}): Result<LocalImageRead, LocalFileError> {
  const whole = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return pictureOf({ from, mediaType, path, read: () => whole, real: path, size: whole.length });
}

/** One picture whole, wherever its bytes come from, refused for a window into it or a size past the cap. */
function pictureOf({
  from,
  mediaType,
  path,
  read,
  real,
  size,
}: {
  from: number;
  mediaType: ImageMediaType;
  path: string;
  read: () => Buffer;
  real: string;
  size: number;
}): Result<LocalImageRead, LocalFileError> {
  if (from !== 0) {
    return err(LocalFileErrors.imageWindowed({ from, path }));
  }
  if (size > IMAGE_MAX_BYTES) {
    return err(LocalFileErrors.imageTooLarge({ max: IMAGE_MAX_BYTES, path, size }));
  }
  const bytes = read();
  return ok({
    base64: bytes.toString("base64"),
    kind: "image",
    mediaType,
    path,
    resolvedPath: real,
    size: bytes.length,
  });
}
