/**
 * Pure pixel-level helpers shared by the golden-proof compositor — kept separate from {@link ./compose.js}
 * so the geometry (where content ends, how far apart two colors are) is testable with plain in-memory
 * pixel data, no image library or file I/O involved.
 */

/** Anything exposing Jimp's own `getPixelColor(x, y)` read shape — real or a test fixture. */
export interface PixelSource {
  readonly width: number;
  readonly height: number;
  // named-object-params-exempt: matches Jimp's own real getPixelColor(x, y) call shape, which this repo does not own
  getPixelColor(x: number, y: number): number;
}

/** An RGBA color's channels, unpacked from Jimp's packed `0xRRGGBBAA` integer form. */
export interface Rgba {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly a: number;
}

/**
 * Unpack a Jimp `0xRRGGBBAA` integer into its channels.
 *
 * @param color the packed color integer
 * @returns the unpacked channels
 */
export function unpackRgba({ color }: { color: number }): Rgba {
  return {
    a: color & 0xff,
    b: (color >>> 8) & 0xff,
    g: (color >>> 16) & 0xff,
    r: (color >>> 24) & 0xff,
  };
}

/**
 * Pack RGBA channels into Jimp's `0xRRGGBBAA` integer form.
 *
 * @param r red channel, 0-255
 * @param g green channel, 0-255
 * @param b blue channel, 0-255
 * @param a alpha channel, 0-255
 * @returns the packed color integer
 */
export function packRgba({ r, g, b, a }: Rgba): number {
  return ((r << 24) | (g << 16) | (b << 8) | a) >>> 0;
}

/**
 * The sum of each channel's absolute difference between two colors — small for near-identical colors,
 * large for visibly different ones. Used to tell real terminal content from flat background.
 *
 * @param a the first packed color
 * @param b the second packed color
 * @returns the summed RGB channel distance (alpha is ignored — captures are always opaque)
 */
export function rgbDistance({ a, b }: { a: number; b: number }): number {
  const ca = unpackRgba({ color: a });
  const cb = unpackRgba({ color: b });
  return Math.abs(ca.r - cb.r) + Math.abs(ca.g - cb.g) + Math.abs(ca.b - cb.b);
}

/**
 * Find the last row (from the top) that contains real content rather than flat background, so a captured
 * window's trailing blank rows can be cropped away. The background color is sampled from the image's own
 * bottom-right corner — reliably background in every capture this compositor has seen, since a short
 * command's output never fills the whole pane.
 *
 * @param image the pixel source to scan (a real Jimp image, or a test fixture)
 * @param sampleStride how many pixels to skip between samples along a row — a full per-pixel scan is not
 *   needed to tell content from background
 * @param tolerance the RGB distance above which a pixel counts as "not background"
 * @returns the 0-based row index of the last row with content, or 0 when the whole image is background
 */
export function findLastContentRow({
  image,
  sampleStride = 8,
  tolerance = 18,
}: {
  image: PixelSource;
  sampleStride?: number;
  tolerance?: number;
}): number {
  const background = image.getPixelColor(image.width - 3, image.height - 3);
  const rowHasContent = ({ y }: { y: number }): boolean => {
    for (let x = 0; x < image.width; x += Math.max(1, sampleStride)) {
      if (rgbDistance({ a: image.getPixelColor(x, y), b: background }) > tolerance) {
        return true;
      }
    }
    return false;
  };
  for (let y = image.height - 1; y >= 0; y -= 1) {
    if (rowHasContent({ y })) {
      return y;
    }
  }
  return 0;
}
