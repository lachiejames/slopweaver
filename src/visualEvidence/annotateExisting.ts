/**
 * Drawing boxes and their notes onto an EXISTING picture — the half of annotating that `browser shot` never needed,
 * because it frames the one chart it cropped itself.
 *
 * A first message in a channel owes a screenshot with a box drawn over what the reader should look at and its note
 * (`../outbound/slack/firstMessageProof.ts`), and a Vanta or console capture taken with `browser act`
 * or `browser read` arrives with none. `browser annotate` draws them here, reusing `./annotate.ts`'s frame painter and
 * caption band, so a frame and a caption look the same whichever verb drew them.
 *
 * Every box's interior is evidence: no pixel inside ANY box changes, so a second box's frame or a number badge never
 * paints over the first box. The band appends below, so a box's rectangle is the same in the output as in the source.
 */
import { HorizontalAlign, Jimp, loadFont, VerticalAlign } from "jimp";
import { SANS_32_WHITE } from "jimp/fonts";

import { err, ok, type Result } from "#lib/result.js";
import {
  type AnnotatedImage,
  type AnnotationOp,
  captionBelow,
  captionSafe,
  HIGHLIGHT_COLOR,
  HIGHLIGHT_OFFSET_PX,
  HIGHLIGHT_STROKE_PX,
  MAX_CAPTION_LINES,
  paintFrame,
} from "./annotate.js";
import { type VisualEvidenceError, VisualEvidenceErrors } from "./evidenceErrors.js";
import { annotationBoundsIssues } from "./schema.js";
import type { PixelRect } from "./types.js";

/** The most boxes one picture may carry — one caption line each, so {@link MAX_CAPTION_LINES}. */
export const MAX_ANNOTATIONS = MAX_CAPTION_LINES;

/** A numbered badge's side, in image pixels: room for one digit of the 32px font with padding. */
export const BADGE_SIZE_PX = 36;

/** The eight bytes every PNG opens with. */
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;

/** Where a PNG's bit depth sits: the 8-byte signature, IHDR's length and type, then width and height. */
const PNG_BIT_DEPTH_OFFSET = 24;

/**
 * Why a source cannot be drawn on without changing a pixel inside a box, or `undefined` when it can. Only an 8-bit
 * (or narrower) PNG survives Jimp's decode and re-encode exactly: any other format Jimp reads, a 16-bit TIFF say, is
 * rounded to 8 bits on the way in, so it is refused rather than checked format by format.
 *
 * @param bytes the source file, whatever it claims to be
 * @returns the reason, or `undefined` for an 8-bit PNG
 */
function sourcePrecisionProblem({ bytes }: { bytes: Uint8Array }): string | undefined {
  if (!PNG_SIGNATURE.every((byte, index) => bytes[index] === byte)) {
    return "the source is not a PNG — annotate draws only on a PNG, so export or capture it as one";
  }
  if (bytes[PNG_BIT_DEPTH_OFFSET] === 16) {
    return "the source is a 16-bit PNG, and drawing on it would round every pixel to 8 bits — export it at 8";
  }
  return undefined;
}

/** One box to draw and the note that says what it marks. */
export interface AnnotationRequest {
  readonly rect: PixelRect;
  readonly note: string;
}

/** An existing PNG with its boxes and notes drawn in, and the annotations exactly as they now read in the pixels. */
export interface AnnotatedExistingImage extends AnnotatedImage {
  readonly annotations: readonly AnnotationRequest[];
}

/** Two rectangles share at least one pixel. */
function overlaps({ a, b }: { a: PixelRect; b: PixelRect }): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

/**
 * Where box `rect`'s numbered badge goes: the first of four spots hugging the frame's outside corners that lies
 * wholly on the canvas and covers no protected rectangle, or `undefined` when none does.
 *
 * @param rect the box the badge numbers
 * @param protect every box whose interior is evidence
 * @param width the canvas width
 * @param height the canvas height
 * @returns the badge's square, or `undefined`
 */
export function badgePlacement({
  rect,
  protect,
  width,
  height,
}: {
  rect: PixelRect;
  protect: readonly PixelRect[];
  width: number;
  height: number;
}): PixelRect | undefined {
  const reach = HIGHLIGHT_OFFSET_PX + HIGHLIGHT_STROKE_PX;
  const left = rect.x - reach;
  const top = rect.y - reach;
  const right = rect.x + rect.width + reach;
  const bottom = rect.y + rect.height + reach;
  const candidates: readonly PixelRect[] = [
    { height: BADGE_SIZE_PX, width: BADGE_SIZE_PX, x: left, y: top - BADGE_SIZE_PX },
    { height: BADGE_SIZE_PX, width: BADGE_SIZE_PX, x: left - BADGE_SIZE_PX, y: top },
    { height: BADGE_SIZE_PX, width: BADGE_SIZE_PX, x: right, y: top },
    { height: BADGE_SIZE_PX, width: BADGE_SIZE_PX, x: left, y: bottom },
  ];
  return candidates.find(
    (spot) =>
      spot.x >= 0 &&
      spot.y >= 0 &&
      spot.x + spot.width <= width &&
      spot.y + spot.height <= height &&
      !protect.some((box) => overlaps({ a: spot, b: box })),
  );
}

