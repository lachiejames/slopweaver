/**
 * `slopweaver browser image-record` — write down what you saw in an image, so it can be attached.
 *
 * Every decision is in `../../../visualEvidence/recordForm.ts`; this file reads the form, decodes the
 * bytes, appends the record and prints the reference a composer puts in its `images`.
 *
 * ## What this verb is FOR, stated rather than implied
 *
 * Two full-page Datadog screenshots reached the owner's DM, one of them photographed before its
 * panel had rendered, and the investigation found that the worker had read both pictures back and shipped
 * them anyway. So this verb does not exist to make a session look — it exists to make looking leave
 * something a gate can refuse on. Until it landed, the `failed` arm of image admission had no producer at
 * all, which made it a check that could not fire.
 *
 * ## A failed record is a SUCCESSFUL write and a non-zero exit
 *
 * Those are two different facts and this verb reports both: the record is appended, because the durable
 * truth is that somebody looked and what they saw; the exit code is non-zero, because the picture may not
 * be sent. The record is never rolled back on the strength of the refusal — doing so would erase the
 * observation that caught the defect and hand the same bytes back to the missing-record exception, which is
 * hatchable.
 */

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { logger } from "../../../lib/logger.js";
import { ok } from "../../../lib/result.js";
import { safeJsonParse } from "../../../lib/safeJson.js";
import { captureIdFor, isCaptureReceipt, readCaptureRecord } from "../../../visualEvidence/captureRecord.js";
import { visualEvidenceErrorLines } from "../../../visualEvidence/evidenceErrors.js";
import { identifyImageBytes, imageDigestOf } from "../../../visualEvidence/imageIo.js";
import {
  type ImageRecordForm,
  imageRecordOf,
  mintReceiptId,
  parseImageRecordForm,
} from "../../../visualEvidence/recordForm.js";
import { appendImageRecord, readImageRecords } from "../../../visualEvidence/store.js";
import type { ArtifactIdentity, ImageRecord } from "../../../visualEvidence/types.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";

/** What the verb produced, so the printer has no decisions of its own. */
interface RecordReport {
  readonly record: ImageRecord;
  readonly path: string;
}

/**
 * Print the record, and the reference a composer should now carry.
 *
 * The reference is printed as JSON because it is copied verbatim into an answer form's `images`, and a
 * reader retyping a 64-character digest is a reader who will get it wrong.
 *
 * @param report what was written
 * @param json whether machine-readable output was asked for
 */
function reportRecord({ report, json }: { report: RecordReport; json: boolean }): void {
  const ref = {
    artifactDigest: report.record.artifact.digest,
    path: report.path,
    receiptId: report.record.receiptId,
  };
  if (json) {
    logger.out({ line: JSON.stringify({ record: report.record, ref }, null, 2) });
    return;
  }
  const { artifact, outcome } = report.record;
  logger.out({ line: `image-record: ${outcome} — ${report.path}` });
  logger.out({ line: `  ${String(artifact.widthPx)}x${String(artifact.heightPx)}, ${artifact.digest}` });
  if (report.record.outcome === "failed") {
    logger.out({ line: `  reason: ${report.record.reason}` });
    logger.out({ line: `  correction: ${report.record.correction}` });
    logger.out({ line: "  recorded. this image can no longer be attached to an outbound message." });
    return;
  }
  logger.out({ line: "  recorded. put this in the answer form's `images`:" });
  logger.out({ line: JSON.stringify(ref) });
}

/** The form and the decoded artifact, or the exit code that says why neither exists. */
type Resolved =
  | {
      readonly kind: "ready";
      readonly form: ImageRecordForm;
      readonly artifact: ArtifactIdentity;
      readonly path: string;
    }
  | { readonly kind: "refused"; readonly code: number };

/**
 * Read and validate the form file itself.
 *
 * @param form the path to the form file
 * @returns the parsed form, or the exit code to return
 */
