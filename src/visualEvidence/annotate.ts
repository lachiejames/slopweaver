/**
 * Cropping and annotating, in Jimp, with every stroke outside the evidence.
 *
 * ## Two operations, and why neither paints over the picture
 *
 * A **highlight** is a 4px frame drawn OUTSIDE the chart's rectangle, offset by its own width, so the
 * outline never covers an axis label or a bar. A **caption** is a white band appended BELOW the crop,
 * carrying what a reader needs to check the claim against — the summary, the time range, the query, when
 * it was taken — in text large enough to survive a preview. The caption is
 * context, and it does not enlarge the axis label the evidence rests on; `./legibility.ts` judges that
 * label on its own and this module's `measure` is what it judges after the band is added.
 *
 * Drawing several boxes onto a picture something else captured is `./annotateExisting.ts`, built on this
 * module's frame painter and caption band.
 *
 * ## Why Jimp and why bytes cross this boundary
 *
 * `src/proof/yarnWhy/compose.ts` carries the reason: `sharp` resolves to a throwing stub on this tree and
 * Jimp's instance types do not survive a module boundary under `exactOptionalPropertyTypes`. So every
 * function here takes and returns PNG bytes, decodes inside, and re-decodes its own output before
 * reporting a size — the size a caller records is the size of the bytes it holds, never of an object.
 */
import { Jimp, type JimpInstance, loadFont, measureTextHeight } from "jimp";
import { SANS_32_BLACK, SANS_64_BLACK } from "jimp/fonts";

import { err, ok, type Result } from "#lib/result.js";
import { type VisualEvidenceError, VisualEvidenceErrors } from "./evidenceErrors.js";
import { identifyImageBytes } from "./imageIo.js";
import type { ArtifactIdentity, PixelRect } from "./types.js";

/** The frame's stroke, in image pixels. */
export const HIGHLIGHT_STROKE_PX = 4;

/** The frame's gap from the rectangle it marks, so the stroke lies outside the evidence. */
export const HIGHLIGHT_OFFSET_PX = 4;

/** Datadog-alert red, packed `0xRRGGBBAA` — the same colour `src/datadog/shot/panelScript.ts` outlines with. */
export const HIGHLIGHT_COLOR = 0xd63031ff;

/**
 * The caption band's padding, in image pixels.
 * @internal
 */
export const CAPTION_PADDING_PX = 24;

/**
 * Space between caption lines.
 * @internal
 */
export const CAPTION_LINE_GAP_PX = 12;

/** The most caption lines a caller may add; the band is context, not a second answer. */
export const MAX_CAPTION_LINES = 4;

/** The most characters one caption line may carry before it is refused rather than wrapped. */
export const MAX_CAPTION_LINE_CHARS = 240;

/** White, packed. */
const CAPTION_BACKGROUND = 0xffffffff;

/**
 * What the bundled bitmap font can draw. MEASURED on the first live caption: the en dash in
 * Datadog's time range (`<month> <day> – <month> <day>`) and the word joiner (U+2060) the query editor puts after every
 * token both printed as `?`. So dashes become `-`, format characters are dropped, and any other glyph
 * outside printable ASCII and Latin-1 is `?` on purpose rather than by accident.
 *
 * @param text one caption line as composed
 * @returns the line as the font can print it
 */
export function captionSafe({ text }: { text: string }): string {
  return text
    .replace(/[\u2013\u2014\u2212]/gu, "-")
    .replace(/[\u2018\u2019]/gu, "'")
    .replace(/[\u201c\u201d]/gu, '"')
    .replace(/\p{Cf}/gu, "")
    .replace(/[^\x20-\x7e\u00a0-\u00ff·]/gu, "?");
}

/** One annotation applied, recorded so the capture record can say what was drawn. */
export type AnnotationOp =
  | { readonly kind: "highlight"; readonly rect: PixelRect; readonly strokePx: number }
  | { readonly kind: "caption"; readonly lines: readonly string[]; readonly bandHeightPx: number };

/** Bytes plus their measured identity. */
export interface AnnotatedImage {
  readonly bytes: Uint8Array;
  readonly artifact: ArtifactIdentity;
  readonly ops: readonly AnnotationOp[];
}

