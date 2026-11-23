/**
 * The Slopweaver logo, read from the ONE committed asset both icons are made from (`assets/logo.png`): the app
 * icon packs it at every size macOS asks for (`appIcon.ts`) and the menu bar draws its shape as a template
 * (`trayIcon.ts`). Swapping either icon is replacing that file, since the owner may change
 * the icon later. The decoder takes the PNG the asset is — 8-bit RGB or RGBA, not interlaced — and names
 * anything else rather than drawing it wrong. Pure.
 */
import { inflateSync } from "node:zlib";

import { err, ok, type Result } from "neverthrow";

import { type LogoError, LogoErrors } from "./errors";
import { pngCrc, unfilter } from "./logoPng";

/** Where the asset sits, relative to the app's own root (the `desktop/` directory, or the packaged app's). */
export const LOGO_ASSET = "assets/logo.png";

/** The smallest side the asset may be: the app icon's largest entry is drawn from it without upscaling. */
export const LOGO_MIN_SIDE = 1024;

/** A square of 32-bit RGBA pixels, straight alpha, row by row from the top. */
export interface Bitmap {
  readonly side: number;
  readonly pixels: Uint8Array;
}

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** Channels per pixel, by PNG colour type: 2 is RGB, 6 is RGBA. */
const CHANNELS: Readonly<Record<number, number>> = { 2: 3, 6: 4 };

/**
 * Decode a PNG into RGBA pixels. Reads the 8-bit, non-interlaced RGB and RGBA files an icon asset is; any other
 * kind is an error that names it, and a file that is not square is too, because an icon is.
 *
 * @param bytes the file's contents
 * @returns the square bitmap, or why it could not be read as one
 */
export function decodePng({ bytes }: { bytes: Uint8Array }): Result<Bitmap, LogoError> {
  if (bytes.length < 8 || SIGNATURE.some((byte, index) => bytes[index] !== byte)) {
    return err(LogoErrors.notPng());
  }
  const view = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const parts: Buffer[] = [];
  let header: Buffer | undefined;
  let ended = false;
  for (let offset = 8; offset + 8 <= view.length;) {
    const length = view.readUInt32BE(offset);
    // latin1 keeps every byte as it is, where ascii would strip a high bit and let 0xC9 pass for an I.
    const type = view.toString("latin1", offset + 4, offset + 8);
    if (!/^[A-Za-z]{4}$/.test(type)) {
      return err(LogoErrors.corrupt({ detail: "a chunk's type is not four ASCII letters" }));
    }
    if (offset + 12 + length > view.length) {
      return err(LogoErrors.corrupt({ detail: `the ${type} chunk is cut short` }));
    }
    const body = view.subarray(offset + 8, offset + 8 + length);
    if (view.readUInt32BE(offset + 8 + length) !== pngCrc({ bytes: view.subarray(offset + 4, offset + 8 + length) })) {
      return err(LogoErrors.corrupt({ detail: `the ${type} chunk's checksum does not match its contents` }));
    }
    // PNG puts exactly one IHDR first, so a header anywhere else — or a second one — is a damaged file.
    if ((offset === 8) !== (type === "IHDR")) {
      return err(LogoErrors.corrupt({ detail: `the ${type} chunk is out of place: IHDR comes first, once` }));
    }
    // A critical chunk (upper-case first letter, bit 5 clear) this decoder does not read changes the image, so it is
    // refused, as is tRNS, whose transparency an RGB read would drop; PLTE is only a palette suggestion for RGB.
    const critical = (view.readUInt8(offset + 4) & 0x20) === 0;
    if (type === "tRNS" || (critical && !["IHDR", "IDAT", "IEND", "PLTE"].includes(type))) {
      return err(LogoErrors.unsupportedChunk({ type }));
    }
    if (type === "IHDR") {
      header = body;
    } else if (type === "IDAT") {
      parts.push(body);
    } else if (type === "IEND") {
      const trailing = view.length - (offset + 12 + length);
      if (trailing > 0) {
        return err(LogoErrors.corrupt({ detail: `${String(trailing)} byte(s) follow the IEND chunk` }));
      }
      ended = true;
      break;
    }
    offset += 12 + length;
  }
  if (header === undefined || header.length < 13) {
    return err(LogoErrors.corrupt({ detail: "there is no IHDR chunk" }));
  }
  if (!ended) {
    return err(LogoErrors.corrupt({ detail: "there is no IEND chunk, so the file is cut short" }));
  }
  const width = header.readUInt32BE(0);
  const height = header.readUInt32BE(4);
  const depth = header[8]!;
  const colourType = header[9]!;
  const interlace = header[12]!;
  // PNG defines one compression method and one filter method, both 0; any other value is not a PNG to draw.
  if (header[10] !== 0 || header[11] !== 0) {
    return err(
      LogoErrors.corrupt({
        detail: `compression method ${String(header[10])} and filter method ${String(header[11])}, where PNG defines only 0`,
      }),
    );
  }
  const channels = CHANNELS[colourType];
  if (depth !== 8 || channels === undefined || interlace !== 0) {
    return err(LogoErrors.unsupported({ colourType, depth, interlace }));
  }
  if (width !== height) {
    return err(LogoErrors.notSquare({ height, width }));
  }
  let data: Uint8Array;
  try {
    data = inflateSync(Buffer.concat(parts));
  } catch (cause) {
    return err(
      LogoErrors.corrupt({ detail: cause instanceof Error ? cause.message : "the image data would not inflate" }),
    );
  }
  return unfilter({ channels, data, height, width }).map((samples) => {
    if (channels === 4) {
      return { pixels: samples, side: width };
    }
    const pixels = new Uint8Array(width * height * 4);
    for (let index = 0; index < width * height; index += 1) {
      pixels.set(samples.subarray(index * 3, index * 3 + 3), index * 4);
      pixels[index * 4 + 3] = 255;
    }
    return { pixels, side: width };
  });
}

