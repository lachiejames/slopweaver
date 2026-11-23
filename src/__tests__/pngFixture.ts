/**
 * Synthetic PNG bytes for the tests that grade a screenshot.
 *
 * `isUnrenderedScreenshot` reads a capture's IHDR dimensions and asks how many bytes the compressor spent
 * per pixel, so a three-byte stand-in is no longer a usable fixture for a page that rendered — it is
 * correctly graded as nothing at all. These build a buffer with a REAL header and a chosen length, which is
 * exactly the pair of facts that function reads and nothing more: no encoder, no image, no I/O.
 */

/** The offsets IHDR puts width and height at, and the shortest buffer that carries both. */
const PNG_WIDTH_OFFSET = 16;
const PNG_HEIGHT_OFFSET = 20;
const PNG_HEADER_BYTES = 24;

/**
 * A PNG-shaped buffer of a chosen size and pixel count.
 *
 * @param byteLength how long the file is, in bytes
 * @param width the IHDR width
 * @param height the IHDR height
 * @returns the bytes, with a readable header and the rest left zeroed
 */
export function pngOfSize({
  byteLength,
  width,
  height,
}: {
  byteLength: number;
  width: number;
  height: number;
}): Uint8Array {
  const bytes = new Uint8Array(Math.max(byteLength, PNG_HEADER_BYTES));
  const view = new DataView(bytes.buffer);
  view.setUint32(PNG_WIDTH_OFFSET, width);
  view.setUint32(PNG_HEIGHT_OFFSET, height);
  return bytes;
}

/**
 * A capture of a page that rendered — the density a real console page comes back at.
 *
 * 0.024 bytes per pixel is this install's measured MEDIAN, so a fixture built here sits where a genuine
 * page sits rather than just over the threshold.
 *
 * @param seed a byte written into the payload, so two fixtures can differ without differing in density
 * @returns the bytes
 */
export function renderedPng({ seed = 1 }: { seed?: number } = {}): Uint8Array {
  const bytes = pngOfSize({ byteLength: 95_000, height: 1308, width: 3024 });
  bytes[PNG_HEADER_BYTES] = seed;
  return bytes;
}

/**
 * A capture of a page that never finished loading — the spinner frame, at its measured density.
 *
 * @returns the bytes
 */
export function unrenderedPng(): Uint8Array {
  return pngOfSize({ byteLength: 16_693, height: 1308, width: 3024 });
}
