/**
 * Region-scoped pixel measurement — what a declared data region actually holds, row by row.
 *
 * ## Why it scans a REGION and not the frame
 *
 * The incident's PNG carried ink on nearly every row: the facet sidebar filled the left of the page from
 * top to bottom. A whole-row scan reported a busy page. The results panel to its right was empty from
 * `y=736` to `y=5053`. So the only scan that sees an unloaded panel is one confined to the panel's own
 * column range — MEASURED in the incident's FINDINGS.md § 3: 374 of 6722 rows in that range carried ink,
 * 5.56%. This module reads the region a caller names and nothing outside it.
 *
 * ## The background is sampled from the region's own corners and must agree
 *
 * `src/proof/yarnWhy/pixels.ts` samples `(w-3, h-3)` once, which is right for a terminal capture whose
 * bottom-right is always the terminal's background. A console page has no such guarantee, so this samples
 * all four corners of the region and requires at least three to agree within tolerance; when they do not,
 * the region has no single background and the scan refuses rather than measuring against a guess.
 */
import { err, ok, type Result } from "#lib/result.js";
import { type PixelSource, rgbDistance } from "../proof/yarnWhy/pixels.js";
import { type VisualEvidenceError, VisualEvidenceErrors } from "./evidenceErrors.js";
import type { PixelRect } from "./types.js";

export type { PixelSource } from "../proof/yarnWhy/pixels.js";

/**
 * The `rgbDistance` above which a pixel counts as ink against the sampled background.
 * @internal
 */
export const DEFAULT_INK_TOLERANCE = 18;

/**
 * Columns sampled per row. Eight keeps a 4000-wide region under a millisecond per row.
 * @internal
 */
export const DEFAULT_SAMPLE_STRIDE = 8;

/** How many of the region's four corners must share a colour for it to be the background. */
const CORNERS_MUST_AGREE = 3;

/**
 * A run of consecutive rows in which no sampled pixel differed from the background.
 * @internal — a field type of {@link RegionInk}.
 */
export interface BlankBand {
  readonly fromY: number;
  readonly toY: number;
  readonly rows: number;
}

/** What a region scan measured. */
export interface RegionInk {
  readonly rows: number;
  readonly inkRows: number;
  /** `inkRows / rows`; 0 for an empty region, 1 for one with ink on every row. */
  readonly inkRowFraction: number;
  readonly bands: readonly BlankBand[];
  /** The longest blank band, in rows; 0 when there is none. */
  readonly longestBlankRows: number;
  readonly background: number;
}

/** The colour at least {@link CORNERS_MUST_AGREE} corners of the region share, or `null`. */
function regionBackground({
  image,
  region,
  tolerance,
}: {
  image: PixelSource;
  region: PixelRect;
  tolerance: number;
}): number | null {
  const right = region.x + region.width - 1;
  const bottom = region.y + region.height - 1;
  const corners = [
    image.getPixelColor(region.x, region.y),
    image.getPixelColor(right, region.y),
    image.getPixelColor(region.x, bottom),
    image.getPixelColor(right, bottom),
  ];
  for (const candidate of corners) {
    const agreeing = corners.filter((other) => rgbDistance({ a: candidate, b: other }) <= tolerance).length;
    if (agreeing >= CORNERS_MUST_AGREE) {
      return candidate;
    }
  }
  return null;
}

/** Walk every row of the region once, collecting the blank bands and counting the rows with ink. */
function scanRows({
  image,
  region,
  background,
  stride,
  tolerance,
}: {
  image: PixelSource;
  region: PixelRect;
  background: number;
  stride: number;
  tolerance: number;
}): { readonly bands: readonly BlankBand[]; readonly inkRows: number } {
  const rowHasInk = ({ y }: { y: number }): boolean => {
    for (let x = region.x; x < region.x + region.width; x += stride) {
      if (rgbDistance({ a: image.getPixelColor(x, y), b: background }) > tolerance) {
        return true;
      }
    }
    return false;
  };
  const bands: BlankBand[] = [];
  let inkRows = 0;
  let bandStart: number | null = null;
  const closeBand = ({ endY }: { endY: number }): void => {
    if (bandStart !== null) {
      bands.push({ fromY: bandStart, rows: endY - bandStart, toY: endY - 1 });
      bandStart = null;
    }
  };
  for (let y = region.y; y < region.y + region.height; y += 1) {
    if (rowHasInk({ y })) {
      inkRows += 1;
      closeBand({ endY: y });
      continue;
    }
    // A blank row inside an open band only extends it; the first blank row after ink opens one.
    if (bandStart !== null) {
      continue;
    }
    bandStart = y;
  }
  closeBand({ endY: region.y + region.height });
  return { bands, inkRows };
}

/**
 * Scan a region row by row and report where it is blank.
 *
 * @param image the decoded picture
 * @param region the rectangle to scan, in image pixels; must lie inside the image
 * @param sampleStride columns sampled per row
 * @param tolerance the `rgbDistance` a sampled pixel must exceed to count as ink
 * @returns the measurement, or why the region could not be scanned
 */
export function measureRegionInk({
  image,
  region,
  sampleStride = DEFAULT_SAMPLE_STRIDE,
  tolerance = DEFAULT_INK_TOLERANCE,
}: {
  image: PixelSource;
  region: PixelRect;
  sampleStride?: number;
  tolerance?: number;
}): Result<RegionInk, VisualEvidenceError> {
  if (region.width < 2 || region.height < 2) {
    return err(VisualEvidenceErrors.regionTooSmall({ height: region.height, width: region.width }));
  }
  if (
    region.x < 0 ||
    region.y < 0 ||
    region.x + region.width > image.width ||
    region.y + region.height > image.height
  ) {
    return err(VisualEvidenceErrors.regionOutsideImage({ height: image.height, region, width: image.width }));
  }
  const background = regionBackground({ image, region, tolerance });
  if (background === null) {
    return err(VisualEvidenceErrors.backgroundAmbiguous());
  }
  const scanned = scanRows({ background, image, region, stride: Math.max(1, sampleStride), tolerance });
  const { bands, inkRows } = scanned;
  return ok({
    background,
    bands,
    inkRowFraction: inkRows / region.height,
    inkRows,
    longestBlankRows: bands.reduce((longest, band) => Math.max(longest, band.rows), 0),
    rows: region.height,
  });
}
