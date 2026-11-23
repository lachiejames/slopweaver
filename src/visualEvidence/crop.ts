/**
 * The crop a capture takes — from the page's own target and context geometry, never from pixel density.
 *
 * ## Why not crop to the ink
 *
 * MEASURED on the incident's own PNG (the incident's own FINDINGS.md § 6): a crop to the content bounding box took the aspect ratio from 1.67 to 1.69 — worse —
 * because most of the blank was INTERIOR, and a crop to the densest window picked the facet sidebar,
 * because the sidebar is the densest thing on a Log Explorer page and is not the evidence. The target
 * region the page itself reports gave 3000x560 at 25.4% ink. So the crop is the union of the target's
 * rectangle and every required context rectangle (the query, the time range), padded, and nothing else
 * decides it.
 *
 * ## The scale is `devicePixelRatio`, and the image's size is NOT the frame's — measured, both ways
 *
 * MEASURED on the owner's Chrome, which runs Datadog at 75% zoom: the page reported
 * `devicePixelRatio` 1.5 and `innerWidth` 2016, and the viewport capture came back 4032x1766 — twice the
 * viewport, which read as "scale 2". Cropping at 2 put the chart's frame 25% right of the chart, and the
 * region scan found the chart's rectangle blank. Looking at the picture: the content was painted at 1.5
 * image pixels per CSS pixel and the canvas was sized at 2 (the display's own ratio, zoom undone), leaving
 * a blank margin on the right and the bottom. So the size ratio is the DEVICE ratio and says nothing about
 * where content sits; `devicePixelRatio` is the paint scale. The check that survives: the image must be
 * at least the frame at that scale on both axes, and the region ink scan (`./pixels.ts`) stays the
 * witness that a crop landed on drawn pixels rather than on margin. The FRAME is the viewport
 * (`./observation.ts` carries why it is never the whole page), so every rectangle here is in viewport CSS
 * pixels.
 */
import { err, ok, type Result } from "#lib/result.js";
import { type VisualEvidenceError, VisualEvidenceErrors } from "./evidenceErrors.js";
import type { CssRect } from "./observation.js";
import type { PixelRect } from "./types.js";

/** Breathing room around the union, in CSS pixels, so a border drawn later does not touch the evidence. */
export const DEFAULT_CROP_PADDING_CSS_PX = 12;

/** One region the crop must contain. */
export interface RequiredRegion {
  readonly name: string;
  readonly rect: CssRect;
}

/** What relates the frame's CSS pixels to image pixels for one capture. */
export interface CaptureGeometry {
  readonly imageWidth: number;
  readonly imageHeight: number;
  /** The frame's CSS size — the viewport the picture is of. */
  readonly frameWidth: number;
  readonly frameHeight: number;
  /** The page's own `window.devicePixelRatio` — the paint scale, zoom included. */
  readonly devicePixelRatio: number;
}

/** A crop, with the scale that produced it and the union it enclosed. */
export interface EvidenceCrop {
  readonly rect: PixelRect;
  readonly scale: number;
  readonly unionCss: CssRect;
}

/**
 * The frame-to-image paint scale, checked against the image's size.
 *
 * @param geometry the image size, the frame size and the page's pixel ratio
 * @returns the scale, or why the capture cannot be mapped
 */
export function captureScale({ geometry }: { geometry: CaptureGeometry }): Result<number, VisualEvidenceError> {
  const { devicePixelRatio, frameHeight, frameWidth, imageHeight, imageWidth } = geometry;
  if (frameWidth <= 0 || frameHeight <= 0 || imageWidth <= 0 || imageHeight <= 0) {
    return err(VisualEvidenceErrors.geometryNotPositive());
  }
  if (!Number.isFinite(devicePixelRatio) || devicePixelRatio <= 0) {
    return err(VisualEvidenceErrors.pixelRatioNotAScale({ devicePixelRatio }));
  }
  const painted = {
    height: Math.floor(frameHeight * devicePixelRatio),
    width: Math.floor(frameWidth * devicePixelRatio),
  };
  if (imageWidth < painted.width || imageHeight < painted.height) {
    return err(
      VisualEvidenceErrors.tooFewPixels({
        devicePixelRatio,
        frameHeight,
        frameWidth,
        imageHeight,
        imageWidth,
        painted,
      }),
    );
  }
  return ok(devicePixelRatio);
}

