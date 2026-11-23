/**
 * The PNG primitives the logo's decoder rests on: the CRC-32 every chunk carries, and undoing each scanline's filter.
 * Pure; `logo.ts` decodes the asset with them.
 */
import { err, ok, type Result } from "neverthrow";

import { type LogoError, LogoErrors } from "./errors";

/** CRC-32 lookup table, the PNG polynomial. */
const CRC_TABLE: readonly number[] = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  return value >>> 0;
});

/**
 * The CRC-32 every PNG chunk carries, computed over the chunk's type and data.
 *
 * @param bytes the chunk's four type bytes followed by its data
 * @returns the checksum, unsigned
 */
export function pngCrc({ bytes }: { bytes: Uint8Array }): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** The Paeth predictor from the PNG specification. */
function paeth({ left, up, corner }: { left: number; up: number; corner: number }): number {
  const estimate = left + up - corner;
  const toLeft = Math.abs(estimate - left);
  const toUp = Math.abs(estimate - up);
  const toCorner = Math.abs(estimate - corner);
  if (toLeft <= toUp && toLeft <= toCorner) {
    return left;
  }
  if (toUp <= toCorner) {
    return up;
  }
  return corner;
}

/**
 * Undo each scanline's filter in place, from the inflated image data.
 *
 * @returns the raw samples, one row after another with the filter bytes gone, or why the data was wrong
 */
export function unfilter({
  data,
  width,
  height,
  channels,
}: {
  data: Uint8Array;
  width: number;
  height: number;
  channels: number;
}): Result<Uint8Array, LogoError> {
  const stride = width * channels;
  if (data.length !== (stride + 1) * height) {
    return err(
      LogoErrors.corrupt({
        detail: `image data is ${String(data.length)} bytes, not ${String((stride + 1) * height)}`,
      }),
    );
  }
  const out = new Uint8Array(stride * height);
  for (let row = 0; row < height; row += 1) {
    const filter = data[row * (stride + 1)]!;
    const source = row * (stride + 1) + 1;
    const target = row * stride;
    for (let index = 0; index < stride; index += 1) {
      const raw = data[source + index]!;
      const left = index >= channels ? out[target + index - channels]! : 0;
      const up = row > 0 ? out[target - stride + index]! : 0;
      const corner = row > 0 && index >= channels ? out[target - stride + index - channels]! : 0;
      let predicted: number;
      switch (filter) {
        case 0:
          predicted = 0;
          break;
        case 1:
          predicted = left;
          break;
        case 2:
          predicted = up;
          break;
        case 3:
          predicted = Math.floor((left + up) / 2);
          break;
        case 4:
          predicted = paeth({ corner, left, up });
          break;
        default:
          return err(LogoErrors.corrupt({ detail: `row ${String(row)} has unknown filter ${String(filter)}` }));
      }
      out[target + index] = (raw + predicted) & 0xff;
    }
  }
  return ok(out);
}
