/**
 * The logo asset both icons are made from: a PNG decoded round-trip and through every scanline filter, each kind
 * of unreadable file named, a plate dropped to leave the mark, and the committed asset read against its contract.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { deflateSync } from "node:zlib";

import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "../../../src/lib/result";
import { encodePng } from "../../src/appIcon";
import { decodePng, glyphOf, LOGO_ASSET, LOGO_MIN_SIDE, readLogo, resample } from "../../src/logo";
import { pngCrc } from "../../src/logoPng";

/** A PNG file from its parts, so a test can write a header or filter the encoder never would. */
function pngFile({ header, data }: { header: Buffer; data: Buffer }): Buffer {
  const chunk = ({ type, body }: { type: string; body: Buffer }): Buffer => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(body.length);
    const typed = Buffer.concat([Buffer.from(type, "ascii"), body]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(pngCrc({ bytes: typed }));
    return Buffer.concat([length, typed, crc]);
  };
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk({ body: header, type: "IHDR" }),
    chunk({ body: deflateSync(data), type: "IDAT" }),
    chunk({ body: Buffer.alloc(0), type: "IEND" }),
  ]);
}

/** An IHDR body; RGBA, 8-bit, not interlaced unless a field says otherwise. */
function ihdr({
  width,
  height,
  depth = 8,
  colourType = 6,
  interlace = 0,
}: {
  width: number;
  height: number;
  depth?: number;
  colourType?: number;
  interlace?: number;
}): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = depth;
  header[9] = colourType;
  header[12] = interlace;
  return header;
}

/** A 2x2 RGB file from its filtered scanlines, each row's filter byte first. */
function rgb2x2({ rows }: { rows: readonly (readonly number[])[] }): Buffer {
  return pngFile({ data: Buffer.from(rows.flat()), header: ihdr({ colourType: 2, height: 2, width: 2 }) });
}

const ASSET = readFileSync(join(__dirname, "..", "..", LOGO_ASSET));

