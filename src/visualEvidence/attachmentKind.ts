/**
 * What bytes this door will carry WITHOUT a visual-evidence claim — the allowlist half of image admission.
 *
 * ## The question this answers, and the one it does not
 *
 * Image admission asks "has somebody looked at this picture, and did they call it unfit"
 * (`./admission.ts`). A PDF, a spreadsheet or a markdown deliverable has no answer to that question,
 * because there is no picture to read back and no claim to check. Before this module existed every
 * attachment on every upload lane was decoded by `./imageIo.ts` and a PDF therefore landed on the `invalid`
 * arm — which the `unread-image` hatch does not waive — so `slopweaver slack post --media report.pdf` was
 * refused with `Mime type application/pdf does not support decoding` while `skills/slack/SKILL.md`
 * documented exactly that invocation. Measured on a 321,706-byte five-page pentest report.
 *
 * This module does NOT decide what is an image. `identifyImageBytes` still does, by decoding, and it runs
 * FIRST: `./prepareUploads.ts` only asks here about bytes Jimp has already refused. That order is the
 * safety property rather than an implementation detail — a buffer that decodes is an image whatever its
 * first five bytes say, so nothing can sniff its way past admission.
 *
 * ## An ALLOWLIST, never "undecodable therefore not an image"
 *
 * The pinned `jimp@1.6.1` resolves five codecs — `@jimp/js-{bmp,gif,jpeg,png,tiff}` — and Slack renders
 * several formats outside that set. Reproduce both halves:
 *
 * ```sh
 * node -e 'console.log(Object.keys(require("jimp/package.json").dependencies).filter(d=>d.includes("js-")))'
 * ```
 *
 * So "Jimp could not read it" is true of a WebP, an AVIF, a HEIC and an SVG, every one of which a reader
 * sees as a picture. A rule keyed on the decode FAILING would hand all four a route around the record
 * store. What is keyed on instead is a positive identification from the bytes, of a closed set of things
 * that are not pictures; anything this module does not recognise keeps the refusal it has today.
 *
 * Jimp's own message does distinguish the two cases — `Mime type application/pdf does not support
 * decoding` against `Could not find MIME for Buffer` — and that is deliberately not what this reads. It is
 * a library's prose, outside this repo's control, and `./imageIo.ts`'s header keeps every Jimp value inside
 * the function that made it. The table below is this door's decision, the same way
 * `../outbound/linear/attachment.ts`'s content-type table is that door's.
 *
 * The filename never ADMITS anything, for `./imageIo.ts`'s reason: a PNG renamed `.pdf` is still a picture.
 * It is read in exactly one place, as an extra condition the bytes must ALSO meet: see {@link isHtmlBriefing}.
 *
 * ## An HTML briefing is carried, and only one holding no `<svg` or `<script` tag
 *
 * A post to a programme channel should include an HTML file:
 * a briefing a colleague opens and reads. Slack shows an `.html` upload as a file, never as a picture, so
 * the SVG reason for refusing markup does not reach it. Three conditions, every one required, and anything
 * else markup-shaped keeps the refusal it had: the declared name ends `.html`, the first tag is
 * `<!doctype html` or `<html`, and no `<svg` or `<script` appears anywhere in the bytes, in any case.
 *
 * **What that tag check does NOT promise**, measured in review: the page can still run
 * script in a browser (an `onload` attribute, a `javascript:` link, an entity-escaped `<iframe srcdoc>`) and
 * still show an SVG (`<img>`, `<object>`). It is a literal-tag tripwire over a file Slack shows as a FILE,
 * never inline. A reader who downloads and opens the briefing opens it as any page, which is the same trust
 * as any HTML a colleague shares.
 *
 * ## A video is carried the way a PDF is, and claims exactly as little
 *
 * An MP4 or QuickTime file is identified by parsing its leading ISO-BMFF `ftyp` box, never by its first
 * bytes alone: HEIC and AVIF are ISO-BMFF too, and the brand list is the only thing that tells a still
 * picture from a moving one. A still-image brand anywhere in the box REFUSES, even beside a video brand, so a
 * file advertising both is kept on the refusal arm. A video then contributes no visual-evidence record, like
 * a PDF: what this door proves is "these bytes are a recognised video container", never "somebody watched
 * every frame" — `./types.ts` records still-image read-backs and has no temporal claim to make. WebM is not
 * carried yet: its EBML magic alone says too little about what the file holds.
 */

/** The kinds of non-image DOCUMENT this door carries. Each is identified from the bytes, never a name. */
type DocumentKind = "pdf" | "zip-container" | "ole2" | "gzip" | "rtf" | "text" | "html";

/** Every kind of non-picture attachment this door carries: a document, or an ISO-BMFF video container. */
export type AttachmentKind = DocumentKind | "iso-bmff-video";

/** Space, tab, newline, carriage return — what may precede a markup document's opening `<`. */
const BLANK_BYTES: ReadonlySet<number> = new Set([0x20, 0x09, 0x0a, 0x0d]);

/** The UTF-8 byte-order mark, which a text editor may write before anything else. */
const BOM: readonly number[] = [0xef, 0xbb, 0xbf];

