/**
 * From one browser capture to one annotated crop — every stage judged, every intermediate identified.
 *
 * ## The sequence, and why each step re-decodes
 *
 * 1. Refuse a capture the snippet timed out on, then RE-JUDGE the observation it fired on with
 *    `./readiness.ts` — the in-page predicate is a cheap mirror, Node's is the one with a test.
 * 2. Refuse a page that moved between the before and after observations.
 * 3. Decode the raw PNG; check its size against the viewport at the page's own paint scale.
 * 4. Decide the crop from the target and its context regions (`./crop.ts`); scan the chart's own
 *    rectangle in the RAW pixels for blank bands (`./pixels.ts`) — a second, pixel-level witness that the
 *    panel drew something, independent of what the page's canvases reported.
 * 5. Crop, re-decode, check the crop's size is the rectangle's.
 * 6. Frame the chart, caption below, re-decode the FINAL bytes and measure prominence on them
 *    (`./legibility.ts`) — a caption band changes the fit scale, so the judgement is on what would be sent.
 * 7. Refuse final bytes carrying any chunk that is not pixels (`./pngMetadata.ts`), and crop the page's visible-text
 *    walk to the picture as its frame text (`./frameText.ts`), the caption band's lines included.
 *
 * Nothing here touches the filesystem or the browser. The bytes come in, the stages come out, and
 * `src/cli/commands/browser/shotEvidenceRun.ts` writes what it is handed.
 */
import { Jimp } from "jimp";

import { err, ok, type Result } from "#lib/result.js";
import { type AnnotatedImage, type AnnotationOp, captionBelow, cropPng, highlightRect } from "./annotate.js";
import { decideEvidenceCrop, type RequiredRegion, relativeTo, toImageRect } from "./crop.js";
import { captionLinesFor } from "./evidenceCaption.js";
import { type VisualEvidenceError, VisualEvidenceErrors, visualEvidenceErrorLines } from "./evidenceErrors.js";
import type { EvidenceTarget } from "./evidenceTarget.js";
import { capturedPageFrameText, type FrameText } from "./frameText.js";
import { identifyImageBytes } from "./imageIo.js";
import { LEGIBILITY_POLICY_V1, type LegibilityIssue, legibilityIssues, projectedFeaturePx } from "./legibility.js";
import type { EvidenceCaptureResult, TargetObservation } from "./observation.js";
import { measureRegionInk } from "./pixels.js";
import { metadataLeftIn } from "./pngMetadata.js";
import { type ReadinessIssue, readinessIssues, stabilityIssues } from "./readiness.js";
import type { ArtifactIdentity, PixelRect } from "./types.js";

/**
 * The fewest chart rows that must carry ink for the panel to count as drawn, as a fraction.
 * @internal
 */
export const MIN_PANEL_INK_ROW_FRACTION = 0.05;

/** Why a capture did not become an annotated crop. */
export type EvidenceProcessingError =
  | { readonly code: "TARGET_NOT_READY"; readonly message: string; readonly issues: readonly ReadinessIssue[] }
  | { readonly code: "NOT_PHOTOGRAPHED"; readonly message: string }
  | { readonly code: "PAGE_MOVED"; readonly message: string; readonly issues: readonly string[] }
  | { readonly code: "IMAGE_UNDECODABLE"; readonly message: string }
  | { readonly code: "CROP_REFUSED"; readonly message: string; readonly problems: readonly string[] }
  | { readonly code: "PANEL_BLANK"; readonly message: string; readonly inkRowFraction: number }
  | { readonly code: "ANNOTATION_FAILED"; readonly message: string };

/**
 * Factories for {@link EvidenceProcessingError}.
 * @internal
 */
