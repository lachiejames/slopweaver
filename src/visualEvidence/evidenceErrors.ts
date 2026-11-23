/**
 * The typed failures of turning a capture into evidence — decoding bytes, scaling a capture, deciding and
 * cutting a crop, measuring a region's ink, captioning, drawing boxes onto a picture, and reading a `--target`.
 *
 * A union of its own per `.claude/rules/error-handling.md`, beside `./errors.ts` rather than inside it: that
 * file is IMAGE ADMISSION, whose variants decide between a hatchable refusal and a `hold`, and nothing here
 * is policy — every variant is a fact about pixels or a flag. Three variants carry a list, and
 * {@link visualEvidenceErrorLines} gives each entry back as its own line, exactly as the string list it
 * replaced did.
 */

/** Bytes, a crop source or an image could not be decoded at all. */
export interface VisualEvidenceUndecodableError {
  readonly code: "UNDECODABLE";
  readonly message: string;
  readonly reason: string;
}

/** The decoder reported an image with no area. */
export interface VisualEvidenceEmptyImageError {
  readonly code: "EMPTY_IMAGE";
  readonly message: string;
  readonly width: number;
  readonly height: number;
}

/** The capture's geometry cannot be mapped to its pixels: a dimension, the pixel ratio, or too few pixels. */
export interface VisualEvidenceUnscalableCaptureError {
  readonly code: "UNSCALABLE_CAPTURE";
  readonly message: string;
}

/** A rectangle does not lie inside the image it was meant to be cut from or measured in. */
export interface VisualEvidenceRectOutOfBoundsError {
  readonly code: "RECT_OUT_OF_BOUNDS";
  readonly message: string;
}

/** A crop decoded to a size other than the rectangle that was cut. */
export interface VisualEvidenceCropSizeMismatchError {
  readonly code: "CROP_SIZE_MISMATCH";
  readonly message: string;
}

/** A region cannot be measured: too small, or its corners disagree on a background. */
export interface VisualEvidenceRegionUnmeasurableError {
  readonly code: "REGION_UNMEASURABLE";
  readonly message: string;
}

/** A crop was asked for with no required region at all. */
export interface VisualEvidenceNoRegionsError {
  readonly code: "NO_REGIONS";
  readonly message: string;
}

/** One or more required regions are degenerate or off the frame; `reasons` names each, one per line. */
export interface VisualEvidenceRegionsRefusedError {
  readonly code: "REGIONS_REFUSED";
  readonly message: string;
  readonly reasons: readonly string[];
}

/** The caption breaks one or more of its bounds; `reasons` names each, one per line. */
export interface VisualEvidenceCaptionRefusedError {
  readonly code: "CAPTION_REFUSED";
  readonly message: string;
  readonly reasons: readonly string[];
}

/** The boxes asked to be drawn cannot be: none, too many, off the picture, or no room for a number; one per line. */
export interface VisualEvidenceAnnotationsRefusedError {
  readonly code: "ANNOTATIONS_REFUSED";
  readonly message: string;
  readonly reasons: readonly string[];
}

/** `--target` named something outside the closed set this build knows. */
export interface VisualEvidenceUnknownTargetError {
  readonly code: "UNKNOWN_TARGET";
  readonly message: string;
  readonly got: string;
}

/** A re-encode meant to carry pixels only still carried a chunk that is not pixels. */
export interface VisualEvidenceMetadataSurvivedError {
  readonly code: "METADATA_SURVIVED";
  readonly message: string;
  readonly chunks: readonly string[];
}

/** The rectangles asked to be burned out cannot be: none, or one off the picture; one per line. */
export interface VisualEvidenceRedactionRefusedError {
  readonly code: "REDACTION_REFUSED";
  readonly message: string;
  readonly reasons: readonly string[];
}

/** The terminal text asked to be rendered cannot be: no lines, a range off the text, or past a bound; one per line. */
export interface VisualEvidenceTerminalTextRefusedError {
  readonly code: "TERMINAL_TEXT_REFUSED";
  readonly message: string;
  readonly reasons: readonly string[];
}

