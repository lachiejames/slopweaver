/**
 * Whether a PNG carries anything beyond its pixels — and the one way this domain removes it.
 *
 * ## Why a picture's METADATA is part of what gets published
 *
 * A PNG can carry text chunks (`tEXt`, `zTXt`, `iTXt`), an EXIF block (`eXIf`), a timestamp (`tIME`) and an ICC
 * profile whose name is free text. macOS's own screenshot tool writes an `iTXt` XMP packet, and a browser or editor
 * can write a software name, a path or a user name. None of that is visible in the picture, so neither the session
 * looking at it nor the frame-text scan would see it, and all of it goes to GitHub with the bytes. So a capture verb
 * records the digest of bytes that carry NO such chunk, and `github attach` re-checks the chunks of the exact bytes it
 * is about to send.
 *
 * ## An allowlist of chunk types, never a denylist
 *
 * The PNG format lets any application define a private chunk. A denylist of the known text chunks would pass the
 * next one nobody listed; an allowlist of what pixels need — the header, a palette and its transparency, the image
 * data, the end marker — fails closed on everything else. `gAMA` is in it because it is a single number describing
 * how the pixels display, carrying no text.
 *
 * ## The strip is a decode and a re-encode, through Jimp
 *
 * Jimp's PNG encoder writes the pixels and the header and nothing else, so a round trip drops every ancillary chunk.
 * `./imageIo.ts` carries why it is Jimp and not `sharp`. The round trip's OUTPUT is checked by the same allowlist
 * rather than trusted, so an encoder that one day starts writing a chunk is a refusal, not a leak.
 */
import { Jimp } from "jimp";

import { err, ok, type Result } from "#lib/result.js";
import { type VisualEvidenceError, VisualEvidenceErrors } from "./evidenceErrors.js";

/** The eight bytes every PNG opens with. */
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;

/**
 * The chunk types a picture with no metadata may carry: what its pixels need, and nothing that holds text.
 * @internal — exported so a test names the allowlist rather than restating it.
 */
export const PIXEL_CHUNK_TYPES: ReadonlySet<string> = new Set(["IHDR", "PLTE", "tRNS", "IDAT", "IEND", "gAMA"]);

/**
 * Every chunk type a PNG's bytes carry, in order, or `null` when the bytes are not a well-formed PNG.
 *
 * Reads only lengths and types — never decompresses — so it is cheap on a 10 MiB image and cannot be made to
 * allocate by a hostile length: a length running past the end of the buffer is malformed.
 *
 * @param bytes the candidate PNG
 * @returns the chunk types, or `null` when the signature or a chunk boundary is wrong
 */
export function pngChunkTypes({ bytes }: { bytes: Uint8Array }): readonly string[] | null {
  if (bytes.byteLength < PNG_SIGNATURE.length || PNG_SIGNATURE.some((value, index) => bytes[index] !== value)) {
    return null;
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const types: string[] = [];
  let offset: number = PNG_SIGNATURE.length;
  while (offset < bytes.byteLength) {
    if (offset + 8 > bytes.byteLength) {
      return null;
    }
    const length = view.getUint32(offset);
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    const next = offset + 12 + length;
    if (next > bytes.byteLength) {
      return null;
    }
    types.push(type);
    offset = next;
    if (type === "IEND") {
      break;
    }
  }
  return types.at(-1) === "IEND" ? types : null;
}

/**
 * The chunks in a PNG that are not pixels — what stripping would remove — or `null` for bytes that are not a PNG.
 *
 * @param bytes the candidate PNG
 * @returns each non-pixel chunk type in order (empty when the picture is metadata-free), or `null`
 */
export function metadataChunksIn({ bytes }: { bytes: Uint8Array }): readonly string[] | null {
  const types = pngChunkTypes({ bytes });
  if (types === null) {
    return null;
  }
  return types.filter((type) => !PIXEL_CHUNK_TYPES.has(type));
}

/**
 * What stops bytes counting as a stripped PNG: each surviving metadata chunk, or one `(not a PNG)` entry when the
 * bytes are no PNG at all. Every writer that must hand over metadata-free pixels refuses on a non-empty answer.
 *
 * @param bytes the picture a writer is about to hand over
 * @returns the chunk types still present, `["(not a PNG)"]` for bytes that are not a PNG, or none when it is clean
 */
export function metadataLeftIn({ bytes }: { bytes: Uint8Array }): readonly string[] {
  const chunks = metadataChunksIn({ bytes });
  if (chunks === null) {
    return ["(not a PNG)"];
  }
  return chunks;
}

/**
 * Re-encode an image as a PNG carrying its pixels and nothing else.
 *
 * @param bytes any image Jimp decodes
 * @returns the metadata-free PNG, or why it could not be produced
 */
export async function stripImageMetadata({
  bytes,
}: {
  bytes: Uint8Array;
}): Promise<Result<Uint8Array, VisualEvidenceError>> {
  let encoded: Uint8Array;
  try {
    const image = await Jimp.fromBuffer(Buffer.from(bytes));
    encoded = new Uint8Array(await image.getBuffer("image/png"));
  } catch (error) {
    return err(VisualEvidenceErrors.imageUndecodable({ cause: error }));
  }
  const left = metadataLeftIn({ bytes: encoded });
  if (left.length > 0) {
    return err(VisualEvidenceErrors.metadataSurvived({ chunks: left }));
  }
  return ok(encoded);
}
