/**
 * Byte-exact GIF fixtures for the animated-GIF door, built from the format's own block grammar so a test
 * states exactly how many frames it is handing over.
 */

/** `GIF89a`, a 1×1 logical screen, and a two-entry global colour table. */
const HEADER = [
  ...Buffer.from("GIF89a", "latin1"),
  0x01,
  0x00,
  0x01,
  0x00,
  0x80,
  0x00,
  0x00,
  0x00,
  0x00,
  0x00,
  0xff,
  0xff,
  0xff,
];

/** The `NETSCAPE2.0` application extension asking for an infinite loop. */
const LOOP_EXTENSION = [0x21, 0xff, 0x0b, ...Buffer.from("NETSCAPE2.0", "latin1"), 0x03, 0x01, 0x00, 0x00, 0x00];

/** One frame: a graphic control extension (100ms delay), a 1×1 image descriptor and its LZW data. */
const FRAME = [
  0x21, 0xf9, 0x04, 0x00, 0x0a, 0x00, 0x00, 0x00, 0x2c, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0x02,
  0x02, 0x44, 0x01, 0x00,
];

const TRAILER = [0x3b];

/**
 * A GIF carrying exactly `frames` frames, looping forever when `loop` is set.
 *
 * @param frames how many image descriptors to write
 * @param loop whether to write the `NETSCAPE2.0` loop extension before the first frame
 * @returns the whole file
 */
export function gifWithFrames({ frames, loop = false }: { frames: number; loop?: boolean }): Buffer {
  return Buffer.from([
    ...HEADER,
    ...(loop ? LOOP_EXTENSION : []),
    ...Array.from({ length: frames }, () => FRAME).flat(),
    ...TRAILER,
  ]);
}