async function loadForm({
  form,
}: {
  form: string;
}): Promise<{ readonly form: ImageRecordForm } | { readonly code: number }> {
  let text: string;
  try {
    text = await readFile(form, "utf8");
  } catch (error) {
    logger.error({
      msg: `could not read the form at ${form}: ${error instanceof Error ? error.message : String(error)}`,
    });
    return { code: EXIT_ERROR };
  }
  let decoded: unknown;
  try {
    decoded = safeJsonParse({ label: `image-record form at ${form}`, text });
  } catch (error) {
    logger.error({
      msg: `could not parse the form at ${form}: ${error instanceof Error ? error.message : String(error)}`,
    });
    return { code: EXIT_USAGE };
  }
  const parsed = parseImageRecordForm({ value: decoded });
  if (parsed.isErr()) {
    for (const problem of parsed.error) {
      logger.error({ msg: problem });
    }
    return { code: EXIT_USAGE };
  }
  return { form: parsed.value };
}

/**
 * The identity a `proof cassette` receipt gives a recording no image decoder reads: these exact bytes' digest, the
 * frame size the verb probed. `null` when no cassette receipt names the bytes, so a video nobody recorded through the
 * verb is refused exactly as before.
 *
 * @param bytes the file's bytes
 * @param home the state home the capture receipts live under
 * @returns the identity, or `null`
 */
function recordedVideoIdentity({ bytes, home }: { bytes: Uint8Array; home: string }): ArtifactIdentity | null {
  const digest = imageDigestOf({ bytes });
  const capture = readCaptureRecord({ captureId: captureIdFor({ digest }), home });
  if (capture.isErr() || capture.value === null || !isCaptureReceipt(capture.value)) {
    return null;
  }
  const receipt = capture.value;
  if (receipt.verb !== "proof cassette" || receipt.final.artifact.digest !== digest) {
    return null;
  }
  return receipt.final.artifact;
}

/**
 * Read the image the form names and decode it, cross-checking any digest the form claimed. A recording
 * `proof cassette` wrote is identified by its receipt instead, since no image decoder reads a video.
 *
 * @param path the resolved image path
 * @param expectDigest the digest the form believes these bytes have, when it named one
 * @param home the state home the capture receipts live under
 * @returns what the bytes decode to, or the exit code to return
 */
async function loadArtifact({
  path,
  expectDigest,
  home,
}: {
  path: string;
  expectDigest: string | undefined;
  home: string;
}): Promise<{ readonly artifact: ArtifactIdentity } | { readonly code: number }> {
  let bytes: Uint8Array;
  try {
    bytes = await readFile(path);
  } catch (error) {
    logger.error({
      msg: `could not read the image at ${path}: ${error instanceof Error ? error.message : String(error)}`,
    });
    return { code: EXIT_ERROR };
  }
  const recorded = recordedVideoIdentity({ bytes, home });
  const decoded = recorded === null ? await identifyImageBytes({ bytes }) : ok(recorded);
  if (decoded.isErr()) {
    for (const problem of visualEvidenceErrorLines({ error: decoded.error })) {
      logger.error({ msg: problem });
    }
    return { code: EXIT_ERROR };
  }
  if (expectDigest !== undefined && expectDigest !== decoded.value.digest) {
    logger.error({
      msg:
        `the form expects ${expectDigest} and ${path} holds ${decoded.value.digest} — the bytes changed ` +
        "since you looked, so record what is there now rather than what you saw",
    });
    return { code: EXIT_ERROR };
  }
  return { artifact: decoded.value };
}

/**
 * Read the form, read the image it names, and decode it — reporting the first thing that went wrong.
 *
 * Split from {@link runImageRecord} so that gathering the facts and deciding about them stay separate: this
 * function writes nothing, and its caller reads nothing.
 *
 * @param form the path to the form file
 * @param home the state home the capture receipts live under
 * @returns the form and artifact, or the exit code to return
 */