/** `<`. */
const LESS_THAN = 0x3c;

/** Signature → kind, matched at offset 0 exactly. No image format Jimp decodes begins with any of these. */
const SIGNATURES: readonly { readonly kind: DocumentKind; readonly magic: readonly number[] }[] = [
  // `%PDF-`
  { kind: "pdf", magic: [0x25, 0x50, 0x44, 0x46, 0x2d] },
  // `PK\x03\x04` — docx, xlsx, pptx, odt and every other zip container
  { kind: "zip-container", magic: [0x50, 0x4b, 0x03, 0x04] },
  // The OLE2 compound file header — legacy .doc, .xls, .ppt
  { kind: "ole2", magic: [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1] },
  { kind: "gzip", magic: [0x1f, 0x8b] },
  // `{\rtf`
  { kind: "rtf", magic: [0x7b, 0x5c, 0x72, 0x74, 0x66] },
];

/**
 * Whether one byte may appear in a file this door is willing to call text.
 *
 * Tab, newline and carriage return are the only C0 control bytes a text file legitimately carries; a NUL or
 * a `0x1F` is how every binary format this table does not name announces itself.
 *
 * @param byte one byte of the candidate
 * @returns true when the byte is compatible with text
 */
function textByte({ byte }: { byte: number }): boolean {
  if (byte === 0x09 || byte === 0x0a || byte === 0x0d) {
    return true;
  }
  return byte > 0x1f && byte !== 0x7f;
}

/**
 * Whether a text-shaped file opens a MARKUP document.
 *
 * The SVG carve-out, and the reason the text arm is not simply "no control bytes": an SVG is text, and Slack
 * renders one as a picture. Deliberately blunt — it refuses XML and HTML too, which is the safe direction
 * for both. The one markup document carried past it is an HTML briefing meeting all of
 * {@link isHtmlBriefing}'s conditions; a SCREENSHOT of a page stays `../admit/inventedVisual.ts`'s subject.
 *
 * **Byte-level, and over the WHOLE file rather than a head window.** An earlier draft decoded the first
 * kibibyte to a string and trimmed it, which a kibibyte of leading whitespace walks straight past: the head
 * trims to `""`, `""` does not start with `<`, and the SVG behind it is carried. There is no string here at
 * all now, so `.claude/rules/typescript-patterns.md`'s whole-file-string rule has nothing to bound either.
 *
 * @param bytes the whole candidate
 * @returns true when the first byte that is neither a BOM nor blank is `<`
 */
function opensMarkup({ bytes }: { bytes: Uint8Array }): boolean {
  return bytes[firstContentByte({ bytes })] === LESS_THAN;
}

/** The offset of the first byte that is neither a BOM nor blank — where a markup document's first tag sits. */
function firstContentByte({ bytes }: { bytes: Uint8Array }): number {
  let at = BOM.every((byte, index) => bytes[index] === byte) ? BOM.length : 0;
  while (at < bytes.length && BLANK_BYTES.has(bytes[at]!)) {
    at += 1;
  }
  return at;
}

/** An ASCII byte lowercased, so `<SVG` and `<Script` match as `<svg` and `<script` do. */
function lowerAscii({ byte }: { byte: number }): number {
  return byte >= 0x41 && byte <= 0x5a ? byte + 0x20 : byte;
}

/** Whether lowercase ASCII `needle` sits at `at`, compared without case. */
function matchesAt({ bytes, at, needle }: { bytes: Uint8Array; at: number; needle: string }): boolean {
  if (at + needle.length > bytes.length) {
    return false;
  }
  for (let index = 0; index < needle.length; index += 1) {
    if (lowerAscii({ byte: bytes[at + index]! }) !== needle.charCodeAt(index)) {
      return false;
    }
  }
  return true;
}

/** Whether lowercase ASCII `needle` appears anywhere in the bytes, compared without case. */
function containsCaseless({ bytes, needle }: { bytes: Uint8Array; needle: string }): boolean {
  for (let at = 0; at < bytes.length; at += 1) {
    if (bytes[at] === LESS_THAN && matchesAt({ at, bytes, needle })) {
      return true;
    }
  }
  return false;
}

/** The tags an HTML briefing may open with. Each must be followed by a blank or `>` to count. */
const HTML_OPENERS: readonly string[] = ["<!doctype html", "<html"];

/** The literal tags that keep an HTML file refused: an inline SVG and a script element. */
const HTML_REFUSED_TAGS: readonly string[] = ["<svg", "<script"];

/** `>`. */
const GREATER_THAN = 0x3e;

/**
 * Whether markup-shaped text is an HTML briefing this door carries: named `.html`, opening on an HTML tag,
 * and holding no `<svg` or `<script` tag. The name is a condition the bytes must ALSO meet, never
 * a route on its own — see the module header.
 *
 * @param bytes the whole candidate, already known to be text that opens with `<`
 * @param filename the name the upload declares
 * @returns true only when all three conditions hold
 */