/**
 * Cut one rectangle out of a PNG.
 *
 * @param bytes the source PNG
 * @param rect the rectangle to keep, in the source's pixels; must lie inside it
 * @returns the cropped PNG and its identity, or why the crop could not be taken
 */
export async function cropPng({
  bytes,
  rect,
}: {
  bytes: Uint8Array;
  rect: PixelRect;
}): Promise<Result<AnnotatedImage, VisualEvidenceError>> {
  let image: Awaited<ReturnType<typeof Jimp.fromBuffer>>;
  try {
    image = await Jimp.fromBuffer(Buffer.from(bytes));
  } catch (error) {
    return err(VisualEvidenceErrors.sourceUndecodable({ cause: error }));
  }
  if (
    rect.x < 0 ||
    rect.y < 0 ||
    rect.width <= 0 ||
    rect.height <= 0 ||
    rect.x + rect.width > image.width ||
    rect.y + rect.height > image.height
  ) {
    return err(VisualEvidenceErrors.cropOutsideSource({ height: image.height, rect, width: image.width }));
  }
  const cropped = image.clone().crop({ h: rect.height, w: rect.width, x: rect.x, y: rect.y });
  return finish({ image: cropped, ops: [] });
}

/**
 * Draw a frame just outside a rectangle, clamped to the image, without touching a pixel inside it.
 *
 * @param bytes the PNG to draw on
 * @param rect the rectangle to mark, in the image's own pixels
 * @returns the annotated PNG and its identity
 */
export async function highlightRect({
  bytes,
  rect,
}: {
  bytes: Uint8Array;
  rect: PixelRect;
}): Promise<Result<AnnotatedImage, VisualEvidenceError>> {
  let image: Awaited<ReturnType<typeof Jimp.fromBuffer>>;
  try {
    image = await Jimp.fromBuffer(Buffer.from(bytes));
  } catch (error) {
    return err(VisualEvidenceErrors.imageUndecodable({ cause: error }));
  }
  paintFrame({ image, protect: [rect], rect });
  return finish({ image, ops: [{ kind: "highlight", rect, strokePx: HIGHLIGHT_STROKE_PX }] });
}

/**
 * The one Jimp pixel method the frame painter needs, named structurally for the same reason as {@link PngEncodable}.
 * Its signature is Jimp's own, inherited rather than restated, since the parameter list was Jimp's to choose.
 */
interface PixelCanvas {
  readonly width: number;
  readonly height: number;
  readonly setPixelColor: JimpInstance["setPixelColor"];
}

/**
 * Whether a pixel lies inside any of the rectangles that must not be painted.
 *
 * @param protect the rectangles whose interiors are evidence
 * @returns whether painting this pixel would cover evidence
 */
function insideAny({ x, y, protect }: { x: number; y: number; protect: readonly PixelRect[] }): boolean {
  return protect.some((rect) => x >= rect.x && x < rect.x + rect.width && y >= rect.y && y < rect.y + rect.height);
}

/**
 * Paint one frame just outside `rect`, clamped to the canvas, skipping every pixel inside `rect`'s own gap and
 * inside ANY protected rectangle — so a second box's frame never paints over the first box's evidence.
 *
 * @param image the canvas, mutated in place
 * @param rect the rectangle this frame marks
 * @param protect every rectangle whose interior stays untouched, `rect` included
 */
export function paintFrame({
  image,
  rect,
  protect,
}: {
  image: PixelCanvas;
  rect: PixelRect;
  protect: readonly PixelRect[];
}): void {
  const outer = {
    bottom: Math.min(image.height, rect.y + rect.height + HIGHLIGHT_OFFSET_PX + HIGHLIGHT_STROKE_PX),
    left: Math.max(0, rect.x - HIGHLIGHT_OFFSET_PX - HIGHLIGHT_STROKE_PX),
    right: Math.min(image.width, rect.x + rect.width + HIGHLIGHT_OFFSET_PX + HIGHLIGHT_STROKE_PX),
    top: Math.max(0, rect.y - HIGHLIGHT_OFFSET_PX - HIGHLIGHT_STROKE_PX),
  };
  const inner = {
    bottom: rect.y + rect.height + HIGHLIGHT_OFFSET_PX,
    left: rect.x - HIGHLIGHT_OFFSET_PX,
    right: rect.x + rect.width + HIGHLIGHT_OFFSET_PX,
    top: rect.y - HIGHLIGHT_OFFSET_PX,
  };
  for (let y = outer.top; y < outer.bottom; y += 1) {
    for (let x = outer.left; x < outer.right; x += 1) {
      const insideInner = x >= inner.left && x < inner.right && y >= inner.top && y < inner.bottom;
      if (!insideInner && !insideAny({ protect, x, y })) {
        image.setPixelColor(HIGHLIGHT_COLOR, x, y);
      }
    }
  }
}

