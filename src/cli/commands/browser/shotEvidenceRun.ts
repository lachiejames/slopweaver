/**
 * `slopweaver browser shot`'s DEFAULT profile — wait for the target, photograph, crop, frame, caption,
 * measure, record. The effectful shell; every judgement is in `src/visualEvidence/`.
 *
 * ## What lands on disk, and what each file is for
 *
 * - `--out` — the FINAL PNG: the crop, framed and captioned. The only file a session should ever attach,
 *   and only after it has looked at it and run `browser image-record` naming the `captureId`.
 * - `<out>.raw.png` — the whole-page capture, kept beside it for diagnosis. It carries no record, so no
 *   form will attach it, and that is deliberate: it is the incident's own shape.
 * - `$SLOPWEAVER_HOME/visual-evidence/captures/<captureId>.json` — every stage, with every identity.
 *
 * ## A crop that fails prominence is recorded UNFIT before this verb returns
 *
 * `src/visualEvidence/legibility.ts` judges the final bytes. When they fail, this verb writes a FAILED
 * image record for their digest — `reason: illegible`, observer named as this verb's measurement — so the
 * bytes can never be attached through any lane, hatch or not, and reports `evidence-unfit`. The verb
 * never writes a PASSED record: a pass needs a session to have looked, and no model runs here.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { relayDepsFor } from "../../../atlas/kit/walkTransport.js";
import { createEvidenceCaptureTransport } from "../../../browser/evidenceCapture.js";
import type { RecordedProfilePort } from "../../../browser/recordedProfile.js";
import {
  type EvidenceProcessingError,
  type ProcessedEvidence,
  processEvidenceCapture,
} from "../../../visualEvidence/capturePipeline.js";
import { captureIdFor, writeCaptureRecord } from "../../../visualEvidence/captureRecord.js";
import {
  EVIDENCE_TARGET_IDS,
  type EvidenceTarget,
  evidenceTargetLabel,
} from "../../../visualEvidence/evidenceTarget.js";
import type { EvidenceCaptureResult } from "../../../visualEvidence/observation.js";
import { imageRecordOf, mintReceiptId } from "../../../visualEvidence/recordForm.js";
import { appendImageRecord } from "../../../visualEvidence/store.js";
import {
  type BrowserShotOptions,
  evidenceShotTarget,
  outcomeOf,
  SHOT_LEASE_PLATFORM,
  type ShotEvidenceReport,
  type ShotMode,
  type ShotOutcome,
  type ShotReport,
} from "./shotCore.js";
import {
  captureRecordFor,
  emptyEvidence,
  evidenceReportFor,
  observedFacts,
  outcomeForProcessing,
  rawPathFor,
} from "./shotEvidenceReport.js";

/**
 * Write the FAILED image record for final bytes that fail prominence, so no lane can ever attach them —
 * and REMOVE those bytes when the record cannot be written.
 *
 * The verb never writes a PASSED record — a pass needs a session to have looked — but a failing one only
 * ever refuses, so it is safe for a measurement to write.
 *
 * **The removal is the half that makes the property hold under a failing store.** Found with
 * `$home/visual-evidence/records` at mode 0555: the append failed, the report said so,
 * and the measured-illegible PNG stayed at `--out` carrying NO record — which is the hatchable
 * missing-record arm, so a session could have opened `unread-image` and attached the very bytes this verb
 * had just judged unreadable. An image that cannot be recorded unfit must not exist: deleting it leaves
 * nothing to attach, which is the only arm that needs no store to work.
 */
function recordUnfit({
  processed,
  captureId,
  out,
  home,
}: {
  processed: ProcessedEvidence;
  captureId: string;
  out: string;
  home: string;
}): string {
  const positive = processed.observation.summary !== null && processed.observation.summary.groups > 0;
  const unfit = appendImageRecord({
    home,
    record: imageRecordOf({
      artifact: processed.final.artifact,
      form: {
        captureId,
        contextRetained: true,
        correction:
          "re-capture at a narrower viewport, or capture a target whose own labels are larger; a caption cannot enlarge the axis label",
        crop: { kind: "cropped", rect: processed.crop.rect, sourceDigest: processed.raw.artifact.digest },
        observedContent: processed.legibility.issues.map((issue) => issue.message).join("; "),
        observerSession: "slopweaver browser shot (measured prominence, no session looked)",
        path: out,
        reason: "illegible",
        targetState: positive ? "data" : "zero-results",
        verdict: "failed",
      },
      receiptId: mintReceiptId(),
    }),
  });
  if (unfit.isOk()) {
    return "recorded unfit — these bytes cannot be attached";
  }
  const removal = removeUnrecordable({ out });
  return `the unfit record could not be written (${unfit.error.message}), so ${removal}`;
}