/** The smallest rectangle containing every region. */
function unionOf({ regions }: { regions: readonly RequiredRegion[] }): CssRect {
  let left = Number.POSITIVE_INFINITY;
  let top = Number.POSITIVE_INFINITY;
  let right = Number.NEGATIVE_INFINITY;
  let bottom = Number.NEGATIVE_INFINITY;
  for (const region of regions) {
    left = Math.min(left, region.rect.x);
    top = Math.min(top, region.rect.y);
    right = Math.max(right, region.rect.x + region.rect.width);
    bottom = Math.max(bottom, region.rect.y + region.rect.height);
  }
  return { height: bottom - top, width: right - left, x: left, y: top };
}

/**
 * Decide the crop: the union of every required region, padded, scaled outward to whole image pixels,
 * and clamped to the image — refusing when a region is degenerate or off the page. No "too large" arm on
 * purpose: on a page no taller than the viewport the target legitimately IS most of it, and the crop is
 * still anchored to the page's own geometry rather than to the page.
 *
 * @param geometry the image size, the frame size and the paint scale
 * @param regions every rectangle the crop must contain; at least one
 * @param paddingCssPx breathing room around the union, in CSS pixels
 * @returns the crop in image pixels, or why none can be taken
 */
export function decideEvidenceCrop({
  geometry,
  regions,
  paddingCssPx = DEFAULT_CROP_PADDING_CSS_PX,
}: {
  geometry: CaptureGeometry;
  regions: readonly RequiredRegion[];
  paddingCssPx?: number;
}): Result<EvidenceCrop, VisualEvidenceError> {
  if (regions.length === 0) {
    return err(VisualEvidenceErrors.noRegions());
  }
  const scale = captureScale({ geometry });
  if (scale.isErr()) {
    return err(scale.error);
  }
  const problems: string[] = [];
  for (const region of regions) {
    const { height, width, x, y } = region.rect;
    if (!(width > 0) || !(height > 0) || !Number.isFinite(x) || !Number.isFinite(y)) {
      problems.push(`region '${region.name}' has no area (${String(width)}x${String(height)})`);
      continue;
    }
    if (x < 0 || y < 0 || x + width > geometry.frameWidth || y + height > geometry.frameHeight) {
      problems.push(
        `region '${region.name}' lies outside the ${String(geometry.frameWidth)}x${String(geometry.frameHeight)} frame`,
      );
    }
  }
  if (problems.length > 0) {
    return err(VisualEvidenceErrors.regionsRefused({ reasons: problems }));
  }
  const union = unionOf({ regions });
  const padded: CssRect = {
    height: union.height + paddingCssPx * 2,
    width: union.width + paddingCssPx * 2,
    x: union.x - paddingCssPx,
    y: union.y - paddingCssPx,
  };
  const left = Math.max(0, Math.floor(padded.x * scale.value));
  const top = Math.max(0, Math.floor(padded.y * scale.value));
  const right = Math.min(geometry.imageWidth, Math.ceil((padded.x + padded.width) * scale.value));
  const bottom = Math.min(geometry.imageHeight, Math.ceil((padded.y + padded.height) * scale.value));
  const rect: PixelRect = { height: bottom - top, width: right - left, x: left, y: top };
  return ok({ rect, scale: scale.value, unionCss: union });
}

/**
 * Whether `inner` lies wholly inside `outer`.
 *
 * @returns `true` when every edge of `inner` is within `outer`
 */
export function rectContains({ outer, inner }: { outer: PixelRect; inner: PixelRect }): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
  );
}

/**
 * A viewport-CSS rectangle in image pixels, rounded outward.
 *
 * @param rect the rectangle in viewport CSS pixels
 * @param scale the measured frame-to-image scale
 * @returns the rectangle in image pixels
 */
export function toImageRect({ rect, scale }: { rect: CssRect; scale: number }): PixelRect {
  const left = Math.floor(rect.x * scale);
  const top = Math.floor(rect.y * scale);
  return {
    height: Math.ceil((rect.y + rect.height) * scale) - top,
    width: Math.ceil((rect.x + rect.width) * scale) - left,
    x: left,
    y: top,
  };
}

/**
 * A rectangle re-expressed relative to a crop's own origin.
 *
 * @param rect the rectangle in whole-image pixels
 * @param crop the crop it lies inside
 * @returns the same rectangle with the crop's top-left as `(0, 0)`
 */
export function relativeTo({ rect, crop }: { rect: PixelRect; crop: PixelRect }): PixelRect {
  return { height: rect.height, width: rect.width, x: rect.x - crop.x, y: rect.y - crop.y };
}