describe("decodePng", () => {
  it("reads back what encodePng wrote, byte for byte", () => {
    const pixels = Uint8Array.from({ length: 3 * 3 * 4 }, (_, index) => (index * 37) % 256);
    expect(unwrap(decodePng({ bytes: encodePng({ pixels, size: 3 }) }))).toEqual({ pixels, side: 3 });
  });

  it("undoes the sub and up filters, and widens RGB to opaque RGBA", () => {
    // Intended rows: [10,20,30 | 40,50,60] then [15,25,35 | 45,55,65].
    const bytes = rgb2x2({
      rows: [
        [1, 10, 20, 30, 30, 30, 30],
        [2, 5, 5, 5, 5, 5, 5],
      ],
    });
    expect([...unwrap(decodePng({ bytes })).pixels]).toEqual([
      10, 20, 30, 255, 40, 50, 60, 255, 15, 25, 35, 255, 45, 55, 65, 255,
    ]);
  });

  it("undoes the average and Paeth filters, Paeth choosing left, up and corner", () => {
    // Intended rows: [200,100,0 | 250,150,50] then [1,2,3 | 4,5,6]. The second row's second pixel predicts
    // red from the left, green from the corner and blue from above.
    const bytes = rgb2x2({
      rows: [
        [3, 200, 100, 0, 150, 100, 50],
        [4, 57, 158, 3, 3, 161, 212],
      ],
    });
    expect([...unwrap(decodePng({ bytes })).pixels]).toEqual([
      200, 100, 0, 255, 250, 150, 50, 255, 1, 2, 3, 255, 4, 5, 6, 255,
    ]);
  });

  it("names a file that is not a PNG", () => {
    expect(unwrapErr(decodePng({ bytes: Buffer.from("GIF89a") })).code).toBe("LOGO_NOT_PNG");
  });

  it("names a 16-bit file as unsupported", () => {
    const bytes = pngFile({ data: Buffer.alloc(9), header: ihdr({ depth: 16, height: 1, width: 1 }) });
    expect(unwrapErr(decodePng({ bytes })).message).toBe(
      "the logo asset is a PNG of bit depth 16, colour type 6, interlace 0; save it as 8-bit RGBA, not interlaced",
    );
  });

  it("names a tRNS chunk the icons would drop", () => {
    const whole = encodePng({ pixels: new Uint8Array(4), size: 1 });
    const trns = Buffer.from([0, 0, 0, 6, 0x74, 0x52, 0x4e, 0x53, 0, 255, 0, 0, 0, 0]);
    const crc = pngCrc({ bytes: trns.subarray(4) });
    const chunk = Buffer.concat([trns, Buffer.from([crc >>> 24, (crc >>> 16) & 255, (crc >>> 8) & 255, crc & 255])]);
    const bytes = Buffer.concat([whole.subarray(0, 33), chunk, whole.subarray(33)]);
    expect(unwrapErr(decodePng({ bytes })).message).toBe(
      "the logo asset carries a tRNS chunk the icons cannot honour; save it as plain 8-bit RGBA",
    );
  });

  it("names a chunk type that is not four letters as corrupt, even one that strips to IDAT", () => {
    const whole = encodePng({ pixels: new Uint8Array(4), size: 1 });
    // 0xC9 is "I" with its high bit set, so an ascii read would see IDAT.
    const unknown = Buffer.from([0, 0, 0, 0, 0xc9, 0x44, 0x41, 0x54]);
    const crc = pngCrc({ bytes: unknown.subarray(4) });
    const chunk = Buffer.concat([unknown, Buffer.from([crc >>> 24, (crc >>> 16) & 255, (crc >>> 8) & 255, crc & 255])]);
    const bytes = Buffer.concat([whole.subarray(0, 33), chunk, whole.subarray(33)]);
    expect(unwrapErr(decodePng({ bytes })).message).toBe(
      "the logo asset is a damaged PNG: a chunk's type is not four ASCII letters",
    );
  });

  it("names an unknown critical chunk the icons would misdraw", () => {
    const whole = encodePng({ pixels: new Uint8Array(4), size: 1 });
    const unknown = Buffer.from([0, 0, 0, 0, 0x51, 0x61, 0x61, 0x61]);
    const crc = pngCrc({ bytes: unknown.subarray(4) });
    const chunk = Buffer.concat([unknown, Buffer.from([crc >>> 24, (crc >>> 16) & 255, (crc >>> 8) & 255, crc & 255])]);
    const bytes = Buffer.concat([whole.subarray(0, 33), chunk, whole.subarray(33)]);
    expect(unwrapErr(decodePng({ bytes })).message).toBe(
      "the logo asset carries a Qaaa chunk the icons cannot honour; save it as plain 8-bit RGBA",
    );
  });

  it("names a second IHDR chunk as corrupt", () => {
    const whole = encodePng({ pixels: new Uint8Array(4), size: 1 });
    // The signature, then the 25-byte IHDR chunk twice, then the rest of the file.
    const bytes = Buffer.concat([whole.subarray(0, 33), whole.subarray(8, 33), whole.subarray(33)]);
    expect(unwrapErr(decodePng({ bytes })).message).toBe(
      "the logo asset is a damaged PNG: the IHDR chunk is out of place: IHDR comes first, once",
    );
  });

  it("names a compression method PNG does not define", () => {
    const header = ihdr({ height: 1, width: 1 });
    header[10] = 1;
    expect(unwrapErr(decodePng({ bytes: pngFile({ data: Buffer.alloc(5), header }) })).message).toBe(
      "the logo asset is a damaged PNG: compression method 1 and filter method 0, where PNG defines only 0",
    );
  });

  it("names an interlaced file as unsupported", () => {
    const bytes = pngFile({ data: Buffer.alloc(5), header: ihdr({ height: 1, interlace: 1, width: 1 }) });
    expect(unwrapErr(decodePng({ bytes })).code).toBe("LOGO_UNSUPPORTED");
  });

  it("names a file that is not square", () => {
    const bytes = pngFile({ data: Buffer.alloc(26), header: ihdr({ height: 2, width: 3 }) });
    expect(unwrapErr(decodePng({ bytes })).message).toBe("the logo asset is 3x2, and an icon is square");
  });

  it("names image data of the wrong length as corrupt", () => {
    const bytes = pngFile({ data: Buffer.alloc(4), header: ihdr({ height: 1, width: 1 }) });
    expect(unwrapErr(decodePng({ bytes })).message).toBe(
      "the logo asset is a damaged PNG: image data is 4 bytes, not 5",
    );
  });

  it("names a file cut short before its IEND chunk as corrupt", () => {
    const whole = encodePng({ pixels: new Uint8Array(4), size: 1 });
    expect(unwrapErr(decodePng({ bytes: whole.subarray(0, whole.length - 12) })).message).toBe(
      "the logo asset is a damaged PNG: there is no IEND chunk, so the file is cut short",
    );
  });

  it("names a file missing only its last checksum as cut short", () => {
    const whole = encodePng({ pixels: new Uint8Array(4), size: 1 });
    expect(unwrapErr(decodePng({ bytes: whole.subarray(0, whole.length - 4) })).message).toBe(
      "the logo asset is a damaged PNG: the IEND chunk is cut short",
    );
  });

  it("names anything after the IEND chunk as corrupt", () => {
    const whole = encodePng({ pixels: new Uint8Array(4), size: 1 });
    const bytes = Buffer.concat([whole, Buffer.from([0, 0, 0, 0, 0x74, 0x45, 0x58, 0x74, 0, 0, 0, 0])]);
    expect(unwrapErr(decodePng({ bytes })).message).toBe(
      "the logo asset is a damaged PNG: 12 byte(s) follow the IEND chunk",
    );
  });

  it("names a chunk whose checksum does not match", () => {
    const bytes = Buffer.from(encodePng({ pixels: new Uint8Array(4), size: 1 }));
    bytes[bytes.length - 1] = bytes[bytes.length - 1]! ^ 0xff;
    expect(unwrapErr(decodePng({ bytes })).message).toBe(
      "the logo asset is a damaged PNG: the IEND chunk's checksum does not match its contents",
    );
  });

  it("names an unknown scanline filter as corrupt", () => {
    const bytes = pngFile({ data: Buffer.from([9, 0, 0, 0, 0]), header: ihdr({ height: 1, width: 1 }) });
    expect(unwrapErr(decodePng({ bytes })).message).toBe("the logo asset is a damaged PNG: row 0 has unknown filter 9");
  });
});

