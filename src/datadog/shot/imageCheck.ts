/**
 * The verdict on a written capture: is this PNG something this verb will vouch for as evidence?
 *
 * ## The failure this exists to catch
 *
 * The worst failure a proof tool has is a SILENT BAD PROOF — a blank image, or a truncated write, returned
 * as success and then cited. It is worse than a crash, because a crash gets fixed and a bad proof gets
 * believed. So a capture is graded before it is reported, and a failed grade is a refusal rather than a
 * warning.
 *
 * ## Why this reads a header rather than decoding pixels
 *
 * The design this is ported from graded blankness with `sharp`, on a per-channel standard deviation. That is
 * unavailable here and would not have failed loudly: `sharp` is STUBBED repo-wide by this repository's own
 * `package.json` resolutions (`portal:./stubs/sharp`, see `stubs/sharp/index.js`), and the stub THROWS when
 * an image pipeline is actually used. A pixel-statistics check would therefore have thrown on the first real
 * capture — reproduce with `node -e "require('sharp')()"`.
 *
 * So the checks here are the ones a header genuinely settles: the file is a PNG, its IHDR decodes, and it has
 * a real area. The blankness question is answered EARLIER and better, in the page rather than in the pixels —
 * `panelScript.ts` refuses to mark a crop region unless it contains a drawn SVG chart with more than three of
 * `g.tick`/`line`/`text`, all four count labels and the time-range picker. A region that satisfies that is
 * not a blank image, and knowing WHY it is not blank beats measuring that it isn't.
 */
import { err, ok, type Result } from "../../lib/result.js";
import { type DatadogShotError, DatadogShotErrors } from "./errors.js";

/** PNG's fixed 8-byte file signature. */
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Where the IHDR chunk's width and height sit, once the signature and the chunk length/type are passed. */
const IHDR_WIDTH_OFFSET = 16;

/** The smallest header a width and a height can be read from: signature, chunk length, `IHDR`, two uint32s. */
const MIN_PNG_HEADER_BYTES = 24;

/** What a PNG's own header says it is. */
export interface PngDimensions {
  readonly widthPx: number;
  readonly heightPx: number;
}

/**
 * Read a PNG's declared dimensions out of its header.
 *
 * @param bytes the file's leading bytes — the whole file works, and the first 24 are enough
 * @returns the declared dimensions, or why this is not a readable PNG
 */
export function pngDimensions({ bytes }: { bytes: Buffer }): Result<PngDimensions, DatadogShotError> {
  if (bytes.byteLength < MIN_PNG_HEADER_BYTES) {
    return err(
      DatadogShotErrors.imageUnusable({
        detail: `the file is ${String(bytes.byteLength)} bytes, too short to carry a PNG header — the write was truncated`,
        path: "",
      }),
    );
  }
  if (!bytes.subarray(0, PNG_SIGNATURE.byteLength).equals(PNG_SIGNATURE)) {
    return err(DatadogShotErrors.imageUnusable({ detail: "the file does not start with a PNG signature", path: "" }));
  }
  if (bytes.subarray(12, 16).toString("ascii") !== "IHDR") {
    return err(
      DatadogShotErrors.imageUnusable({ detail: "the first PNG chunk is not IHDR, so no size is declared", path: "" }),
    );
  }
  return ok({
    heightPx: bytes.readUInt32BE(IHDR_WIDTH_OFFSET + 4),
    widthPx: bytes.readUInt32BE(IHDR_WIDTH_OFFSET),
  });
}

/**
 * Grade a written capture, given what its header declares and how large the file is.
 *
 * Pure, over the already-read facts rather than the file, so every branch is a unit test.
 *
 * @param dimensions what the PNG's header declares
 * @param byteLength the file's size on disk
 * @param path named in a refusal, so a reader knows which capture was thrown away
 * @returns the dimensions when the capture is usable, or the typed reason it is not
 */
export function gradeCapture({
  dimensions,
  byteLength,
  path,
}: {
  dimensions: PngDimensions;
  byteLength: number;
  path: string;
}): Result<PngDimensions, DatadogShotError> {
  if (dimensions.widthPx === 0 || dimensions.heightPx === 0) {
    return err(
      DatadogShotErrors.imageUnusable({
        detail:
          `it declares ${String(dimensions.widthPx)}x${String(dimensions.heightPx)}, so it has no area — the ` +
          "element that was clipped to was present but had collapsed to nothing",
        path,
      }),
    );
  }
  if (byteLength === 0) {
    return err(DatadogShotErrors.imageUnusable({ detail: "the file is empty", path }));
  }
  return ok(dimensions);
}