export const EvidenceProcessingErrors = {
  annotationFailed: ({ cause }: { cause: VisualEvidenceError }): EvidenceProcessingError => ({
    code: "ANNOTATION_FAILED",
    message: `the crop could not be annotated: ${cause.message}`,
  }),
  cropRefused: ({ cause }: { cause: VisualEvidenceError }): EvidenceProcessingError => ({
    code: "CROP_REFUSED",
    message: `no crop could be taken: ${cause.message}`,
    problems: visualEvidenceErrorLines({ error: cause }),
  }),
  imageUndecodable: ({ cause }: { cause: VisualEvidenceError }): EvidenceProcessingError => ({
    code: "IMAGE_UNDECODABLE",
    message: cause.message,
  }),
  notPhotographed: ({ reason }: { reason: string | null }): EvidenceProcessingError => ({
    code: "NOT_PHOTOGRAPHED",
    message: reason ?? "the browser returned no picture and no reason",
  }),
  pageMoved: ({ issues }: { issues: readonly string[] }): EvidenceProcessingError => ({
    code: "PAGE_MOVED",
    issues,
    message: `the page changed during the capture: ${issues.join("; ")}`,
  }),
  panelBlank: ({ inkRowFraction }: { inkRowFraction: number }): EvidenceProcessingError => ({
    code: "PANEL_BLANK",
    inkRowFraction,
    message:
      `only ${(inkRowFraction * 100).toFixed(1)}% of the chart's own rows carry ink in the raw pixels; ` +
      `${String(MIN_PANEL_INK_ROW_FRACTION * 100)}% is the floor`,
  }),
  targetNotReady: ({
    issues,
    elapsedMs,
  }: {
    issues: readonly ReadinessIssue[];
    elapsedMs: number;
  }): EvidenceProcessingError => ({
    code: "TARGET_NOT_READY",
    issues,
    message: `the target was not ready after ${String(elapsedMs)}ms: ${issues.map((issue) => issue.message).join("; ")}`,
  }),
} as const;

/**
 * What prominence measured on the final bytes.
 * @internal — a field type of {@link ProcessedEvidence}.
 */
export interface LegibilityVerdict {
  readonly policyVersion: number;
  readonly profile: string;
  readonly featurePx: number | null;
  readonly projectedPx: number | null;
  readonly issues: readonly LegibilityIssue[];
}

/** Every stage of one processed capture. */
export interface ProcessedEvidence {
  readonly target: EvidenceTarget;
  readonly observation: TargetObservation;
  readonly after: TargetObservation;
  readonly raw: { readonly bytes: Uint8Array; readonly artifact: ArtifactIdentity };
  readonly crop: {
    readonly rect: PixelRect;
    readonly scale: number;
    readonly regions: readonly RequiredRegion[];
    readonly artifact: ArtifactIdentity;
    readonly panelInkRowFraction: number;
  };
  readonly final: {
    readonly bytes: Uint8Array;
    readonly artifact: ArtifactIdentity;
    readonly ops: readonly AnnotationOp[];
  };
  readonly legibility: LegibilityVerdict;
  readonly captionLines: readonly string[];
  /** The text inside the final picture: the page's visible text the crop shows, then the caption band's lines. */
  readonly frameText: FrameText;
}

/** The frame text of the final picture: the page walk cropped to it, plus the lines the caption band drew. */
function finalFrameText({
  result,
  crop,
  ops,
}: {
  result: EvidenceCaptureResult;
  crop: ProcessedEvidence["crop"];
  ops: readonly AnnotationOp[];
}): FrameText {
  const captionOp = ops.find((op): op is Extract<AnnotationOp, { kind: "caption" }> => op.kind === "caption");
  const caption =
    captionOp === undefined
      ? { bandHeightPx: 0, lines: [] }
      : { bandHeightPx: captionOp.bandHeightPx, lines: captionOp.lines };
  return capturedPageFrameText({ caption, crop: crop.rect, scale: crop.scale, walk: result.pageText });
}