describe("readLogo", () => {
  it("refuses an asset too small to draw the 1024px icon from", () => {
    const small = encodePng({ pixels: new Uint8Array(4 * 4 * 4), size: 4 });
    expect(unwrapErr(readLogo({ bytes: small })).message).toBe(
      "the logo asset is 4px a side, and the largest app icon needs 1024",
    );
  });

  it("refuses an asset with no mark for the menu bar to draw", () => {
    const plain = encodePng({ pixels: new Uint8Array(1024 * 1024 * 4).fill(255), size: 1024 });
    expect(unwrapErr(readLogo({ bytes: plain })).code).toBe("LOGO_NO_MARK");
  });

  // The committed asset is checked against the CONTRACT only, never its pixels: swapping the logo is replacing
  // that one file, and a test pinning today's colours would make it two changes.
  it("reads the committed asset as a square of at least the largest icon's side", () => {
    const logo = unwrap(readLogo({ bytes: ASSET }));
    expect(logo.side).toBeGreaterThanOrEqual(LOGO_MIN_SIDE);
    expect(logo.pixels.length).toBe(logo.side * logo.side * 4);
  });
});

describe("resample", () => {
  it("averages the pixels each target pixel covers, weighted by alpha", () => {
    // Opaque white, opaque black and two transparent pixels, down to one pixel: grey at half alpha.
    const pixels = Uint8Array.from([255, 255, 255, 255, 0, 0, 0, 255, 9, 9, 9, 0, 9, 9, 9, 0]);
    expect([...resample({ bitmap: { pixels, side: 2 }, side: 1 })]).toEqual([128, 128, 128, 128]);
  });
});

