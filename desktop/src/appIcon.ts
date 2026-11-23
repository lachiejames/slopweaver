/**
 * The app icon — what the Dock, Cmd-Tab, Launchpad and Finder show — is the Slopweaver logo, read
 * from `assets/logo.png` (`logo.ts`), so swapping it is replacing that one file. It is packed full bleed at each
 * size an `.icns` carries; `makeIcon.ts` writes the file the build config names. Pure.
 */
import { deflateSync } from "node:zlib";

import { type Bitmap, resample } from "./logo";
import { pngCrc } from "./logoPng";

/**
 * The icon at one size: the logo, full bleed. macOS masks an app icon to its own squircle and keeps its own
 * margin, so the artwork fills the square rather than drawing a plate macOS would inset a second time.
 *
 * @param logo the decoded asset
 * @param size the side in pixels
 * @returns `size * size * 4` bytes of RGBA, straight alpha, row by row from the top
 */
export function appIconBitmap({ logo, size }: { logo: Bitmap; size: number }): Uint8Array {
  return resample({ bitmap: logo, side: size });
}

/** One PNG chunk: length, type, data, CRC over type and data. */
function chunk({ type, data }: { type: string; data: Uint8Array }): Buffer {
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const head = Buffer.alloc(4);
  head.writeUInt32BE(data.length);
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE(pngCrc({ bytes: body }));
  return Buffer.concat([head, body, tail]);
}

/**
 * An RGBA bitmap as a PNG file.
 *
 * @param pixels a bitmap from {@link appIconBitmap}
 * @param size its side
 * @returns the file's bytes
 */
export function encodePng({ pixels, size }: { pixels: Uint8Array; size: number }): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 6;
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let row = 0; row < size; row += 1) {
    raw.set(pixels.subarray(row * stride, (row + 1) * stride), row * (stride + 1) + 1);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk({ data: header, type: "IHDR" }),
    chunk({ data: deflateSync(raw), type: "IDAT" }),
    chunk({ data: new Uint8Array(0), type: "IEND" }),
  ]);
}

/**
 * The `.icns` entry types that hold a PNG, by the side in pixels each one is: every point size macOS draws an app
 * icon at (16, 32, 128, 256, 512), at 1x and at 2x.
 */
export const ICNS_SIZES: ReadonlyArray<{ readonly type: string; readonly size: number }> = [
  { size: 16, type: "icp4" },
  { size: 32, type: "ic11" },
  { size: 32, type: "icp5" },
  { size: 64, type: "ic12" },
  { size: 128, type: "ic07" },
  { size: 256, type: "ic13" },
  { size: 256, type: "ic08" },
  { size: 512, type: "ic14" },
  { size: 512, type: "ic09" },
  { size: 1024, type: "ic10" },
];

/**
 * The whole icon as an `.icns` file: one PNG entry per size in {@link ICNS_SIZES}.
 *
 * @param logo the decoded asset
 * @returns the file's bytes
 */
export function appIconIcns({ logo }: { logo: Bitmap }): Buffer {
  const pngs = new Map<number, Buffer>();
  const entries = ICNS_SIZES.map(({ type, size }) => {
    let png = pngs.get(size);
    if (png === undefined) {
      png = encodePng({ pixels: appIconBitmap({ logo, size }), size });
      pngs.set(size, png);
    }
    const head = Buffer.alloc(8);
    head.write(type, 0, "ascii");
    head.writeUInt32BE(png.length + 8, 4);
    return Buffer.concat([head, png]);
  });
  const body = Buffer.concat(entries);
  const head = Buffer.alloc(8);
  head.write("icns", 0, "ascii");
  head.writeUInt32BE(body.length + 8, 4);
  return Buffer.concat([head, body]);
}
