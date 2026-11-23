/**
 * Redaction that holds: opaque solid rectangles burned INTO the pixels, written as a new file with its metadata
 * stripped, and a child capture receipt pointing at the parent it was cut from.
 *
 * ## Never a blur, never an overlay
 *
 * A blur keeps a function of the hidden pixels, and text blurred at screenshot sizes has been recovered by
 * re-blurring candidate strings until one matches. A translucent box keeps them outright. A vector or HTML overlay
 * is not in the bytes at all, so whatever renders the file without it shows everything. So the only redaction this
 * module performs sets every pixel inside each rectangle to one fully opaque colour, then re-decodes its own output
 * and checks each of those pixels IS that colour — a rectangle that came back partly transparent or partly original
 * is refused rather than reported done.
 *
 * ## A new file, never an edit in place
 *
 * The parent's bytes and receipt stay exactly as they were, so what was captured remains checkable and the child's
 * receipt can name it. The child is its own artifact: its own digest, its own capture id, its own image record
 * written after a session has looked at it. Its frame text is the parent's minus every item a burned rectangle wholly
 * covers (`./frameText.ts`), and its crop is the parent's, because burning pixels crops nothing.
 *
 * Pixels only; `../cli/commands/browser/redactRun.ts` reads, writes and records.
 */
import { Jimp } from "jimp";

import { err, ok, type Result } from "#lib/result.js";
import type { CaptureReceipt } from "./captureRecord.js";
import { captureIdFor } from "./captureRecord.js";
import { type VisualEvidenceError, VisualEvidenceErrors } from "./evidenceErrors.js";
import { frameTextWithout } from "./frameText.js";
import { identifyImageBytes } from "./imageIo.js";
import { metadataLeftIn } from "./pngMetadata.js";
import type { ArtifactIdentity, PixelRect } from "./types.js";

/** The one colour redaction paints, packed `0xRRGGBBAA`: black, fully opaque. */
export const REDACTION_FILL = 0x000000ff;

/** The most rectangles one redaction may burn — enough for any real frame, few enough to read back in the receipt. */
export const MAX_REDACTION_RECTS = 32;

/** The redacted picture: its bytes and the identity they decode to. */
export interface RedactedImage {
  readonly bytes: Uint8Array;
  readonly artifact: ArtifactIdentity;
}

/**
 * Why a set of rectangles cannot be burned into an image of this size, one reason per problem.
 *
 * @param rects the rectangles asked for
 * @param width the image's width in pixels
 * @param height the image's height in pixels
 * @returns the reasons, empty when every rectangle is burnable
 */
export function redactionRectProblems({
  rects,
  width,
  height,
}: {
  rects: readonly PixelRect[];
  width: number;
  height: number;
}): readonly string[] {
  const problems: string[] = [];
  if (rects.length === 0) {
    problems.push("a redaction needs at least one rectangle");
  }
  if (rects.length > MAX_REDACTION_RECTS) {
    problems.push(`a redaction burns at most ${String(MAX_REDACTION_RECTS)} rectangles, got ${String(rects.length)}`);
  }
  rects.forEach((rect, index) => {
    const inside =
      Number.isInteger(rect.x) &&
      Number.isInteger(rect.y) &&
      Number.isInteger(rect.width) &&
      Number.isInteger(rect.height) &&
      rect.x >= 0 &&
      rect.y >= 0 &&
      rect.width > 0 &&
      rect.height > 0 &&
      rect.x + rect.width <= width &&
      rect.y + rect.height <= height;
    if (!inside) {
      problems.push(
        `rectangle ${String(index + 1)} (${String(rect.x)},${String(rect.y)} ${String(rect.width)}x${String(rect.height)}) ` +
          `does not lie inside the ${String(width)}x${String(height)} image`,
      );
    }
  });
  return problems;
}

/** Visit every pixel one rectangle covers, row by row, without materialising the list. */
function eachPixel({ rect, visit }: { rect: PixelRect; visit: (pixel: { x: number; y: number }) => void }): void {
  for (let y = rect.y; y < rect.y + rect.height; y += 1) {
    for (let x = rect.x; x < rect.x + rect.width; x += 1) {
      visit({ x, y });
    }
  }
}