/** Cut the crop and check the bytes decode to exactly the rectangle that was cut. */
async function cutCrop({
  screenshotPng,
  rect,
}: {
  screenshotPng: Uint8Array;
  rect: PixelRect;
}): Promise<Result<AnnotatedImage, EvidenceProcessingError>> {
  const cropped = await cropPng({ bytes: screenshotPng, rect });
  if (cropped.isErr()) {
    return err(EvidenceProcessingErrors.cropRefused({ cause: cropped.error }));
  }
  const sizeMatches = cropped.value.artifact.widthPx === rect.width && cropped.value.artifact.heightPx === rect.height;
  if (!sizeMatches) {
    const decoded = { height: cropped.value.artifact.heightPx, width: cropped.value.artifact.widthPx };
    return err(
      EvidenceProcessingErrors.cropRefused({ cause: VisualEvidenceErrors.cropSizeMismatch({ cut: rect, decoded }) }),
    );
  }
  return ok(cropped.value);
}

/** The second witness: the chart's own rectangle in the RAW pixels must carry ink on enough rows. */
async function panelWitness({
  screenshotPng,
  chartRect,
}: {
  screenshotPng: Uint8Array;
  chartRect: PixelRect;
}): Promise<Result<number, EvidenceProcessingError>> {
  const rawImage = await Jimp.fromBuffer(Buffer.from(screenshotPng));
  const panel = measureRegionInk({ image: rawImage, region: chartRect });
  if (panel.isErr()) {
    return err(EvidenceProcessingErrors.cropRefused({ cause: panel.error }));
  }
  if (panel.value.inkRowFraction < MIN_PANEL_INK_ROW_FRACTION) {
    return err(EvidenceProcessingErrors.panelBlank({ inkRowFraction: panel.value.inkRowFraction }));
  }
  return ok(panel.value.inkRowFraction);
}

/** The crop, decided from the observation's regions, with the raw pixels' own witness on the chart. */
async function cropStage({
  result,
  screenshotPng,
}: {
  result: EvidenceCaptureResult;
  screenshotPng: Uint8Array;
}): Promise<
  Result<
    { crop: ProcessedEvidence["crop"]; cropped: AnnotatedImage; chartRect: PixelRect; raw: ArtifactIdentity },
    EvidenceProcessingError
  >
> {
  const rawIdentity = await identifyImageBytes({ bytes: screenshotPng });
  if (rawIdentity.isErr()) {
    return err(EvidenceProcessingErrors.imageUndecodable({ cause: rawIdentity.error }));
  }
  const observation = result.before;
  // Readiness has already refused a null chart rect, summary, query or time range, so each is present.
  // The results panel's own box is not a region: its bottom padding is a quarter of a viewport of nothing.
  const regions: RequiredRegion[] = [
    { name: "chart", rect: observation.chart.rect! },
    { name: "summary", rect: observation.summary!.rect },
    { name: "query", rect: observation.query!.rect },
    { name: "time range", rect: observation.timeRange!.rect },
  ];
  const crop = decideEvidenceCrop({
    geometry: {
      devicePixelRatio: result.geometry.devicePixelRatio,
      frameHeight: observation.viewport.height,
      frameWidth: observation.viewport.width,
      imageHeight: rawIdentity.value.heightPx,
      imageWidth: rawIdentity.value.widthPx,
    },
    regions,
  });
  if (crop.isErr()) {
    return err(EvidenceProcessingErrors.cropRefused({ cause: crop.error }));
  }
  const chartRect = toImageRect({ rect: observation.chart.rect!, scale: crop.value.scale });
  const panel = await panelWitness({ chartRect, screenshotPng });
  if (panel.isErr()) {
    return err(panel.error);
  }
  const cropped = await cutCrop({ rect: crop.value.rect, screenshotPng });
  if (cropped.isErr()) {
    return err(cropped.error);
  }
  return ok({
    chartRect,
    crop: {
      artifact: cropped.value.artifact,
      panelInkRowFraction: panel.value,
      rect: crop.value.rect,
      regions,
      scale: crop.value.scale,
    },
    cropped: cropped.value,
    raw: rawIdentity.value,
  });
}