/**
 * Destroy final bytes that could not be recorded unfit, so nothing attachable is left behind.
 *
 * Two attempts, and the second is the one that holds under a read-only output DIRECTORY.
 * Unlinking needs write permission on the directory, not on the file, so with the
 * output directory at mode 0555 and a pre-existing writable PNG at that path, the delete failed with
 * EACCES and left readable, measured-illegible bytes behind. TRUNCATING needs only the permission the
 * write already used, so it succeeds wherever the capture itself could be written — and a zero-byte file
 * fails every lane's Jimp decode, which is the same terminal answer as absence.
 *
 * The RAW capture beside them is left alone: it already carries no record and no lane admits one, so it is
 * the diagnostic it was always meant to be.
 *
 * @param out where the final PNG was written
 * @returns what happened, for the report line
 */
function removeUnrecordable({ out }: { out: string }): string {
  try {
    rmSync(out, { force: true });
    return `the image was removed from ${out} rather than left unrecorded and attachable`;
  } catch {
    // Fall through to truncation: the directory refused the unlink, but the file itself is ours to empty.
  }
  try {
    writeFileSync(out, new Uint8Array());
    return `the image at ${out} could not be deleted, so it was emptied — no decoder will read it`;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return `the image at ${out} could be neither deleted nor emptied (${reason}) — delete it by hand, it is unreadable and unrecorded`;
  }
}

/**
 * Persist the final PNG and the raw beside it, then the capture record; report what landed.
 *
 * @param processed every stage the pipeline produced
 * @param result what the browser reported, for the record's own provenance
 * @param out where the FINAL png belongs; the raw lands beside it
 * @param home the state home the capture and image records are written under
 * @param capturedAtIso when the shutter fired
 * @param url the address that was asked for
 * @returns the report to print
 *
 * @internal exported for the test that proves an unwritable capture-record directory still leaves a FAILED
 * image record behind for prominence-failing bytes — the counterexample a review found.
 */
export function fileEvidence({
  processed,
  result,
  out,
  home,
  capturedAtIso,
  url,
}: {
  processed: ProcessedEvidence;
  result: EvidenceCaptureResult;
  out: string;
  home: string;
  capturedAtIso: string;
  url: string;
}): ShotReport {
  const rawPath = rawPathFor({ out });
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(rawPath, processed.raw.bytes);
  writeFileSync(out, processed.final.bytes);
  const captureId = captureIdFor({ digest: processed.final.artifact.digest });
  // The FAILED record goes FIRST, before the capture record and before any other failure can return.
  // With `$home/visual-evidence/captures` unwritable, the capture
  // record failed, this function returned `record-failed`, and the unfit record was never written — so
  // bytes this verb had just MEASURED as illegible sat at `--out` carrying no record at all, which is the
  // hatchable missing-record arm rather than the terminal hold they had earned.
  const unfit = processed.legibility.issues.length > 0 ? recordUnfit({ captureId, home, out, processed }) : null;
  const record = writeCaptureRecord({
    home,
    record: captureRecordFor({ captureId, capturedAtIso, out, processed, rawPath, result, url }),
  });
  const described = {
    bytes: processed.final.bytes.byteLength,
    evidence: evidenceReportFor({ captureId: record.isOk() ? captureId : null, processed, rawPath, result }),
    finalUrl: result.finalUrl,
    path: out,
    statusCode: null,
    title: result.title,
    url,
  };
  if (unfit !== null) {
    const alsoFailed = record.isErr() ? `, and the capture record could not be written: ${record.error.message}` : "";
    return {
      ...described,
      because: `the final image fails the prominence policy, ${unfit}${alsoFailed}`,
      outcome: "evidence-unfit",
    };
  }
  if (record.isErr()) {
    return {
      ...described,
      because: `the capture record could not be written: ${record.error.message}`,
      outcome: "record-failed",
    };
  }
  return { ...described, because: null, outcome: "captured" };
}

