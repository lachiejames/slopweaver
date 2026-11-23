/**
 * Which picture a file is, by its own first bytes — never by its name. The console voice's `file_read` hands a
 * PNG, JPEG or WebP to the model as an image instead of refusing it as binary: the owner expects the voice to read a
 * PNG file, since looking at their screen is basically the same act. The three are the formats the console's canvas decodes and
 * the provider takes; anything else holding a NUL byte stays binary and refused.
 */

/** A picture format `file_read` returns as an image. */
export type ImageMediaType = "image/jpeg" | "image/png" | "image/webp";

/** The most head bytes {@link sniffImage} reads: WebP's `RIFF<size>WEBP` is twelve. */
export const IMAGE_SNIFF_BYTES = 12;

/** PNG's eight-byte signature. */
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** JPEG's start-of-image marker and the first byte of the next marker. */
const JPEG_SIGNATURE = [0xff, 0xd8, 0xff];

/** `RIFF`, which a WebP opens with before its four size bytes. */
const RIFF = [0x52, 0x49, 0x46, 0x46];

/** `WEBP`, at offset 8. */
const WEBP = [0x57, 0x45, 0x42, 0x50];

/**
 * The picture format a file's head names, or `undefined` when it is not one of the three.
 *
 * @param head the file's first bytes, at least {@link IMAGE_SNIFF_BYTES} of them when the file has that many
 * @returns the media type, or `undefined`
 */
export function sniffImage({ head }: { head: Uint8Array }): ImageMediaType | undefined {
  if (startsWith({ at: 0, bytes: head, expected: PNG_SIGNATURE })) {
    return "image/png";
  }
  if (startsWith({ at: 0, bytes: head, expected: JPEG_SIGNATURE })) {
    return "image/jpeg";
  }
  if (startsWith({ at: 0, bytes: head, expected: RIFF }) && startsWith({ at: 8, bytes: head, expected: WEBP })) {
    return "image/webp";
  }
  return undefined;
}

/** Whether `bytes` carries `expected` starting at `at`. */
function startsWith({ bytes, expected, at }: { bytes: Uint8Array; expected: readonly number[]; at: number }): boolean {
  return bytes.length >= at + expected.length && expected.every((byte, index) => bytes[at + index] === byte);
}
