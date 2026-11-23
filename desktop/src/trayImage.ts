/**
 * The logo asset as Electron reads it, and the menu bar icon drawn from it: the logo's mark read once, and
 * each variant (`trayIcon.ts` decides its pixels) turned into a Retina-aware template image, drawn once and kept.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { app, type NativeImage, nativeImage } from "electron";

import { type Bitmap, type Glyph, LOGO_ASSET, readLogo } from "./logo";
import type { IconVariant } from "./shellState";
import { menuBarGlyph, trayBitmap } from "./trayIcon";

/** The logo's mark the menu bar icons are drawn from, read on the first draw. */
let glyph: Glyph | undefined;

/** Each icon variant, drawn once: the mark is resampled from the full-size asset, so it is not redrawn per state change. */
const iconImages = new Map<IconVariant, NativeImage>();

/**
 * The logo asset the app carries, decoded. The build already refused an unreadable asset (`makeIcon.ts` reads the
 * same file), so failing here means the bundle itself is damaged, and it says so.
 *
 * @returns the decoded logo
 */
export function readAppLogo(): Bitmap {
  const logo = readLogo({ bytes: readFileSync(join(app.getAppPath(), LOGO_ASSET)) });
  if (logo.isErr()) {
    throw new Error(`Slopweaver cannot read its logo: ${logo.error.message}`);
  }
  return logo.value;
}

/** The logo's mark, from the asset the app carries; an asset with no drawable mark is a damaged bundle. */
function readGlyph(): Glyph {
  const mark = menuBarGlyph({ logo: readAppLogo() });
  if (mark.isErr()) {
    throw new Error(`Slopweaver cannot draw its menu bar icon: ${mark.error.message}`);
  }
  return mark.value;
}

/** The logo's mark, read on the first draw and kept for every later one. */
function currentGlyph(): Glyph {
  if (glyph !== undefined) {
    return glyph;
  }
  const read = readGlyph();
  glyph = read;
  return read;
}

/**
 * One icon variant as a Retina-aware template image.
 *
 * @param variant the state the menu bar icon shows
 * @returns the image, drawn on its first request and reused after
 */
export function trayImage({ variant }: { variant: IconVariant }): NativeImage {
  const drawn = iconImages.get(variant);
  if (drawn !== undefined) {
    return drawn;
  }
  const mark = currentGlyph();
  const image = nativeImage.createEmpty();
  for (const scaleFactor of [1, 2]) {
    const size = 16 * scaleFactor;
    image.addRepresentation({
      buffer: Buffer.from(trayBitmap({ glyph: mark, size, variant })),
      height: size,
      scaleFactor,
      width: size,
    });
  }
  image.setTemplateImage(true);
  iconImages.set(variant, image);
  return image;
}