/**
 * Decode the logo asset and check both icons can be drawn from it: big enough for the largest app icon, and with
 * a mark the menu bar can draw, so a logo that would leave the menu bar blank fails the build rather than the bar.
 *
 * @param bytes the asset's contents
 * @returns the logo, or why it cannot be one
 */
export function readLogo({ bytes }: { bytes: Uint8Array }): Result<Bitmap, LogoError> {
  return decodePng({ bytes }).andThen((bitmap) => {
    if (bitmap.side < LOGO_MIN_SIDE) {
      return err(LogoErrors.tooSmall({ needed: LOGO_MIN_SIDE, side: bitmap.side }));
    }
    if (glyphOf({ logo: bitmap }).width === 0) {
      return err(LogoErrors.noMark());
    }
    return ok(bitmap);
  });
}

/**
 * A square bitmap resampled to another side by averaging every source pixel each target pixel covers, weighted by
 * alpha so a transparent edge does not darken what it borders. Downsampling is what icons need; upsampling works
 * but only repeats pixels.
 *
 * @param bitmap the source
 * @param side the target's side in pixels
 * @returns `side * side * 4` bytes, straight alpha
 */
export function resample({ bitmap, side }: { bitmap: Bitmap; side: number }): Uint8Array {
  const out = new Uint8Array(side * side * 4);
  const scale = bitmap.side / side;
  for (let row = 0; row < side; row += 1) {
    const top = Math.floor(row * scale);
    const bottom = Math.max(top + 1, Math.floor((row + 1) * scale));
    for (let column = 0; column < side; column += 1) {
      const left = Math.floor(column * scale);
      const right = Math.max(left + 1, Math.floor((column + 1) * scale));
      let red = 0;
      let green = 0;
      let blue = 0;
      let alpha = 0;
      for (let y = top; y < bottom; y += 1) {
        for (let x = left; x < right; x += 1) {
          const offset = (y * bitmap.side + x) * 4;
          const a = bitmap.pixels[offset + 3]!;
          red += bitmap.pixels[offset]! * a;
          green += bitmap.pixels[offset + 1]! * a;
          blue += bitmap.pixels[offset + 2]! * a;
          alpha += a;
        }
      }
      const target = (row * side + column) * 4;
      const count = (bottom - top) * (right - left);
      if (alpha > 0) {
        out[target] = Math.round(red / alpha);
        out[target + 1] = Math.round(green / alpha);
        out[target + 2] = Math.round(blue / alpha);
      }
      out[target + 3] = Math.round(alpha / count);
    }
  }
  return out;
}

/** The logo's shape alone: how strongly each pixel is part of the mark, 0-1, cropped to the mark's own bounds. */
export interface Glyph {
  readonly width: number;
  readonly height: number;
  readonly ink: Float32Array;
}