/** Frame the chart, caption below, refuse any chunk that is not pixels, and hand back the final bytes. */
async function annotateStage({
  cropped,
  chartRect,
  cropRect,
  captionLines,
}: {
  cropped: AnnotatedImage;
  chartRect: PixelRect;
  cropRect: PixelRect;
  captionLines: readonly string[];
}): Promise<Result<AnnotatedImage, EvidenceProcessingError>> {
  const framed = await highlightRect({ bytes: cropped.bytes, rect: relativeTo({ crop: cropRect, rect: chartRect }) });
  if (framed.isErr()) {
    return err(EvidenceProcessingErrors.annotationFailed({ cause: framed.error }));
  }
  const captioned = await captionBelow({ bytes: framed.value.bytes, lines: captionLines });
  if (captioned.isErr()) {
    return err(EvidenceProcessingErrors.annotationFailed({ cause: captioned.error }));
  }
  const chunks = metadataLeftIn({ bytes: captioned.value.bytes });
  if (chunks.length > 0) {
    return err(EvidenceProcessingErrors.annotationFailed({ cause: VisualEvidenceErrors.metadataSurvived({ chunks }) }));
  }
  return ok({ ...captioned.value, ops: [...framed.value.ops, ...captioned.value.ops] });
}

/**
 * Run every stage over one capture.
 *
 * @param result what the snippet reported
 * @param screenshotPng the raw full-page bytes, or `null` when there are none
 * @param target which closed target was captured
 * @param capturedAtIso when the capture was taken, for the caption
 * @param lead an optional first caption line from the caller
 * @returns every stage, or the first one that refused
 */
export async function processEvidenceCapture({
  result,
  screenshotPng,
  target,
  capturedAtIso,
  lead,
}: {
  result: EvidenceCaptureResult;
  screenshotPng: Uint8Array | null;
  target: EvidenceTarget;
  capturedAtIso: string;
  lead: string | null;
}): Promise<Result<ProcessedEvidence, EvidenceProcessingError>> {
  const issues = readinessIssues({ observation: result.before });
  if (result.readiness === "timeout" || issues.length > 0 || result.after === null) {
    return err(EvidenceProcessingErrors.targetNotReady({ elapsedMs: result.elapsedMs, issues }));
  }
  if (screenshotPng === null) {
    return err(EvidenceProcessingErrors.notPhotographed({ reason: result.screenshotError }));
  }
  const moved = stabilityIssues({ after: result.after, before: result.before });
  if (moved.length > 0) {
    return err(EvidenceProcessingErrors.pageMoved({ issues: moved }));
  }
  const staged = await cropStage({ result, screenshotPng });
  if (staged.isErr()) {
    return err(staged.error);
  }
  const observation = result.before;
  const captionLines = captionLinesFor({ capturedAtIso, finalUrl: result.finalUrl, lead, observation });
  const final = await annotateStage({
    captionLines,
    chartRect: staged.value.chartRect,
    cropRect: staged.value.crop.rect,
    cropped: staged.value.cropped,
  });
  if (final.isErr()) {
    return err(final.error);
  }
  const featurePx = observation.smallestFontPx === null ? null : observation.smallestFontPx * staged.value.crop.scale;
  const measurements = { featurePx, heightPx: final.value.artifact.heightPx, widthPx: final.value.artifact.widthPx };
  return ok({
    after: result.after,
    captionLines,
    crop: staged.value.crop,
    final: { artifact: final.value.artifact, bytes: final.value.bytes, ops: final.value.ops },
    frameText: finalFrameText({ crop: staged.value.crop, ops: final.value.ops, result }),
    legibility: {
      featurePx,
      issues: legibilityIssues({ measurements, policy: LEGIBILITY_POLICY_V1 }),
      policyVersion: LEGIBILITY_POLICY_V1.version,
      profile: LEGIBILITY_POLICY_V1.profile.name,
      projectedPx: projectedFeaturePx({ measurements, profile: LEGIBILITY_POLICY_V1.profile }),
    },
    observation,
    raw: { artifact: staged.value.raw, bytes: screenshotPng },
    target,
  });
}
