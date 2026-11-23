/**
 * How many frames a GIF carries, read off its own block grammar — so the attachment door can tell a still
 * image from a recording before either reaches a pull request.
 *
 * A VHS cassette in a Proof cell reads better as a video with controls than as a GIF. A GIF in a pull-request body
 * autoplays with no scrubber, no duration and no pause, so a reader who missed the first second waits out the
 * whole loop. An uploaded `.mp4` renders as a player with all three.
 *
 * Frames are counted as IMAGE DESCRIPTORS rather than by looking for the `NETSCAPE2.0` loop extension: a
 * two-frame GIF with no loop block still plays through once with no controls, which is the same defect.
 */

/** The block introducers the GIF grammar defines after the header. */
const EXTENSION_INTRODUCER = 0x21;
const IMAGE_SEPARATOR = 0x2c;
const TRAILER = 0x3b;

/** Bytes before the first block: the 6-byte signature and the 7-byte logical screen descriptor. */
const HEADER_BYTES = 13;
/** An image descriptor's own length, separator included. */
const IMAGE_DESCRIPTOR_BYTES = 10;
/** Bit 7 of a packed field: a colour table follows. */
const COLOUR_TABLE_FLAG = 0x80;
/** Bits 0-2 of a packed field: that colour table holds `2^(n+1)` RGB entries. */
const COLOUR_TABLE_SIZE_BITS = 0x07;

/** Whether the bytes open with a GIF signature at all. */
function isGifSignature({ bytes }: { bytes: Uint8Array }): boolean {
  const signature = String.fromCodePoint(...bytes.subarray(0, 6));
  return signature === "GIF87a" || signature === "GIF89a";
}

/** The byte length of the colour table a packed field announces, `0` when it announces none. */
function colourTableBytes({ packed }: { packed: number }): number {
  return (packed & COLOUR_TABLE_FLAG) === 0 ? 0 : 3 * 2 ** ((packed & COLOUR_TABLE_SIZE_BITS) + 1);
}

/**
 * The offset just past a run of data sub-blocks (each a length byte then that many bytes, ending at a zero
 * length), or `undefined` when the run overruns the buffer.
 */
function skipSubBlocks({ bytes, offset }: { bytes: Uint8Array; offset: number }): number | undefined {
  let cursor = offset;
  while (cursor < bytes.length) {
    const size = bytes[cursor]!;
    cursor += 1;
    if (size === 0) {
      return cursor;
    }
    cursor += size;
  }
  return undefined;
}

/**
 * The offset just past one image: its descriptor, its local colour table, the LZW minimum code size byte
 * and its data sub-blocks — or `undefined` when any of them overruns the buffer.
 */
function skipImage({ bytes, offset }: { bytes: Uint8Array; offset: number }): number | undefined {
  const packed = bytes[offset + IMAGE_DESCRIPTOR_BYTES - 1];
  if (packed === undefined) {
    return undefined;
  }
  const dataStart = offset + IMAGE_DESCRIPTOR_BYTES + colourTableBytes({ packed }) + 1;
  return dataStart > bytes.length ? undefined : skipSubBlocks({ bytes, offset: dataStart });
}

/**
 * Count the frames in a GIF by walking its blocks.
 *
 * A file that is not a GIF, or whose blocks overrun or carry an introducer the grammar does not define,
 * answers `undefined` rather than a guess: the door reading this is a tripwire, and a tripwire that refused
 * an upload on bytes it could not parse would be a fence.
 *
 * @param bytes the whole file
 * @returns the number of image descriptors, or `undefined` when the bytes are not a parseable GIF
 */
export function gifFrameCount({ bytes }: { bytes: Uint8Array }): number | undefined {
  if (bytes.length < HEADER_BYTES || !isGifSignature({ bytes })) {
    return undefined;
  }
  let cursor: number | undefined = HEADER_BYTES + colourTableBytes({ packed: bytes[10]! });
  let frames = 0;
  while (cursor !== undefined && cursor < bytes.length) {
    const introducer = bytes[cursor]!;
    if (introducer === TRAILER) {
      return frames;
    }
    if (introducer === EXTENSION_INTRODUCER) {
      cursor = skipSubBlocks({ bytes, offset: cursor + 2 });
    } else if (introducer === IMAGE_SEPARATOR) {
      frames += 1;
      cursor = skipImage({ bytes, offset: cursor });
    } else {
      return undefined;
    }
  }
  // A GIF cut off before its trailer still played every frame it delivered, so a count reached cleanly is
  // the answer; an overrun mid-block is not.
  return cursor === undefined ? undefined : frames;
}