/**
 * Every reason a set of boxes cannot be drawn before a pixel is touched: none, more than {@link MAX_ANNOTATIONS}, or
 * one running past the picture.
 *
 * @param annotations the boxes asked for
 * @param width the source width
 * @param height the source height
 * @returns each problem, empty when there is none
 */
function annotationRequestProblems({
  annotations,
  width,
  height,
}: {
  annotations: readonly AnnotationRequest[];
  width: number;
  height: number;
}): readonly string[] {
  const problems: string[] = [];
  if (annotations.length === 0) {
    problems.push("an annotated picture needs at least one box");
  }
  if (annotations.length > MAX_ANNOTATIONS) {
    problems.push(
      `a picture may carry at most ${String(MAX_ANNOTATIONS)} boxes, one caption line each, got ${String(annotations.length)}`,
    );
  }
  problems.push(...annotationBoundsIssues({ annotations, artifact: { heightPx: height, widthPx: width } }));
  return problems;
}

/**
 * Draw boxes and their notes onto an EXISTING PNG: a frame just outside each box, a numbered badge beside each when
 * there is more than one, and the notes in a caption band below — `1. note`, `2. note`, or the bare note for a single
 * box. No pixel inside any box changes, and the band only appends, so every box's rectangle is the same in the output
 * as in the source.
 *
 * The notes come back as the font printed them ({@link captionSafe}), because a record of this picture must name the
 * words a reader sees, not the ones that were asked for.
 *
 * @param bytes the source PNG
 * @param annotations one to {@link MAX_ANNOTATIONS} boxes, each with its note, in the source's pixels
 * @returns the annotated PNG, its identity and the annotations as drawn, or why it could not be drawn
 */
export async function annotateImage({
  bytes,
  annotations,
}: {
  bytes: Uint8Array;
  annotations: readonly AnnotationRequest[];
}): Promise<Result<AnnotatedExistingImage, VisualEvidenceError>> {
  const precision = sourcePrecisionProblem({ bytes });
  if (precision !== undefined) {
    return err(VisualEvidenceErrors.annotationsRefused({ reasons: [precision] }));
  }
  let image: Awaited<ReturnType<typeof Jimp.fromBuffer>>;
  try {
    image = await Jimp.fromBuffer(Buffer.from(bytes));
  } catch (error) {
    return err(VisualEvidenceErrors.sourceUndecodable({ cause: error }));
  }
  const problems = annotationRequestProblems({ annotations, height: image.height, width: image.width });
  if (problems.length > 0) {
    return err(VisualEvidenceErrors.annotationsRefused({ reasons: problems }));
  }
  const protect = annotations.map((annotation) => annotation.rect);
  for (const rect of protect) {
    paintFrame({ image, protect, rect });
  }
  if (annotations.length > 1) {
    const badged = await paintBadges({ image, protect });
    if (badged.isErr()) {
      return err(badged.error);
    }
  }
  const drawn = annotations.map((annotation) => ({
    note: captionSafe({ text: annotation.note }),
    rect: annotation.rect,
  }));
  const lines =
    drawn.length === 1
      ? [drawn[0]!.note]
      : drawn.map((annotation, index) => `${String(index + 1)}. ${annotation.note}`);
  const captioned = await captionBelow({ bytes: new Uint8Array(await image.getBuffer("image/png")), lines });
  if (captioned.isErr()) {
    return err(captioned.error);
  }
  const frames: AnnotationOp[] = protect.map((rect) => ({ kind: "highlight", rect, strokePx: HIGHLIGHT_STROKE_PX }));
  return ok({ ...captioned.value, annotations: drawn, ops: [...frames, ...captioned.value.ops] });
}

/**
 * Number each box with a red badge carrying its ordinal in white, placed by {@link badgePlacement}.
 *
 * @param image the canvas, mutated in place
 * @param protect every box, in caption order
 * @returns nothing on success, or a refusal naming each box no badge fits beside
 */
async function paintBadges({
  image,
  protect,
}: {
  image: Awaited<ReturnType<typeof Jimp.fromBuffer>>;
  protect: readonly PixelRect[];
}): Promise<Result<void, VisualEvidenceError>> {
  const spots = protect.map((rect) => badgePlacement({ height: image.height, protect, rect, width: image.width }));
  const unplaced = spots.flatMap((spot, index) =>
    spot === undefined
      ? [
          `box ${String(index + 1)} has no room for its number beside it without covering a box or leaving the ` +
            "picture — capture with more margin around it",
        ]
      : [],
  );
  if (unplaced.length > 0) {
    return err(VisualEvidenceErrors.annotationsRefused({ reasons: unplaced }));
  }
  const font = await loadFont(SANS_32_WHITE);
  spots.forEach((spot, index) => {
    const square = spot!;
    for (let y = square.y; y < square.y + square.height; y += 1) {
      for (let x = square.x; x < square.x + square.width; x += 1) {
        image.setPixelColor(HIGHLIGHT_COLOR, x, y);
      }
    }
    image.print({
      font,
      maxHeight: square.height,
      maxWidth: square.width,
      text: { alignmentX: HorizontalAlign.CENTER, alignmentY: VerticalAlign.MIDDLE, text: String(index + 1) },
      x: square.x,
      y: square.y,
    });
  });
  return ok(undefined);
}