/** The report for a capture the pipeline refused, with the raw kept beside `--out` when one exists. */
function refusedReport({
  error,
  result,
  screenshotPng,
  options,
  label,
}: {
  error: EvidenceProcessingError;
  result: EvidenceCaptureResult;
  screenshotPng: Uint8Array | null;
  options: BrowserShotOptions;
  label: string;
}): ShotReport {
  let rawPath: string | null = null;
  if (screenshotPng !== null) {
    rawPath = rawPathFor({ out: options.out });
    mkdirSync(dirname(options.out), { recursive: true });
    writeFileSync(rawPath, screenshotPng);
  }
  const issues = error.code === "TARGET_NOT_READY" ? error.issues.map((issue) => issue.message) : [];
  return {
    because: error.message,
    bytes: null,
    evidence: {
      ...emptyEvidence({ target: label }),
      ...observedFacts({ observation: result.before }),
      elapsedMs: result.elapsedMs,
      issues,
      rawPath,
    },
    finalUrl: result.finalUrl,
    outcome: outcomeForProcessing({ error }),
    path: null,
    statusCode: null,
    title: result.title,
    url: options.url,
  };
}

/** A report with no picture in it, for the arms that end before a capture exists. */
function nothingReport({
  options,
  because,
  evidence,
  outcome,
}: {
  options: BrowserShotOptions;
  because: string;
  evidence: ShotEvidenceReport | null;
  outcome: ShotOutcome;
}): ShotReport {
  return {
    because,
    bytes: null,
    evidence,
    finalUrl: null,
    outcome,
    path: null,
    statusCode: null,
    title: null,
    url: options.url,
  };
}

/** One evidence-shot invocation: the validated flags, the profile's own knobs, and where the pin is read from. */
interface EvidenceShotRequest {
  readonly options: BrowserShotOptions;
  readonly mode: Extract<ShotMode, { kind: "evidence" }>;
  readonly home: string;
  readonly profiles: RecordedProfilePort;
}

/** Attach, capture once, release, and process — everything between the target and the files. */
async function captureAndProcess({
  options,
  mode,
  home,
  profiles,
  target,
  directory,
}: EvidenceShotRequest & { target: EvidenceTarget; directory: string }): Promise<ShotReport> {
  const label = evidenceTargetLabel({ target });
  const evidence = emptyEvidence({ target: label });
  const origins = [new URL(options.url).origin];
  const deps = await relayDepsFor({ directory, home, origins, platform: SHOT_LEASE_PLATFORM, profiles });
  if (deps.isErr()) {
    return nothingReport({ because: deps.error.join("; "), evidence, options, outcome: "relay-unavailable" });
  }
  const transport = createEvidenceCaptureTransport({ deps: deps.value });
  const captured = await transport.capture({ readinessTimeoutMs: mode.readinessTimeoutMs, target, url: options.url });
  // Read AFTER the capture: it may first have waited up to RELAY_LEASE_WAIT_SECONDS for the relay.
  const capturedAtIso = deps.value.nowIso();
  await transport.release();
  if (captured.isErr()) {
    return nothingReport({
      because: captured.error.message,
      evidence,
      options,
      outcome: outcomeOf({ error: captured.error }),
    });
  }
  const { result, screenshotPng } = captured.value;
  const processed = await processEvidenceCapture({ capturedAtIso, lead: mode.caption, result, screenshotPng, target });
  if (processed.isErr()) {
    return refusedReport({ error: processed.error, label, options, result, screenshotPng });
  }
  return fileEvidence({ capturedAtIso, home, out: options.out, processed: processed.value, result, url: options.url });
}

/**
 * Run the evidence profile once.
 *
 * @param options the validated invocation
 * @param mode the evidence profile's own knobs
 * @param home the state home the token, the pin, the lease and the records live under
 * @param profiles the door the recorded work profile is read through, for the pin
 * @returns the report to print
 */
export async function takeEvidenceShot({ options, mode, home, profiles }: EvidenceShotRequest): Promise<ShotReport> {
  const target = evidenceShotTarget({ mode, url: options.url });
  if (target === null) {
    return nothingReport({
      because:
        `no adapter covers this address, so there is nothing to wait for or crop to. Name one with --target ` +
        `(${EVIDENCE_TARGET_IDS.join(", ")}), or take a diagnostic whole-page picture with --raw — which no form will attach`,
      evidence: null,
      options,
      outcome: "unsupported-target",
    });
  }
  const directory = mkdtempSync(join(tmpdir(), "slopweaver-shot-"));
  try {
    return await captureAndProcess({ directory, home, mode, options, profiles, target });
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
}
