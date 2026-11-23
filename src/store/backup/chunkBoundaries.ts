/**
 * Where a large file is cut into chunks — content-defined, so an edit moves only the cuts next to it. PURE.
 *
 * ## Why content-defined, and not fixed-size
 *
 * A bronze `compact.jsonl` is rewritten whole most nights and the dump is re-taken whole every night, so a
 * blob named for the digest of the WHOLE file is new every night and re-uploads every byte. Cut at fixed
 * offsets instead, and one record inserted near the front shifts every later offset, so every later chunk is
 * new again. MEASURED by the plan pass over this install's real consecutive dumps: fixed 4 MiB
 * chunks shared almost nothing (1,811,364,447 novel bytes of 1,966,639,776), while cuts chosen by content
 * shared 98.57% (28,127,746 novel bytes) — the difference between ~46 minutes and ~43 seconds of upload at the
 * measured 645 KiB/s.
 *
 * The cut is FastCDC's: a gear hash rolls over the bytes, and a chunk ends where the hash's top bits are all
 * zero. Normalised chunking uses a HARDER mask before {@link CHUNK_AVERAGE_BYTES} and an EASIER one after it,
 * which pulls chunk sizes toward the average; {@link CHUNK_MIN_BYTES} and {@link CHUNK_MAX_BYTES} bound them.
 *
 * ## These constants ARE the format
 *
 * The gear table, the masks and the three sizes decide every cut, and a chunk is named by the digest of its
 * bytes — so changing any of them re-cuts every file and the destination's chunks stop matching. That is why the
 * table is derived from a fixed label rather than a random seed, and why a change here is a new
 * {@link CHUNKING}, never an edit.
 */
import { createHash } from "node:crypto";

/** The version of the cut rule, recorded beside every chunk list so a reader knows which rule produced it. */
export const CHUNKING = "fastcdc-1m-4m-8m-v1";

/** No chunk is shorter than this, except the last one of a file. */
export const CHUNK_MIN_BYTES = 1024 * 1024;

/** Where the mask eases, which is what pulls the chunk sizes toward this length. */
const CHUNK_AVERAGE_BYTES = 4 * 1024 * 1024;

/** No chunk is longer than this — also what bounds every buffer a chunk is read, encoded or decoded into. */
export const CHUNK_MAX_BYTES = 8 * 1024 * 1024;

/** 24 top bits: a cut before the average needs a rarer hash, so chunks rarely end early. */
const MASK_BEFORE_AVERAGE = 0xff_ff_ff_00;

/** 20 top bits: a cut after the average is four times likelier, so chunks rarely run to the maximum. */
const MASK_AFTER_AVERAGE = 0xff_ff_f0_00;

/**
 * The gear table: one fixed 32-bit value per byte value, read off the SHA-256 of a label naming the index.
 *
 * @returns the 256 entries
 */
function gearTable(): Uint32Array {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    table[index] = createHash("sha256")
      .update(`slopweaver-gear-v1:${String(index)}`)
      .digest()
      .readUInt32BE(0);
  }
  return table;
}

const GEAR = gearTable();

/**
 * Roll the gear hash from `from` to `to` in the window, and answer the first offset whose hash clears the mask.
 *
 * @param window the bytes from the chunk's start
 * @param from where to resume rolling
 * @param to where to stop, exclusive
 * @param mask the bits that must all be zero
 * @param hash the rolling hash carried in
 * @returns the cut length when the mask cleared, else `null` and the hash carried out
 */
function rollTo({
  window,
  from,
  to,
  mask,
  hash,
}: {
  window: Uint8Array;
  from: number;
  to: number;
  mask: number;
  hash: number;
}): { readonly cut: number | null; readonly hash: number } {
  let rolled = hash;
  for (let offset = from; offset < to; offset += 1) {
    rolled = ((rolled << 1) + GEAR[window[offset]!]!) >>> 0;
    if ((rolled & mask) === 0) {
      return { cut: offset + 1, hash: rolled };
    }
  }
  return { cut: null, hash: rolled };
}

/**
 * How long the chunk starting at the front of `window` is.
 *
 * The caller hands over every byte the chunk could need — {@link CHUNK_MAX_BYTES}, or whatever is left of the
 * file when less is — so a window shorter than the maximum is the file's tail and may end short.
 *
 * @param window the bytes from the chunk's start, at most {@link CHUNK_MAX_BYTES} of them
 * @returns the chunk's length, between one byte and the window's length
 */
export function chunkLength({ window }: { window: Uint8Array }): number {
  const available = Math.min(window.length, CHUNK_MAX_BYTES);
  if (available <= CHUNK_MIN_BYTES) {
    return available;
  }
  const early = rollTo({
    from: CHUNK_MIN_BYTES,
    hash: 0,
    mask: MASK_BEFORE_AVERAGE,
    to: Math.min(available, CHUNK_AVERAGE_BYTES),
    window,
  });
  if (early.cut !== null) {
    return early.cut;
  }
  const late = rollTo({
    from: Math.min(available, CHUNK_AVERAGE_BYTES),
    hash: early.hash,
    mask: MASK_AFTER_AVERAGE,
    to: available,
    window,
  });
  if (late.cut !== null) {
    return late.cut;
  }
  return available;
}

/**
 * Every cut of one in-memory buffer, as chunk lengths in order — the whole-buffer form of {@link chunkLength}.
 *
 * @param data the bytes to cut
 * @returns the chunk lengths, summing to the buffer's length; empty for an empty buffer
 */
export function chunkLengths({ data }: { data: Uint8Array }): readonly number[] {
  const lengths: number[] = [];
  let start = 0;
  while (start < data.length) {
    const length = chunkLength({ window: data.subarray(start, start + CHUNK_MAX_BYTES) });
    lengths.push(length);
    start += length;
  }
  return lengths;
}