/** Every failure the evidence pipeline's pure stages author. */
export type VisualEvidenceError =
  | VisualEvidenceUndecodableError
  | VisualEvidenceEmptyImageError
  | VisualEvidenceUnscalableCaptureError
  | VisualEvidenceRectOutOfBoundsError
  | VisualEvidenceCropSizeMismatchError
  | VisualEvidenceRegionUnmeasurableError
  | VisualEvidenceNoRegionsError
  | VisualEvidenceRegionsRefusedError
  | VisualEvidenceCaptionRefusedError
  | VisualEvidenceAnnotationsRefusedError
  | VisualEvidenceUnknownTargetError
  | VisualEvidenceMetadataSurvivedError
  | VisualEvidenceRedactionRefusedError
  | VisualEvidenceTerminalTextRefusedError;

/**
 * What a thrown decode failure says, for a message that names it.
 *
 * @param cause what the decoder threw
 * @returns its message, or its string form when it is not an Error
 */
function decodeReason({ cause }: { cause: unknown }): string {
  if (cause instanceof Error) {
    return cause.message;
  }
  return String(cause);
}

/**
 * `left,top WxH` — how every out-of-bounds refusal here names a rectangle.
 *
 * @returns the rectangle as the refusal prints it
 */
function rectText({ x, y, width, height }: { x: number; y: number; width: number; height: number }): string {
  return `${String(x)},${String(y)} ${String(width)}x${String(height)}`;
}