describe("glyphOf", () => {
  it("drops an opaque plate and crops to the mark", () => {
    const pixels = new Uint8Array(4 * 4 * 4);
    for (let index = 0; index < 16; index += 1) {
      pixels.set([10, 10, 10, 255], index * 4);
    }
    pixels.set([240, 240, 240, 255], (1 * 4 + 2) * 4);
    const glyph = glyphOf({ logo: { pixels, side: 4 } });
    expect([glyph.width, glyph.height, ...glyph.ink]).toEqual([1, 1, 1]);
  });

  it("reads a transparent background's mark from alpha", () => {
    const pixels = Uint8Array.from([0, 0, 0, 0, 0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0, 0]);
    const glyph = glyphOf({ logo: { pixels, side: 2 } });
    expect([glyph.width, glyph.height, ...glyph.ink]).toEqual([2, 2, 0, 1, 1, 0]);
  });

  it("reads a transparent logo whose mark touches a corner from alpha, never as a plate", () => {
    // Transparent black, with an opaque black 2x2 block in the top-left corner.
    const pixels = new Uint8Array(4 * 4 * 4);
    for (const [x, y] of [
      [0, 0],
      [1, 0],
      [0, 1],
      [1, 1],
    ] as const) {
      pixels[(y * 4 + x) * 4 + 3] = 255;
    }
    const glyph = glyphOf({ logo: { pixels, side: 4 } });
    expect([glyph.width, glyph.height, ...glyph.ink]).toEqual([2, 2, 1, 1, 1, 1]);
  });

  it("draws a half-opaque mark on a transparent background at full strength", () => {
    const pixels = Uint8Array.from([0, 0, 0, 0, 255, 255, 255, 127, 0, 0, 0, 0, 0, 0, 0, 0]);
    const glyph = glyphOf({ logo: { pixels, side: 2 } });
    expect([glyph.width, glyph.height, ...glyph.ink]).toEqual([1, 1, 1]);
  });

  it("finds no mark in near-transparent noise", () => {
    const pixels = Uint8Array.from([0, 0, 0, 0, 0, 0, 0, 20, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(glyphOf({ logo: { pixels, side: 2 } }).width).toBe(0);
  });

  it("reads an opaque frame round a transparent centre as the mark, not a plate", () => {
    // 3x3: an opaque black ring with a transparent centre.
    const pixels = new Uint8Array(3 * 3 * 4);
    for (let index = 0; index < 9; index += 1) {
      pixels[index * 4 + 3] = index === 4 ? 0 : 255;
    }
    const glyph = glyphOf({ logo: { pixels, side: 3 } });
    expect([glyph.width, glyph.height, ...glyph.ink]).toEqual([3, 3, 1, 1, 1, 1, 0, 1, 1, 1, 1]);
  });

  it("finds no mark on a plain plate", () => {
    const pixels = Uint8Array.from([10, 10, 10, 255, 10, 10, 10, 255, 10, 10, 10, 255, 10, 10, 10, 255]);
    expect(glyphOf({ logo: { pixels, side: 2 } }).width).toBe(0);
  });

  it("finds a mark in the committed logo for the menu bar to draw", () => {
    expect(glyphOf({ logo: unwrap(readLogo({ bytes: ASSET })) }).width).toBeGreaterThan(0);
  });
});
