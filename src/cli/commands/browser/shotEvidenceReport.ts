/**
 * The pure report and record builders behind `slopweaver browser shot`'s evidence profile: the evidence block
 * a report prints, the outcome a processing refusal names, and the capture record a processed capture files.
 * No fs, no clock, no network here; `./shotEvidenceRun.ts` is the effectful shell that calls them.
 */
import type { EvidenceProcessingError, ProcessedEvidence } from "../../../visualEvidence/capturePipeline.js";
import type { CaptureReceipt } from "../../../visualEvidence/captureRecord.js";
import { evidenceTargetLabel } from "../../../visualEvidence/evidenceTarget.js";
import type { EvidenceCaptureResult, TargetObservation } from "../../../visualEvidence/observation.js";
import { targetStateOf } from "../../../visualEvidence/readiness.js";
import type { ShotEvidenceReport, ShotOutcome } from "./shotCore.js";

/**
 * The evidence block before anything was observed.
 *
 * @returns the evidence block with every unobserved field empty
 */
export function emptyEvidence({ target }: { target: string }): ShotEvidenceReport {
  return {
    captureId: null,
    cropRect: null,
    elapsedMs: null,
    finalDigest: null,
    finalSize: null,
    issues: [],
    legibility: null,
    rawPath: null,
    rawSize: null,
    summary: null,
    target,
    targetState: null,
    timeRange: null,
  };
}

/**
 * The facts an observation contributes to the report.
 *
 * @returns the report fields supplied by the observation
 */
export function observedFacts({ observation }: { observation: TargetObservation }): Partial<ShotEvidenceReport> {
  return {
    summary: observation.summary === null ? null : observation.summary.text,
    targetState: targetStateOf({ observation }),
    timeRange: observation.timeRange === null ? null : observation.timeRange.text,
  };
}

/**
 * Where the whole-page capture is kept beside the final file.
 *
 * @returns the raw PNG path beside the final output
 */
export function rawPathFor({ out }: { out: string }): string {
  return out.replace(/\.png$/, ".raw.png");
}

/**
 * Which named outcome a processing refusal is.
 *
 * @returns the report outcome corresponding to the processing error
 */
export function outcomeForProcessing({ error }: { error: EvidenceProcessingError }): ShotOutcome {
  if (error.code === "TARGET_NOT_READY") {
    return "target-not-ready";
  }
  if (error.code === "NOT_PHOTOGRAPHED") {
    return "reached-not-photographed";
  }
  if (error.code === "PAGE_MOVED") {
    return "page-moved";
  }
  return "crop-refused";
}

/**
 * The version-2 capture receipt for one processed capture: the generic receipt half — the verb, the frame text, the
 * raw viewport as the source frame, the crop, the stripped final digest — and every Datadog stage under `detail`.
 *
 * @returns the complete readback-pending capture receipt
 */
export function captureRecordFor({
  processed,
  result,
  captureId,
  out,
  rawPath,
  capturedAtIso,
  url,
}: {
  processed: ProcessedEvidence;
  result: EvidenceCaptureResult;
  captureId: string;
  out: string;
  rawPath: string;
  capturedAtIso: string;
  url: string;
}): CaptureReceipt {
  return {
    captureId,
    capturedAtIso,
    cropRect: processed.crop.rect,
    detail: {
      annotations: processed.final.ops,
      crop: {
        artifact: processed.crop.artifact,
        panelInkRowFraction: processed.crop.panelInkRowFraction,
        rect: processed.crop.rect,
        regions: processed.crop.regions,
        scale: processed.crop.scale,
      },
      finalUrl: result.finalUrl,
      legibility: {
        featurePx: processed.legibility.featurePx,
        issues: processed.legibility.issues.map((issue) => issue.message),
        policyVersion: processed.legibility.policyVersion,
        profile: processed.legibility.profile,
        projectedPx: processed.legibility.projectedPx,
      },
      raw: { artifact: processed.raw.artifact, geometry: result.geometry, path: rawPath },
      readiness: {
        after: processed.after,
        elapsedMs: result.elapsedMs,
        observation: processed.observation,
        polls: result.polls,
      },
      target: processed.target,
      url,
    },
    // `processEvidenceCapture` refuses final bytes carrying any chunk that is not pixels, so `stripped` is measured.
    final: { artifact: processed.final.artifact, metadata: "stripped", path: out },
    frameText: processed.frameText,
    schemaVersion: 2,
    source: { heightPx: processed.raw.artifact.heightPx, widthPx: processed.raw.artifact.widthPx },
    status: "readback-pending",
    verb: "browser shot",
  };
}

/**
 * The evidence block for a processed capture, every measured fact filled in.
 *
 * @returns the evidence report for the processed capture
 */
export function evidenceReportFor({
  processed,
  result,
  captureId,
  rawPath,
}: {
  processed: ProcessedEvidence;
  result: EvidenceCaptureResult;
  captureId: string | null;
  rawPath: string;
}): ShotEvidenceReport {
  const { artifact } = processed.final;
  const { legibility } = processed;
  const verdict = legibility.issues.length === 0 ? " — passes" : " — FAILS";
  return {
    ...emptyEvidence({ target: evidenceTargetLabel({ target: processed.target }) }),
    ...observedFacts({ observation: processed.observation }),
    captureId,
    cropRect:
      `${String(processed.crop.rect.width)}x${String(processed.crop.rect.height)} at ${String(processed.crop.rect.x)},` +
      `${String(processed.crop.rect.y)} of the raw (scale ${processed.crop.scale.toFixed(2)})`,
    elapsedMs: result.elapsedMs,
    finalDigest: artifact.digest,
    finalSize: `${String(artifact.widthPx)}x${String(artifact.heightPx)}`,
    issues: legibility.issues.map((issue) => issue.message),
    legibility:
      legibility.projectedPx === null
        ? "unmeasured"
        : `${legibility.projectedPx.toFixed(1)}px smallest feature once fitted to ${legibility.profile}${verdict}`,
    rawPath,
    rawSize: `${String(processed.raw.artifact.widthPx)}x${String(processed.raw.artifact.heightPx)}`,
  };
}