/** How to raise one — the factory the real code calls, so a test built the same way catches a drift. */
export const VisualEvidenceErrors = {
  annotationsRefused: ({ reasons }: { reasons: readonly string[] }): VisualEvidenceAnnotationsRefusedError => ({
    code: "ANNOTATIONS_REFUSED",
    message: reasons.join("; "),
    reasons,
  }),
  backgroundAmbiguous: (): VisualEvidenceRegionUnmeasurableError => ({
    code: "REGION_UNMEASURABLE",
    message: "the region's four corners do not agree on a background colour, so blankness cannot be judged",
  }),
  bytesUndecodable: ({ byteLength, cause }: { byteLength: number; cause: unknown }): VisualEvidenceUndecodableError => {
    const reason = decodeReason({ cause });
    return {
      code: "UNDECODABLE",
      message: `these ${String(byteLength)} bytes could not be decoded as an image: ${reason}`,
      reason,
    };
  },
  captionRefused: ({ reasons }: { reasons: readonly string[] }): VisualEvidenceCaptionRefusedError => ({
    code: "CAPTION_REFUSED",
    message: reasons.join("; "),
    reasons,
  }),
  cropOutsideSource: ({
    rect,
    width,
    height,
  }: {
    rect: { x: number; y: number; width: number; height: number };
    width: number;
    height: number;
  }): VisualEvidenceRectOutOfBoundsError => ({
    code: "RECT_OUT_OF_BOUNDS",
    message: `the crop ${rectText(rect)} does not lie inside the ${String(width)}x${String(height)} source`,
  }),
  cropSizeMismatch: ({
    decoded,
    cut,
  }: {
    decoded: { width: number; height: number };
    cut: { width: number; height: number };
  }): VisualEvidenceCropSizeMismatchError => ({
    code: "CROP_SIZE_MISMATCH",
    message:
      `the crop decoded as ${String(decoded.width)}x${String(decoded.height)}, not the ` +
      `${String(cut.width)}x${String(cut.height)} that was cut`,
  }),
  emptyImage: ({ width, height }: { width: number; height: number }): VisualEvidenceEmptyImageError => ({
    code: "EMPTY_IMAGE",
    height,
    message: `the decoder reported a ${String(width)}x${String(height)} image, which nothing can render`,
    width,
  }),
  geometryNotPositive: (): VisualEvidenceUnscalableCaptureError => ({
    code: "UNSCALABLE_CAPTURE",
    message: "the capture's geometry has a non-positive dimension, so no scale can be measured",
  }),
  imageUndecodable: ({ cause }: { cause: unknown }): VisualEvidenceUndecodableError => {
    const reason = decodeReason({ cause });
    return { code: "UNDECODABLE", message: `the image could not be decoded: ${reason}`, reason };
  },
  metadataSurvived: ({ chunks }: { chunks: readonly string[] }): VisualEvidenceMetadataSurvivedError => ({
    chunks,
    code: "METADATA_SURVIVED",
    message: `the re-encoded PNG still carries ${chunks.join(", ")}, which is not pixels — nothing was written`,
  }),
  redactionRefused: ({ reasons }: { reasons: readonly string[] }): VisualEvidenceRedactionRefusedError => ({
    code: "REDACTION_REFUSED",
    message: reasons.join("; "),
    reasons,
  }),
  terminalTextRefused: ({ reasons }: { reasons: readonly string[] }): VisualEvidenceTerminalTextRefusedError => ({
    code: "TERMINAL_TEXT_REFUSED",
    message: reasons.join("; "),
    reasons,
  }),
  noRegions: (): VisualEvidenceNoRegionsError => ({
    code: "NO_REGIONS",
    message: "a crop needs at least one required region",
  }),
  pixelRatioNotAScale: ({ devicePixelRatio }: { devicePixelRatio: number }): VisualEvidenceUnscalableCaptureError => ({
    code: "UNSCALABLE_CAPTURE",
    message: `the page reported a devicePixelRatio of ${String(devicePixelRatio)}, which is not a paint scale`,
  }),
  regionOutsideImage: ({
    region,
    width,
    height,
  }: {
    region: { x: number; y: number; width: number; height: number };
    width: number;
    height: number;
  }): VisualEvidenceRectOutOfBoundsError => ({
    code: "RECT_OUT_OF_BOUNDS",
    message: `the region ${rectText(region)} lies outside the ${String(width)}x${String(height)} image`,
  }),
  regionTooSmall: ({ width, height }: { width: number; height: number }): VisualEvidenceRegionUnmeasurableError => ({
    code: "REGION_UNMEASURABLE",
    message: `a ${String(width)}x${String(height)} region is too small to measure`,
  }),
  regionsRefused: ({ reasons }: { reasons: readonly string[] }): VisualEvidenceRegionsRefusedError => ({
    code: "REGIONS_REFUSED",
    message: reasons.join("; "),
    reasons,
  }),
  sourceUndecodable: ({ cause }: { cause: unknown }): VisualEvidenceUndecodableError => {
    const reason = decodeReason({ cause });
    return { code: "UNDECODABLE", message: `the source could not be decoded: ${reason}`, reason };
  },
  tooFewPixels: ({
    frameWidth,
    frameHeight,
    devicePixelRatio,
    painted,
    imageWidth,
    imageHeight,
  }: {
    frameWidth: number;
    frameHeight: number;
    devicePixelRatio: number;
    painted: { width: number; height: number };
    imageWidth: number;
    imageHeight: number;
  }): VisualEvidenceUnscalableCaptureError => ({
    code: "UNSCALABLE_CAPTURE",
    message:
      `a ${String(frameWidth)}x${String(frameHeight)} frame painted at ${String(devicePixelRatio)} needs at least ` +
      `${String(painted.width)}x${String(painted.height)} image pixels; the capture is ${String(imageWidth)}x${String(imageHeight)}`,
  }),
  unknownTarget: ({ got, known }: { got: string; known: readonly string[] }): VisualEvidenceUnknownTargetError => ({
    code: "UNKNOWN_TARGET",
    got,
    message: `--target '${got}' is not a target this build knows; the closed set is ${known.join(", ")}`,
  }),
} as const;

/**
 * The lines a {@link VisualEvidenceError} prints, one per problem. A list-carrying variant gives each entry its own
 * line, as the `readonly string[]` it replaced did, rather than the joined `message` a single-line display reads.
 *
 * @returns one line per problem, in the order they were found
 */
export function visualEvidenceErrorLines({ error }: { error: VisualEvidenceError }): readonly string[] {
  if (
    error.code === "REGIONS_REFUSED" ||
    error.code === "CAPTION_REFUSED" ||
    error.code === "ANNOTATIONS_REFUSED" ||
    error.code === "REDACTION_REFUSED" ||
    error.code === "TERMINAL_TEXT_REFUSED"
  ) {
    return error.reasons;
  }
  return [error.message];
}