/**
 * Append a white caption band below the image. The first line is set large, the rest at half size.
 *
 * @param bytes the PNG to extend
 * @param lines the caption, at most {@link MAX_CAPTION_LINES} lines of at most {@link MAX_CAPTION_LINE_CHARS}
 * @returns the extended PNG and its identity, or why the caption was refused
 */
export async function captionBelow({
  bytes,
  lines,
}: {
  bytes: Uint8Array;
  lines: readonly string[];
}): Promise<Result<AnnotatedImage, VisualEvidenceError>> {
  const problems: string[] = [];
  if (lines.length === 0) {
    problems.push("a caption needs at least one line");
  }
  if (lines.length > MAX_CAPTION_LINES) {
    problems.push(`a caption may carry at most ${String(MAX_CAPTION_LINES)} lines, got ${String(lines.length)}`);
  }
  for (const line of lines) {
    if (line.trim() === "") {
      problems.push("a caption line cannot be blank");
    }
    if (line.length > MAX_CAPTION_LINE_CHARS) {
      problems.push(
        `a caption line may carry at most ${String(MAX_CAPTION_LINE_CHARS)} characters, got ${String(line.length)}`,
      );
    }
  }
  if (problems.length > 0) {
    return err(VisualEvidenceErrors.captionRefused({ reasons: problems }));
  }
  let image: Awaited<ReturnType<typeof Jimp.fromBuffer>>;
  try {
    image = await Jimp.fromBuffer(Buffer.from(bytes));
  } catch (error) {
    return err(VisualEvidenceErrors.imageUndecodable({ cause: error }));
  }
  const title = await loadFont(SANS_64_BLACK);
  const detail = await loadFont(SANS_32_BLACK);
  const maxWidth = image.width - CAPTION_PADDING_PX * 2;
  const printable = lines.map((line) => captionSafe({ text: line }));
  const heights = printable.map((line, index) => measureTextHeight(index === 0 ? title : detail, line, maxWidth));
  const bandHeight =
    CAPTION_PADDING_PX * 2 + heights.reduce((sum, h) => sum + h, 0) + CAPTION_LINE_GAP_PX * (lines.length - 1);
  const canvas = new Jimp({ color: CAPTION_BACKGROUND, height: image.height + bandHeight, width: image.width });
  // A raw copy, never `composite`: blending onto the white band would change a translucent pixel inside a box.
  // The widths match, so the picture is the canvas's first rows byte for byte.
  image.bitmap.data.copy(canvas.bitmap.data, 0);
  let y = image.height + CAPTION_PADDING_PX;
  printable.forEach((line, index) => {
    canvas.print({ font: index === 0 ? title : detail, maxWidth, text: line, x: CAPTION_PADDING_PX, y });
    y += heights[index]! + CAPTION_LINE_GAP_PX;
  });
  return finish({ image: canvas, ops: [{ bandHeightPx: bandHeight, kind: "caption", lines: printable }] });
}

/**
 * The one Jimp method the finisher needs, named as a structural type so a `.clone()`, a `.crop()` and a
 * `new Jimp()` result — three unrelated mixin types under `exactOptionalPropertyTypes` — all satisfy it.
 */
interface PngEncodable {
  getBuffer(mime: "image/png"): Promise<Buffer>;
}

/** Encode, then re-decode the bytes just produced so the identity reported is of those bytes. */
async function finish({
  image,
  ops,
}: {
  image: PngEncodable;
  ops: readonly AnnotationOp[];
}): Promise<Result<AnnotatedImage, VisualEvidenceError>> {
  const encoded = new Uint8Array(await image.getBuffer("image/png"));
  const identity = await identifyImageBytes({ bytes: encoded });
  if (identity.isErr()) {
    return err(identity.error);
  }
  return ok({ artifact: identity.value, bytes: encoded, ops });
}
