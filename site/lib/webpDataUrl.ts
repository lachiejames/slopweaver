/**
 * The one check a picture posted to the console passes before a byte of it is written: the voice's screen
 * frame (`/api/talk/relay`) arrives as a WebP data URL, and is refused on these terms before it reaches the verb.
 *
 * Checked three ways, in order of cost: the exact WebP data-URL prefix and a length bound on the string,
 * strict base64, then the decoded bytes' size and WebP container structure. The verb checks the file again
 * (`src/talk/relayPicture.ts`), because it is callable without either route.
 */
import { RELAY_FRAME_DATA_URL_MAX, RELAY_PICTURE_MAX_BYTES, RELAY_PICTURE_PREFIX } from "./screenFrame";

/** Canonical base64: groups of four, padding only at the end. */
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u;

/** What a data URL decoded to: its WebP bytes, or the sentence and status of a refusal. */
export type WebpDataUrlDecode =
  | { readonly kind: "webp"; readonly bytes: Uint8Array }
  | { readonly kind: "refused"; readonly why: string; readonly status: 400 | 413 };

/**
 * Decode one posted picture, refusing anything that is not a bounded, structurally whole WebP.
 *
 * @param dataUrl the posted string
 * @param field the body field it came from, named in every refusal about the string itself
 * @returns the decoded bytes, or why the picture is refused
 */
export function decodeWebpDataUrl({ dataUrl, field }: { dataUrl: string; field: string }): WebpDataUrlDecode {
  if (!dataUrl.startsWith(RELAY_PICTURE_PREFIX)) {
    return { kind: "refused", status: 400, why: `${field} must start ${RELAY_PICTURE_PREFIX}` };
  }
  if (dataUrl.length > RELAY_FRAME_DATA_URL_MAX) {
    return {
      kind: "refused",
      status: 413,
      why: `${field} is ${String(dataUrl.length)} characters; a relay picture is up to ${String(RELAY_FRAME_DATA_URL_MAX)}`,
    };
  }
  const encoded = dataUrl.slice(RELAY_PICTURE_PREFIX.length);
  if (!BASE64.test(encoded)) {
    return { kind: "refused", status: 400, why: `${field} is not canonical base64` };
  }
  const bytes = Uint8Array.from(atob(encoded), (char) => char.charCodeAt(0));
  if (bytes.length > RELAY_PICTURE_MAX_BYTES) {
    return {
      kind: "refused",
      status: 413,
      why: `the picture is ${String(bytes.length)} bytes; a relay carries up to ${String(RELAY_PICTURE_MAX_BYTES)}`,
    };
  }
  if (!isWebpBytes({ bytes })) {
    return {
      kind: "refused",
      status: 400,
      why: "the picture is not a WebP image (no RIFF/WEBP container around an image chunk)",
    };
  }
  return { bytes, kind: "webp" };
}

/** The first chunk a WebP may open with: lossy, lossless, or the extended header. */
const WEBP_FIRST_CHUNKS: ReadonlySet<string> = new Set(["VP8 ", "VP8L", "VP8X"]);

/** The chunks that carry the image itself; `VP8X` is only a header in front of one. */
const WEBP_IMAGE_CHUNKS: ReadonlySet<string> = new Set(["VP8 ", "VP8L"]);

/**
 * Whether bytes are a WebP by its container's structure, the same check `src/talk/relayPicture.ts`'s `isWebp`
 * makes, without decoding: `RIFF` at 0 sized to the file less eight, `WEBP` at 8, a first chunk that may open
 * a WebP, every chunk (padded to even) tiling the file exactly, and at least one `VP8 ` or `VP8L` image chunk.
 *
 * @param bytes the decoded picture
 * @returns `true` for a structurally whole WebP container carrying an image chunk, never for a shell
 */
export function isWebpBytes({ bytes }: { bytes: Uint8Array }): boolean {
  const ascii = ({ from }: { from: number }): string => String.fromCharCode(...bytes.subarray(from, from + 4));
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const opens =
    bytes.length >= 20 &&
    ascii({ from: 0 }) === "RIFF" &&
    view.getUint32(4, true) === bytes.length - 8 &&
    ascii({ from: 8 }) === "WEBP" &&
    WEBP_FIRST_CHUNKS.has(ascii({ from: 12 }));
  if (!opens) {
    return false;
  }
  let at = 12;
  let image = false;
  while (at + 8 <= bytes.length) {
    const size = view.getUint32(at + 4, true);
    image = image || WEBP_IMAGE_CHUNKS.has(ascii({ from: at }));
    at += 8 + size + (size % 2);
  }
  return image && at === bytes.length;
}