async function resolveForm({ form, home }: { form: string; home: string }): Promise<Resolved> {
  const loaded = await loadForm({ form });
  if (!("form" in loaded)) {
    return { code: loaded.code, kind: "refused" };
  }
  const path = resolve(loaded.form.path);
  const artifact = await loadArtifact({ expectDigest: loaded.form.expectDigest, home, path });
  if (!("artifact" in artifact)) {
    return { code: artifact.code, kind: "refused" };
  }
  return { artifact: artifact.artifact, form: loaded.form, kind: "ready", path };
}

/**
 * Why a cited `captureId` does not cover these bytes, or `null` when it does or none was cited.
 *
 * A capture record names the FINAL bytes it produced. A form citing one while recording other bytes is
 * either recording the raw capture under the crop's provenance or a file edited since — refused either way,
 * because the link is what lets a reader trust the crop rectangle and the readiness observation.
 *
 * @param captureId the record the form cites, when it cites one
 * @param artifact the bytes being recorded
 * @param path where they were read from, for the message
 * @param home the state home the capture records live under
 * @returns the problem, or `null`
 */
function captureLinkProblem({
  captureId,
  artifact,
  path,
  home,
}: {
  captureId: string | undefined;
  artifact: ArtifactIdentity;
  path: string;
  home: string;
}): string | null {
  if (captureId === undefined) {
    return null;
  }
  const capture = readCaptureRecord({ captureId, home });
  if (capture.isErr()) {
    return capture.error.message;
  }
  if (capture.value === null) {
    return `no capture record ${captureId} exists under this home`;
  }
  if (capture.value.final.artifact.digest !== artifact.digest) {
    return (
      `capture ${captureId} produced ${capture.value.final.artifact.digest} and ${path} holds ${artifact.digest} — ` +
      "record the capture's own final PNG, or drop captureId"
    );
  }
  return null;
}

/**
 * Run `browser image-record`.
 *
 * @param form the path to the form file
 * @param home the state home the record is written under
 * @param json whether machine-readable output was asked for
 * @returns the process exit code — non-zero for a `failed` record, which is still written
 */
export async function runImageRecord({
  form,
  home,
  json,
}: {
  form: string;
  home: string;
  json: boolean;
}): Promise<number> {
  const resolved = await resolveForm({ form, home });
  if (resolved.kind === "refused") {
    return resolved.code;
  }
  // Defence in depth against a counterexample an adversarial review found: admission already treats a failure
  // as terminal for its bytes, so a later `passed` record could not admit them — but writing one at all
  // would leave a record that READS like a clearance, and the next reader would have to know the ordering
  // rule to see that it is not. Refusing it here keeps the store honest as well as the gate.
  const held = readImageRecords({ digest: resolved.artifact.digest, home });
  if (held.isErr()) {
    logger.error({ msg: held.error.message });
    return EXIT_ERROR;
  }
  const alreadyFailed = held.value.find(
    (record): record is Extract<ImageRecord, { outcome: "failed" }> => record.outcome === "failed",
  );
  if (alreadyFailed !== undefined && resolved.form.verdict === "passed") {
    logger.error({
      msg:
        `these exact bytes are already recorded unfit (${alreadyFailed.reason}) — an unchanged artifact ` +
        "cannot be cleared by looking again. Correct it instead: re-capture, wait for the panel, or crop. " +
        "That produces different bytes and a record of its own.",
    });
    return EXIT_ERROR;
  }
  const linkProblem = captureLinkProblem({
    artifact: resolved.artifact,
    captureId: resolved.form.captureId,
    home,
    path: resolved.path,
  });
  if (linkProblem !== null) {
    logger.error({ msg: linkProblem });
    return EXIT_ERROR;
  }
  const record = imageRecordOf({
    artifact: resolved.artifact,
    form: resolved.form,
    receiptId: mintReceiptId(),
  });
  const written = appendImageRecord({ home, record });
  if (written.isErr()) {
    logger.error({ msg: written.error.message });
    return EXIT_ERROR;
  }
  reportRecord({ json, report: { path: resolved.path, record } });
  return record.outcome === "passed" ? EXIT_OK : EXIT_ERROR;
}