function isHtmlBriefing({ bytes, filename }: { bytes: Uint8Array; filename: string }): boolean {
  if (!filename.toLowerCase().endsWith(".html")) {
    return false;
  }
  const start = firstContentByte({ bytes });
  const opens = HTML_OPENERS.some((opener) => {
    const after = bytes[start + opener.length];
    const closed = after === GREATER_THAN || (after !== undefined && BLANK_BYTES.has(after));
    return closed && matchesAt({ at: start, bytes, needle: opener });
  });
  return opens && !HTML_REFUSED_TAGS.some((needle) => containsCaseless({ bytes, needle }));
}

/**
 * The ISO-BMFF brands that mark a STILL picture — HEIF, HEIC and AVIF. Any one present, as the major brand
 * or among the compatible ones, refuses the file, whatever video brand sits beside it: an AVIF may list
 * `isom` too, and "it also says it is an MP4" is exactly the sniff this door exists to refuse.
 */
const STILL_IMAGE_BRANDS: ReadonlySet<string> = new Set([
  "heic",
  "heix",
  "hevc",
  "heim",
  "heis",
  "mif1",
  "msf1",
  "avif",
  "avis",
]);

/** The ISO-BMFF brands that mark a moving-picture container — MP4, QuickTime, M4V and fragmented DASH. */
const VIDEO_BRANDS: ReadonlySet<string> = new Set([
  "isom",
  "mp41",
  "mp42",
  "avc1",
  "qt  ",
  "M4V ",
  "iso2",
  "iso3",
  "iso4",
  "iso5",
  "iso6",
  "dash",
]);

/** A box's 4-byte size field, its 4-byte type, then the ftyp's major brand and minor version. */
const FTYP_HEADER_BYTES = 16;

/** One FourCC, compatible brand or type field. */
const FOURCC_BYTES = 4;

/** Read one FourCC at an offset as its exact, case-sensitive four characters. */
function fourCc({ bytes, at }: { bytes: Uint8Array; at: number }): string {
  return String.fromCodePoint(...bytes.subarray(at, at + FOURCC_BYTES));
}

/**
 * Every brand the leading `ftyp` box declares — the major brand first, then each compatible one — or
 * `undefined` when the file does not open with a well-formed one.
 *
 * Well-formed is checked before a single brand is read: the box must be the FIRST box, typed `ftyp`, sized
 * at least its sixteen-byte header, no larger than the bytes actually present, and its compatible-brand run
 * a whole number of FourCCs. A size of zero ("to end of file") or one (a 64-bit size follows) is refused
 * outright — neither is how an `ftyp` is written, and accepting one would read brands out of media data.
 *
 * @param bytes the whole candidate
 * @returns the declared brands in box order, or `undefined` for anything else
 */
function ftypBrands({ bytes }: { bytes: Uint8Array }): readonly string[] | undefined {
  if (bytes.byteLength < FTYP_HEADER_BYTES || fourCc({ at: FOURCC_BYTES, bytes }) !== "ftyp") {
    return undefined;
  }
  const size = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0);
  if (size < FTYP_HEADER_BYTES || size > bytes.byteLength || (size - FTYP_HEADER_BYTES) % FOURCC_BYTES !== 0) {
    return undefined;
  }
  const brands = [fourCc({ at: 8, bytes })];
  for (let at = FTYP_HEADER_BYTES; at < size; at += FOURCC_BYTES) {
    brands.push(fourCc({ at, bytes }));
  }
  return brands;
}

/**
 * Whether bytes are a video container this door carries: a well-formed leading `ftyp` naming at least one
 * video brand and no still-image brand. The deny list wins — see {@link STILL_IMAGE_BRANDS}.
 *
 * @param bytes the whole candidate
 * @returns true only for a positively identified ISO-BMFF video
 */
function isIsoBmffVideo({ bytes }: { bytes: Uint8Array }): boolean {
  const brands = ftypBrands({ bytes });
  if (brands === undefined || brands.some((brand) => STILL_IMAGE_BRANDS.has(brand))) {
    return false;
  }
  return brands.some((brand) => VIDEO_BRANDS.has(brand));
}

/**
 * Identify bytes as an attachment this door carries without asking the visual-evidence store about them.
 *
 * @param bytes the attachment, exactly as it will be uploaded
 * @param filename the name the upload declares, read only to carry an HTML briefing
 * @returns the kind, or `undefined` when this door cannot say what these bytes are — which keeps the
 *   refusal, because an unidentified undecodable attachment may well be a picture in a format Jimp lacks
 */
export function attachmentKindOf({
  bytes,
  filename,
}: {
  bytes: Uint8Array;
  filename: string;
}): AttachmentKind | undefined {
  if (bytes.byteLength === 0) {
    return undefined;
  }
  const signature = SIGNATURES.find(({ magic }) => magic.every((byte, index) => bytes[index] === byte));
  if (signature !== undefined) {
    return signature.kind;
  }
  if (isIsoBmffVideo({ bytes })) {
    return "iso-bmff-video";
  }
  if (!bytes.every((byte) => textByte({ byte }))) {
    return undefined;
  }
  if (!opensMarkup({ bytes })) {
    return "text";
  }
  return isHtmlBriefing({ bytes, filename }) ? "html" : undefined;
}