/** The contrast against the background at which a pixel counts as fully part of the mark. */
const FULL_INK_CONTRAST = 0.5;

/** The strongest ink below which a logo has no mark at all: alpha or colour noise, not something to draw. */
const MIN_MARK_INK = 0.1;

/**
 * The colour of the plate a logo is drawn on, read off its outer ring of pixels: a plate when most of that ring is
 * opaque, so a mark that merely touches one edge or corner of a transparent logo is never mistaken for one.
 */
function plateOf({ logo }: { logo: Bitmap }): readonly [number, number, number] | undefined {
  const { side, pixels } = logo;
  let ring = 0;
  let opaque = 0;
  const sum = [0, 0, 0];
  for (let y = 0; y < side; y += 1) {
    for (let x = 0; x < side; x += 1) {
      if (y !== 0 && y !== side - 1 && x !== 0 && x !== side - 1) {
        continue;
      }
      ring += 1;
      const offset = (y * side + x) * 4;
      if (pixels[offset + 3]! >= 128) {
        opaque += 1;
        sum[0]! += pixels[offset]!;
        sum[1]! += pixels[offset + 1]!;
        sum[2]! += pixels[offset + 2]!;
      }
    }
  }
  if (opaque * 2 <= ring) {
    return undefined;
  }
  return [sum[0]! / opaque, sum[1]! / opaque, sum[2]! / opaque];
}

/**
 * The mark inside the logo, for a one-colour template. A logo drawn on a transparent background is its alpha; a
 * logo on a solid plate (most of its edge opaque) is how far each pixel's colour stands from that plate's, so the
 * plate drops away and the strokes and the square stay. Ink is scaled so the mark's strongest pixel is full, so a
 * mark drawn faint (half-opaque, say) still draws a solid template, then cropped to the inked bounds so the mark
 * fills the menu bar. An opaque edge with nothing contrasting on it is a mark that reaches the edge — a frame
 * round a transparent centre — so its alpha is read instead.
 *
 * @param logo the decoded asset
 * @returns the mark, or an empty glyph when nothing stands out from the background
 */
export function glyphOf({ logo }: { logo: Bitmap }): Glyph {
  const plate = plateOf({ logo });
  const onPlate = inkedGlyph({ logo, plate });
  if (onPlate.width > 0 || plate === undefined) {
    return onPlate;
  }
  // With no transparent pixel there is no shape in the alpha either: a plain plate has no mark.
  const holed = logo.pixels.some((value, index) => index % 4 === 3 && value < 128);
  if (!holed) {
    return onPlate;
  }
  return inkedGlyph({ logo, plate: undefined });
}

/** The mark read against a plate colour, or from alpha alone when there is none; see {@link glyphOf}. */
function inkedGlyph({ logo, plate }: { logo: Bitmap; plate: readonly [number, number, number] | undefined }): Glyph {
  const { side, pixels } = logo;
  const full = new Float32Array(side * side);
  let strongest = 0;
  for (let y = 0; y < side; y += 1) {
    for (let x = 0; x < side; x += 1) {
      const offset = (y * side + x) * 4;
      const alpha = pixels[offset + 3]! / 255;
      let contrast = 1;
      if (plate !== undefined) {
        const distance = Math.max(
          Math.abs(pixels[offset]! - plate[0]),
          Math.abs(pixels[offset + 1]! - plate[1]),
          Math.abs(pixels[offset + 2]! - plate[2]),
        );
        contrast = Math.min(1, distance / 255 / FULL_INK_CONTRAST);
      }
      const ink = alpha * contrast;
      full[y * side + x] = ink;
      strongest = Math.max(strongest, ink);
    }
  }
  if (strongest < MIN_MARK_INK) {
    return { height: 0, ink: new Float32Array(0), width: 0 };
  }
  let minX = side;
  let minY = side;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < side; y += 1) {
    for (let x = 0; x < side; x += 1) {
      const scaled = full[y * side + x]! / strongest;
      full[y * side + x] = scaled;
      if (scaled >= 0.5) {
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }
  }
  const width = maxX - minX + 1;
  const height = maxY - minY + 1;
  const ink = new Float32Array(width * height);
  for (let y = 0; y < height; y += 1) {
    ink.set(full.subarray((minY + y) * side + minX, (minY + y) * side + minX + width), y * width);
  }
  return { height, ink, width };
}