/**
 * Burn opaque solid rectangles into an image and hand back a NEW metadata-free PNG.
 *
 * @param bytes the parent picture
 * @param rects the rectangles to paint solid, in the parent's pixels
 * @returns the redacted PNG and its identity, or why it could not be produced
 */
export async function burnRedactions({
  bytes,
  rects,
}: {
  bytes: Uint8Array;
  rects: readonly PixelRect[];
}): Promise<Result<RedactedImage, VisualEvidenceError>> {
  let image: Awaited<ReturnType<typeof Jimp.fromBuffer>>;
  try {
    image = await Jimp.fromBuffer(Buffer.from(bytes));
  } catch (error) {
    return err(VisualEvidenceErrors.sourceUndecodable({ cause: error }));
  }
  const problems = redactionRectProblems({ height: image.height, rects, width: image.width });
  if (problems.length > 0) {
    return err(VisualEvidenceErrors.redactionRefused({ reasons: problems }));
  }
  for (const rect of rects) {
    eachPixel({ rect, visit: ({ x, y }) => image.setPixelColor(REDACTION_FILL, x, y) });
  }
  const encoded = new Uint8Array(await image.getBuffer("image/png"));
  const left = metadataLeftIn({ bytes: encoded });
  if (left.length > 0) {
    return err(VisualEvidenceErrors.metadataSurvived({ chunks: left }));
  }
  const unburned = await unburnedRects({ bytes: encoded, rects });
  if (unburned.length > 0) {
    return err(VisualEvidenceErrors.redactionRefused({ reasons: unburned }));
  }
  const identity = await identifyImageBytes({ bytes: encoded });
  if (identity.isErr()) {
    return err(identity.error);
  }
  return ok({ artifact: identity.value, bytes: encoded });
}

/**
 * Re-decode the written bytes and name every rectangle with a pixel that is not the opaque fill.
 *
 * @param bytes the encoded redacted PNG
 * @param rects the rectangles that should now be solid
 * @returns one reason per rectangle that is not, empty when every pixel of every rectangle is the fill
 */
async function unburnedRects({
  bytes,
  rects,
}: {
  bytes: Uint8Array;
  rects: readonly PixelRect[];
}): Promise<readonly string[]> {
  const decoded = await Jimp.fromBuffer(Buffer.from(bytes));
  return rects.flatMap((rect, index) => {
    for (let y = rect.y; y < rect.y + rect.height; y += 1) {
      for (let x = rect.x; x < rect.x + rect.width; x += 1) {
        if (decoded.getPixelColor(x, y) !== REDACTION_FILL) {
          return [
            `rectangle ${String(index + 1)} read back with a pixel at ${String(x)},${String(y)} that is not solid`,
          ];
        }
      }
    }
    return [];
  });
}

/**
 * The child capture receipt for one redaction: the parent's frame and crop, the parent's frame text minus every item
 * a burned rectangle wholly covers, and the new bytes' identity.
 *
 * @param parent the receipt of the picture that was redacted
 * @param redacted the new bytes' identity
 * @param burned the rectangles burned solid
 * @param out where the new PNG was written
 * @param capturedAtIso when the redaction was made
 * @returns the child receipt
 */
export function redactionReceiptOf({
  parent,
  redacted,
  burned,
  out,
  capturedAtIso,
}: {
  parent: CaptureReceipt;
  redacted: ArtifactIdentity;
  burned: readonly PixelRect[];
  out: string;
  capturedAtIso: string;
}): CaptureReceipt {
  return {
    captureId: captureIdFor({ digest: redacted.digest }),
    capturedAtIso,
    cropRect: parent.cropRect,
    detail: { burned, parentCaptureId: parent.captureId, parentDigest: parent.final.artifact.digest },
    final: { artifact: redacted, metadata: "stripped", path: out },
    frameText: frameTextWithout({ burned, frameText: parent.frameText }),
    schemaVersion: 2,
    source: parent.source,
    status: "readback-pending",
    verb: "browser redact",
  };
}
